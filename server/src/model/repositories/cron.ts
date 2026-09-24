import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'
import { z } from 'zod'
import type { Database, SqlRow } from '../database.js'

export const cronInputSchema = z.object({
  cron: z.string().trim().min(1).max(255),
  prompt: z.string().trim().min(1).max(32000),
  recurring: z.boolean().default(true),
  timezone: z.string().max(128).optional(),
  agentId: z.string().max(128).optional(),
})
export type CronOwner = { orgId: string; userId: string }
export type CloudCronTask = CronOwner & {
  id: string; ownerSessionId: string; executionSessionId: string | null
  cron: string; prompt: string; timezone: string; recurring: boolean; durable: true
  enabled: boolean; status: 'idle' | 'running' | 'failed'; createdAt: number
  nextRunAt: number | null; lastFiredAt: number | null; lastCompletedAt: number | null
  lastError: string | null; runId: string | null; agentId?: string
  ownerSessionTitle?: string | null; executionSessionTitle?: string | null; orphaned?: boolean
}
export function nextCloudCronRun(cron: string, from: number, timezone: string): number {
  // Standard five-field cron only; the parser handles IANA zones and DST.
  if (!/^[\d*,/\-\s]+$/.test(cron) || cron.trim().split(/\s+/).length !== 5) throw new Error('需要标准的五字段 cron 表达式。')
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0)
  const job = new Cron(cron, { paused: true, timezone, mode: '5-part' })
  try {
    const next = job.nextRun(new Date(from))?.getTime()
    if (!next || next > from + 366 * 86400000) throw new Error('未来一年内没有匹配的执行时间。')
    return next
  } finally { job.stop() }
}
function task(row: SqlRow): CloudCronTask {
  const number = (key: string) => row[key] == null ? null : Number(row[key])
  return {
    id: String(row.id), orgId: String(row.org_id), userId: String(row.user_id),
    ownerSessionId: String(row.owner_session_id), executionSessionId: row.execution_session_id as string | null,
    cron: String(row.cron), prompt: String(row.prompt), timezone: String(row.timezone),
    recurring: Boolean(row.recurring), durable: true, enabled: Boolean(row.enabled),
    status: row.status as CloudCronTask['status'], createdAt: Number(row.created_at),
    nextRunAt: number('next_run_at'), lastFiredAt: number('last_fired_at'), lastCompletedAt: number('last_completed_at'),
    lastError: row.last_error as string | null, runId: row.run_id as string | null,
    ...(row.agent_id ? { agentId: String(row.agent_id) } : {}),
    ownerSessionTitle: row.owner_title as string | null, executionSessionTitle: row.execution_title as string | null,
    orphaned: !row.owner_exists,
  }
}
const select = `SELECT t.*, o.session_id AS owner_exists, o.title AS owner_title, e.title AS execution_title
  FROM cron_tasks t LEFT JOIN sessions o ON o.session_id=t.owner_session_id AND o.deleted_at IS NULL
  LEFT JOIN sessions e ON e.session_id=t.execution_session_id AND e.deleted_at IS NULL`

export class CronRepository {
  constructor(readonly db: Database) {}
  async get(id: string, owner: CronOwner): Promise<CloudCronTask | null> {
    const row = await this.db.prepare(`${select} WHERE t.id=? AND t.org_id=? AND t.user_id=? AND t.status<>'deleted'`).get(id, owner.orgId, owner.userId)
    return row ? task(row) : null
  }
  async list(owner: CronOwner, ownerSessionId?: string): Promise<CloudCronTask[]> {
    const rows = await this.db.prepare(`${select} WHERE t.org_id=? AND t.user_id=? AND t.status<>'deleted' ${ownerSessionId ? 'AND t.owner_session_id=?' : ''} ORDER BY t.created_at DESC`)
      .all(owner.orgId, owner.userId, ...(ownerSessionId ? [ownerSessionId] : []))
    return rows.map(task)
  }
  async create(owner: CronOwner, ownerSessionId: string, input: unknown, now = Date.now()): Promise<CloudCronTask> {
    const value = cronInputSchema.parse(input)
    const timezone = value.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    const next = nextCloudCronRun(value.cron, now, timezone)
    return this.db.transaction(async () => {
      const source = await this.db.prepare('SELECT session_id FROM sessions WHERE session_id=? AND org_id=? AND user_id=? AND deleted_at IS NULL')
        .get(ownerSessionId, owner.orgId, owner.userId)
      if (!source) throw new Error('归属会话不存在。')
      const count = await this.db.prepare("SELECT COUNT(*) AS count FROM cron_tasks WHERE org_id=? AND user_id=? AND status<>'deleted'").get(owner.orgId, owner.userId)
      if (Number(count?.count) >= 50) throw new Error('云端定时任务最多 50 个，请先删除不需要的任务。')
      const id = randomUUID()
      await this.db.prepare(`INSERT INTO cron_tasks
        (id,org_id,user_id,owner_session_id,cron,timezone,prompt,recurring,created_at,next_run_at,agent_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, owner.orgId, owner.userId, ownerSessionId, value.cron, timezone, value.prompt, value.recurring ? 1 : 0, now, next, value.agentId ?? null)
      return (await this.get(id, owner))!
    })
  }
  async remove(id: string, owner: CronOwner): Promise<boolean> {
    return this.db.transaction(async () => {
      const current = await this.get(id, owner)
      if (!current) return false
      // Retain the lease until the in-flight turn ends, so deleting a task
      // cannot bypass per-user/global concurrency limits. Hide it immediately.
      if (current.runId) {
        await this.db.prepare("UPDATE cron_tasks SET enabled=0, status='deleted' WHERE id=?").run(id)
      } else {
        await this.db.prepare('DELETE FROM cron_tasks WHERE id=?').run(id)
      }
      return true
    })
  }
  async toggle(id: string, owner: CronOwner, enabled: boolean, now = Date.now()): Promise<boolean> {
    return this.db.transaction(async () => {
      const current = await this.get(id, owner)
      if (!current) return false
      const next = enabled && !current.enabled
        ? current.lastError ? now : nextCloudCronRun(current.cron, now, current.timezone)
        : current.nextRunAt
      await this.db.prepare(`UPDATE cron_tasks SET enabled=?, next_run_at=?, last_error=?, status=? WHERE id=?`)
        .run(enabled ? 1 : 0, next, enabled ? null : current.lastError, current.runId ? 'running' : enabled ? 'idle' : current.status, id)
      return true
    })
  }
  async due(now: number): Promise<CloudCronTask[]> {
    return (await this.db.prepare(`${select} WHERE t.enabled=1 AND t.run_id IS NULL AND t.next_run_at<=? ORDER BY t.next_run_at LIMIT 200`).all(now)).map(task)
  }
  async claim(id: string, owner: CronOwner, host: string, manual: boolean, now: number): Promise<CloudCronTask | null> {
    return this.db.transaction(async () => {
      const current = await this.get(id, owner)
      if (!current || current.runId || (!manual && (!current.enabled || current.nextRunAt! > now))) return null
      const running = await this.db.prepare('SELECT user_id, org_id FROM cron_tasks WHERE run_id IS NOT NULL').all()
      if (running.length >= 4 || running.some(row => row.user_id === owner.userId && row.org_id === owner.orgId)) return null
      const runId = randomUUID()
      await this.db.prepare(`UPDATE cron_tasks SET run_id=?, run_host=?, lease_until=?, status='running', last_fired_at=? WHERE id=?`)
        .run(runId, host, now + 90000, now, id)
      return { ...current, runId, status: 'running', lastFiredAt: now }
    })
  }
  async setExecution(current: CloudCronTask, sessionId: string): Promise<void> {
    await this.db.prepare('UPDATE cron_tasks SET execution_session_id=? WHERE id=? AND run_id=?').run(sessionId, current.id, current.runId)
  }
  async renew(host: string, now: number, activeIds: string[]): Promise<void> {
    if (!activeIds.length) return
    await this.db.prepare(`UPDATE cron_tasks SET lease_until=? WHERE run_host=? AND run_id IS NOT NULL AND id IN (${activeIds.map(() => '?').join(',')})`)
      .run(now + 90000, host, ...activeIds)
  }
  async recover(now: number): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.prepare("DELETE FROM cron_tasks WHERE status='deleted' AND lease_until<?").run(now)
      await this.db.prepare(`UPDATE cron_tasks SET enabled=0, status='failed', last_error=?, run_id=NULL, run_host=NULL, lease_until=NULL
        WHERE run_id IS NOT NULL AND lease_until<?`).run('上次执行被中断，结果未确认，请检查执行会话后手动重试。', now)
    })
  }
  async finish(current: CloudCronTask, error: string | null, now: number): Promise<void> {
    await this.db.transaction(async () => {
      const stored = await this.db.prepare('SELECT status FROM cron_tasks WHERE id=? AND run_id=?').get(current.id, current.runId)
      if (!stored) return
      if (stored.status === 'deleted' || (!error && !current.recurring)) {
        await this.db.prepare('DELETE FROM cron_tasks WHERE id=? AND run_id=?').run(current.id, current.runId)
        return
      }
      const next = error ? current.nextRunAt : nextCloudCronRun(current.cron, now, current.timezone)
      await this.db.prepare(`UPDATE cron_tasks SET status=?, enabled=CASE WHEN ?=1 THEN 0 ELSE enabled END,
        last_error=?, last_completed_at=CASE WHEN ?=1 THEN last_completed_at ELSE ? END, next_run_at=?,
        run_id=NULL, run_host=NULL, lease_until=NULL WHERE id=? AND run_id=?`)
        .run(error ? 'failed' : 'idle', error ? 1 : 0, error, error ? 1 : 0, now, next, current.id, current.runId)
    })
  }
}

export async function assertCronUserCanRun(db: Database, owner: CronOwner): Promise<void> {
  const user = await db.prepare('SELECT status FROM users WHERE id=? AND org_id=?').get(owner.userId, owner.orgId)
  if (user?.status !== 'active') throw new Error('用户不存在或已停用。')
  const permission = await db.prepare(`SELECT p.permission FROM user_roles ur JOIN roles r ON r.id=ur.role_id
    JOIN role_permissions p ON p.role_id=r.id WHERE ur.user_id=? AND r.org_id=? AND p.permission IN ('*','sessions:create') LIMIT 1`)
    .get(owner.userId, owner.orgId)
  if (!permission) throw new Error('用户已无会话执行权限，定时任务已暂停。')
}
