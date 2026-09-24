import type { BackendHandle } from './backendTypes.js'
import { CronRepository, assertCronUserCanRun } from './model/repositories/cron.js'
import type { SessionRepository } from './model/repositories/session.js'

// Handled by the server-owned runner before routing any event to a desktop.
// Identity comes from the runner's session, never from the tool's arguments.
export async function handleCronHostRequest(
  line: string, sessionId: string, sessions: SessionRepository, handle: Pick<BackendHandle, 'writeStdin'>,
): Promise<boolean> {
  let message
  try { message = JSON.parse(line) } catch { return false }
  const event = message?.request?.event
  if (message?.type !== 'control_request' || message.request?.subtype !== 'moss_app_event' || event?.type !== 'server_cron') return false
  try {
    const session = await sessions.getSession(sessionId)
    if (!session) throw new Error('会话不存在。')
    await assertCronUserCanRun(sessions.db, session)
    const repo = new CronRepository(sessions.db)
    const input = event.input || {}
    let result: Record<string, unknown>
    switch (input.operation) {
      case 'create': result = { task: await repo.create(session, sessionId, input.task) }; break
      case 'list': result = { tasks: await repo.list(session, sessionId) }; break
      case 'remove': {
        const ids: unknown[] = Array.isArray(input.ids) ? input.ids : []
        for (const task of await repo.list(session, sessionId)) {
          if (ids.includes(task.id)) await repo.remove(task.id, session)
        }
        result = {}
        break
      }
      default: throw new Error('Unknown scheduling operation.')
    }
    handle.writeStdin(`${JSON.stringify({ type: 'control_response', response: {
      subtype: 'success', request_id: message.request_id, response: { ok: true, ...result },
    } })}\n`)
  } catch (error) {
    handle.writeStdin(`${JSON.stringify({ type: 'control_response', response: {
      subtype: 'error', request_id: message.request_id, error: error instanceof Error ? error.message : String(error),
    } })}\n`)
  }
  return true
}
