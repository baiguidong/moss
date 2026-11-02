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
      WHERE c.token_hash=? AND u.status='active' AND u.deleted_at IS NULL`)
      .get(createHash('sha256').update(token).digest('hex'))
  }
  async list(orgId: string, userId?: string) {
    const rows = await this.db.prepare(`SELECT * FROM hosts WHERE org_id=?${userId ? ' AND user_id=?' : ''} ORDER BY last_seen DESC`)
      .all(...(userId ? [orgId, userId] : [orgId]))
    return rows.map(decode)
  }
  async heartbeat(owner: { orgId: string; userId: string }, input: Record<string, any>) {
    return this.db.transaction(async () => {
      const current = await this.db.prepare('SELECT * FROM hosts WHERE id=?').get(input.id)
      if (current && (current.org_id !== owner.orgId || current.user_id !== owner.userId || current.kind !== input.kind)) {
        throw Object.assign(new Error('电脑归属不匹配'), { statusCode: 403 })
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
      return { commands: commands.map(decode), policy: await this.policy(owner.orgId) }
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
