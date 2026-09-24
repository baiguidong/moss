import { randomUUID } from 'node:crypto'
import type { RuntimeService } from './runtimeService.js'

/** The server owns this connection until the turn finishes, independently of Desktop. */
export async function runCronPrompt(runtime: RuntimeService, sessionId: string, prompt: string, signal: AbortSignal): Promise<void> {
  const pendingLock = runtime.acquireSessionTurn(sessionId)
  let release: (() => void) | undefined
  const aborted = () => signal.reason instanceof Error ? signal.reason : new Error('定时执行已中断。')
  let cancelLock!: () => void
  try {
    release = await Promise.race([
      pendingLock,
      new Promise<never>((_, reject) => {
        cancelLock = () => reject(aborted())
        if (signal.aborted) cancelLock()
        else signal.addEventListener('abort', cancelLock, { once: true })
      }),
    ])
    signal.removeEventListener('abort', cancelLock)
    signal.throwIfAborted()
    const ready = await runtime.ensureSessionReady(sessionId)
    signal.throwIfAborted()
    const socket = await runtime.connectToAttempt(ready.attempt)
    await new Promise<void>((resolve, reject) => {
      let buffer = '', finished = false, blocked = ''
      const send = (value: unknown) => { if (!socket.destroyed) socket.write(`${JSON.stringify(value)}\n`) }
      const finish = (error?: Error) => {
        if (finished) return
        finished = true
        signal.removeEventListener('abort', abort)
        socket.destroy()
        error ? reject(error) : resolve()
      }
      const abort = () => { send({ type: 'interrupt' }); finish(aborted()) }
      signal.addEventListener('abort', abort, { once: true })
      socket.on('error', error => finish(error))
      socket.on('close', () => finish(new Error('执行连接中断，结果未确认。')))
      socket.on('data', chunk => {
        buffer += chunk.toString()
        let newline
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
          try {
            const envelope = JSON.parse(line)
            if (envelope.type === 'error') { finish(new Error(String(envelope.message))); return }
            if (envelope.type !== 'stdout') continue
            const message = JSON.parse(envelope.line)
            if (message.type === 'control_request') {
              blocked = message.request?.subtype === 'can_use_tool'
                ? '执行需要人工确认，云端定时任务已暂停。请检查执行会话和工具权限后重试。'
                : '执行请求了依赖桌面的能力，云端定时任务已暂停。'
              send({ type: 'stdin', data: `${JSON.stringify({ type: 'control_response', response: {
                subtype: 'error', request_id: message.request_id, error: blocked,
              } })}\n` })
              send({ type: 'interrupt' })
            }
            if (message.type === 'result') {
              const failed = blocked || (message.is_error || String(message.subtype).startsWith('error')
                ? (message.errors?.join('\n') || message.result || 'Agent 执行失败。') : '')
              finish(failed ? new Error(String(failed)) : undefined)
              return
            }
          } catch (error) {
            // A malformed protocol frame cannot count as a successful run.
            finish(error instanceof Error ? error : new Error(String(error)))
            return
          }
        }
      })
      if (signal.aborted) { abort(); return }
      send({ type: 'stdin', data: `${JSON.stringify({ type: 'user', uuid: randomUUID(), session_id: sessionId,
        message: { role: 'user', content: prompt },
      })}\n` })
    })
  } finally {
    if (cancelLock) signal.removeEventListener('abort', cancelLock)
    if (release) release()
    else void pendingLock.then(unlock => unlock())
  }
}
