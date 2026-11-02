import type { Database, SqlRow } from '../database.js'
import { createHash, randomBytes } from 'node:crypto'

const decode = (row: SqlRow) => ({ id: String(row.id), hostId: String(row.host_id || row.id),
  orgId: String(row.org_id), userId: row.user_id, name: row.name, kind: row.kind,
  version: row.version, platform: row.platform, lastSeen: Number(row.last_seen || 0),
  online: Number(row.last_seen) > Date.now() - 90_000,
  ...(row.status_json ? { status: JSON.parse(String(row.status_json)) } : {}),
  ...(row.action ? { action: row.action, input: JSON.parse(String(row.input_json)), state: row.state,
    actorId: row.actor_id, createdAt: Number(row.created_at), expiresAt: Number(row.expires_at),
    result: row.result_json ? JSON.parse(String(row.result_json)) : null } : {}) })

export class HostRepository {
  constructor(readonly db: Database) {}
  async get(id: string, orgId: string) {
    return await this.db.prepare('SELECT * FROM hosts WHERE id=? AND org_id=?').get(id, orgId)
  }
  async enroll(id: string) {
    const token = `moss_host_${randomBytes(32).toString('base64url')}`
    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM host_credentials WHERE host_id=?').run(id)
      await this.db.prepare('INSERT INTO host_credentials(token_hash,host_id,created_at) VALUES(?,?,?)')
        .run(createHash('sha256').update(token).digest('hex'), id, Date.now())
    })
    return token
  }
  async authenticate(token: string) {
    return this.db.prepare(`SELECT h.* FROM host_credentials c JOIN hosts h ON c.host_id=h.id
      JOIN users u ON u.id=h.user_id AND u.org_id=h.org_id
      WHERE c.token_hash=?`)
      .get(createHash('sha256').update(token).digest('hex'))
  }
  async list(orgId: string, userId?: string) {
    const rows = await this.db.prepare(`SELECT * FROM hosts WHERE org_id=?${userId ? ' AND user_id=?' : ''} ORDER BY last_seen DESC`)
      .all(...(userId ? [orgId, userId] : [orgId]))
    return Promise.all(rows.map(async row => ({ ...decode(row), access: await this.access(String(row.id), orgId),
      mailbox: await this.mailbox(orgId, String(row.user_id)) === row.id })))
  }
  async heartbeat(owner: { orgId: string; userId: string }, input: Record<string, any>) {
    return this.db.transaction(async () => {
      const current = await this.db.prepare('SELECT * FROM hosts WHERE id=?').get(input.id)
      if (current && (current.org_id !== owner.orgId || current.user_id !== owner.userId || current.kind !== input.kind)) {
        throw Object.assign(new Error('电脑归属不匹配'), { statusCode: 403 })
      }
      const access = await this.access(input.id, owner.orgId)
      if (!access.allowed) {
        await this.db.prepare('UPDATE hosts SET last_seen=? WHERE id=?').run(Date.now(), input.id)
        return { access, commands: [] }
      }
      const now = Date.now()
      if (current && current.epoch !== input.epoch) {
        await this.db.prepare("UPDATE host_commands SET state='failed',result_json=?,updated_at=? WHERE host_id=? AND state='running'")
          .run(JSON.stringify({ error: 'Host 已重启，请核查执行结果；未自动重放。' }), now, input.id)
      }
      const values = [input.name, input.version, input.platform, input.epoch, JSON.stringify(input.status), now]
      if (current) await this.db.prepare('UPDATE hosts SET name=?,version=?,platform=?,epoch=?,status_json=?,last_seen=? WHERE id=?').run(...values, input.id)
      else await this.db.prepare('INSERT INTO hosts(name,version,platform,epoch,status_json,last_seen,id,org_id,user_id,kind,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(...values, input.id, owner.orgId, owner.userId, input.kind, now)
      await this.db.prepare("UPDATE host_commands SET state='expired',updated_at=? WHERE host_id=? AND state='pending' AND expires_at<=?").run(now, input.id, now)
      await this.db.prepare("UPDATE host_commands SET state='failed',result_json=?,updated_at=? WHERE host_id=? AND state='running' AND expires_at<=?").run(JSON.stringify({ error: '未收到执行回执，请核查结果。' }), now, input.id, now)
      const commands = await this.db.prepare("SELECT * FROM host_commands WHERE host_id=? AND state='pending' ORDER BY created_at LIMIT 10").all(input.id)
      for (const command of commands) await this.db.prepare("UPDATE host_commands SET state='running',epoch=?,updated_at=? WHERE id=?").run(input.epoch, now, String(command.id))
      for (const report of input.schedules || []) {
        await this.db.prepare('UPDATE host_schedules SET applied_revision=?,error=? WHERE id=? AND host_id=? AND revision=?')
          .run(report.error ? 0 : report.revision, report.error || null, report.id, input.id, report.revision)
      }
      return { access, commands: commands.map(decode), policy: await this.policy(owner.orgId),
        mailbox: await this.mailbox(owner.orgId, owner.userId) === input.id, schedules: await this.schedules(input.id) }
    })
  }
  async access(id: string, orgId: string) {
    const row = await this.db.prepare(`SELECT a.revoked,u.status,u.deleted_at FROM hosts h
      JOIN users u ON u.id=h.user_id AND u.org_id=h.org_id LEFT JOIN host_access a ON a.host_id=h.id
      WHERE h.id=? AND h.org_id=?`).get(id, orgId)
    const reason = row && (row.status !== 'active' || row.deleted_at != null) ? '账号已停用'
      : Number(row?.revoked) === 1 ? '电脑已被撤销' : null
    return { allowed: !reason, reason }
  }
  async setAccess(id: string, actorId: string, revoked: boolean) {
    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM host_access WHERE host_id=?').run(id)
      await this.db.prepare('INSERT INTO host_access(host_id,revoked,actor_id,updated_at) VALUES(?,?,?,?)').run(id, revoked ? 1 : 0, actorId, Date.now())
      if (revoked) await this.db.prepare("UPDATE host_commands SET state='failed',result_json=?,updated_at=? WHERE host_id=? AND state IN ('pending','running')")
        .run(JSON.stringify({ error: '电脑已被撤销，请核查此前执行结果。' }), Date.now(), id)
    })
  }
  async mailbox(orgId: string, userId: string) {
    return (await this.db.prepare('SELECT host_id FROM host_mailboxes WHERE org_id=? AND user_id=?').get(orgId, userId))?.host_id || null
  }
  async assignMailbox(orgId: string, userId: string, hostId: string | null) {
    return this.db.transaction(async () => {
      if (await this.mailbox(orgId, userId) === hostId) return
      const busy = await this.db.prepare("SELECT id FROM agent_mail_messages WHERE org_id=? AND to_user_id=? AND status IN ('leased','accepted','running') LIMIT 1").get(orgId, userId)
      if (busy) throw Object.assign(new Error('邮箱仍有未完成的处理，请在原电脑完成后再切换。'), { statusCode: 409 })
      await this.db.prepare('DELETE FROM host_mailboxes WHERE org_id=? AND user_id=?').run(orgId, userId)
      if (hostId) await this.db.prepare('INSERT INTO host_mailboxes(org_id,user_id,host_id) VALUES(?,?,?)').run(orgId, userId, hostId)
      await this.db.prepare('DELETE FROM agent_mail_consumers WHERE org_id=? AND user_id=?').run(orgId, userId)
    })
  }
  async requireMailbox(token: string, owner: { orgId: string; userId: string }) {
    const host = await this.authenticate(token)
    if (!host || host.org_id !== owner.orgId || host.user_id !== owner.userId
      || !(await this.access(String(host.id), owner.orgId)).allowed || await this.mailbox(owner.orgId, owner.userId) !== host.id) {
      throw Object.assign(new Error('请在工作电脑管理中指定接收邮箱的电脑，并在该电脑登录。'), { statusCode: 403, code: 'MAILBOX_HOST_REQUIRED' })
    }
  }
  async schedules(hostId: string) {
    return (await this.db.prepare('SELECT * FROM host_schedules WHERE host_id=? AND (deleted=0 OR applied_revision<revision) ORDER BY updated_at').all(hostId)).map(row => ({
      id: String(row.id), revision: Number(row.revision), config: JSON.parse(String(row.config_json)), deleted: Boolean(row.deleted),
      appliedRevision: Number(row.applied_revision), error: row.error || null,
    }))
  }
  async setSchedule(orgId: string, hostId: string, id: string, config: unknown, deleted: boolean, revision: number) {
    return this.db.transaction(async () => {
      const row = await this.db.prepare('SELECT * FROM host_schedules WHERE id=?').get(id)
      if (row && (row.host_id !== hostId || row.org_id !== orgId)) throw Object.assign(new Error('任务不能直接换电脑，请先删除原任务并等候回执。'), { statusCode: 409 })
      if (Number(row?.revision || 0) !== revision) throw Object.assign(new Error('配置已更新，请刷新后重试。'), { statusCode: 409 })
      if (row) await this.db.prepare('UPDATE host_schedules SET revision=?,config_json=?,deleted=?,error=NULL,updated_at=? WHERE id=?')
        .run(revision + 1, JSON.stringify(config ?? JSON.parse(String(row.config_json))), deleted ? 1 : 0, Date.now(), id)
      else {
        const count = await this.db.prepare('SELECT COUNT(*) AS n FROM host_schedules WHERE host_id=? AND (deleted=0 OR applied_revision<revision)').get(hostId)
        if (Number(count?.n) >= 100) throw Object.assign(new Error('每台电脑最多保留 100 个企业定时任务。'), { statusCode: 409 })
        await this.db.prepare('INSERT INTO host_schedules(id,host_id,org_id,revision,config_json,deleted,applied_revision,updated_at) VALUES(?,?,?,1,?,0,0,?)')
          .run(id, hostId, orgId, JSON.stringify(config), Date.now())
      }
      return { ok: true, revision: revision + 1 }
    })
  }
  async policy(orgId: string) {
    const row = await this.db.prepare('SELECT * FROM host_policies WHERE org_id=?').get(orgId)
    return row ? { revision: Number(row.revision), settings: JSON.parse(String(row.settings_json)) } : { revision: 0, settings: {} }
  }
  async setPolicy(orgId: string, actorId: string, settings: Record<string, unknown>) {
    return this.db.transaction(async () => {
      const current = await this.policy(orgId)
      if (current.revision) await this.db.prepare('UPDATE host_policies SET revision=?,settings_json=?,actor_id=?,updated_at=? WHERE org_id=?')
        .run(current.revision + 1, JSON.stringify(settings), actorId, Date.now(), orgId)
      else await this.db.prepare('INSERT INTO host_policies(org_id,revision,settings_json,actor_id,updated_at) VALUES(?,1,?,?,?)')
        .run(orgId, JSON.stringify(settings), actorId, Date.now())
      return this.policy(orgId)
    })
  }
  async submit(orgId: string, actorId: string, hostId: string, input: { id: string; action: string; input: unknown }) {
    return this.db.transaction(async () => {
      const previous = await this.db.prepare('SELECT * FROM host_commands WHERE id=?').get(input.id)
      if (previous) {
        if (previous.org_id !== orgId || previous.actor_id !== actorId || previous.host_id !== hostId || previous.action !== input.action || previous.input_json !== JSON.stringify(input.input)) {
          throw Object.assign(new Error('命令 ID 已被其他请求使用'), { statusCode: 409 })
        }
        return decode(previous)
      }
      const now = Date.now()
      await this.db.prepare("INSERT INTO host_commands(id,host_id,org_id,actor_id,action,input_json,state,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,'pending',?,?,?)")
        .run(input.id, hostId, orgId, actorId, input.action, JSON.stringify(input.input), now, now + 300_000, now)
      return decode((await this.db.prepare('SELECT * FROM host_commands WHERE id=?').get(input.id))!)
    })
  }
  async commands(hostId: string) {
    return (await this.db.prepare('SELECT * FROM host_commands WHERE host_id=? ORDER BY created_at DESC LIMIT 100').all(hostId)).map(decode)
  }
  async complete(hostId: string, epoch: string, id: string, state: string, result: unknown) {
    const update = await this.db.prepare("UPDATE host_commands SET state=?,result_json=?,updated_at=? WHERE id=? AND host_id=? AND epoch=? AND state='running'")
      .run(state, JSON.stringify(result), Date.now(), id, hostId, epoch)
    return update.changes > 0
  }
}
