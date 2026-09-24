import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Database } from './model/database.js'
import type { ServerConfig } from './types.js'
import { getUserProfileDir } from './runtimePaths.js'

// Old global files were only mirrors: ownership and durability cannot be proven.
// Preserve them visibly, paused, and never automatically execute old prompts.
export async function importLegacyCloudCron(db: Database, config: ServerConfig): Promise<void> {
  for (const user of await db.prepare('SELECT id, org_id FROM users').all()) {
    const userId = String(user.id), key = `cron_legacy_import:${userId}`
    if (await db.prepare('SELECT value FROM server_config WHERE `key`=?').get(key)) continue
    let parsed
    try { parsed = JSON.parse(await readFile(join(getUserProfileDir(config, userId), 'cron_tasks.json'), 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    if (!Array.isArray(parsed?.tasks)) continue
    await db.transaction(async () => {
      if (await db.prepare('SELECT value FROM server_config WHERE `key`=?').get(key)) return
      for (const entry of parsed.tasks.slice(0, 50)) {
        if (!entry || typeof entry.cron !== 'string' || typeof entry.prompt !== 'string' || typeof entry.id !== 'string') continue
        await db.prepare(`INSERT INTO cron_tasks
          (id,org_id,user_id,owner_session_id,cron,timezone,prompt,recurring,enabled,status,created_at,last_error)
          VALUES (?,?,?,?,?,?,?,?,0,'failed',?,?)`).run(
            `legacy:${userId}:${entry.id}`.slice(0, 128), String(user.org_id), userId, '', entry.cron.slice(0, 255),
            Intl.DateTimeFormat().resolvedOptions().timeZone, entry.prompt.slice(0, 32000), entry.recurring ? 1 : 0,
            Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
            '旧任务缺少归属会话和生命周期信息，已保留但不会自动执行。请删除后在云端会话重新创建。',
          )
      }
      await db.prepare('INSERT INTO server_config (`key`,value) VALUES (?,?)').run(key, 'done')
    })
  }
}
