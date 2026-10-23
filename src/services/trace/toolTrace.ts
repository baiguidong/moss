import { resolveTraceCapture } from './traceOutput.js'

export async function* traceToolExecution<Update>(
  tool: { id: string; name: string },
  sessionId: string,
  updates: AsyncIterable<Update>,
): AsyncGenerator<Update, void> {
  const capture = resolveTraceCapture()
  if (!capture) {
    yield* updates
    return
  }
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  const metadata = { toolUseId: tool.id, toolName: tool.name, startedAt }
  const record = (input: Parameters<typeof capture.recordEvent>[0]) => {
    try { void capture.recordEvent(input).catch(() => {}) } catch {}
  }
  record({ sessionId, timestamp: startedAt, phase: 'tool_execution_started', metadata })
  let failed = false
  let completed = false
  try {
    for await (const update of updates) {
      const result = update as { message?: { type?: string; message?: { content?: unknown } } }
      const content = result.message?.message?.content
      if (result.message?.type === 'user' && Array.isArray(content) && content.some(block =>
        block?.type === 'tool_result' && block.tool_use_id === tool.id && block.is_error === true)) failed = true
      yield update
    }
    completed = true
  } catch (error) {
    failed = true
    throw error
  } finally {
    const completedAtMs = Date.now()
    record({ sessionId, timestamp: new Date(completedAtMs).toISOString(),
      phase: 'tool_execution_completed', severity: failed ? 'error' : completed ? 'info' : 'warning',
      metadata: { ...metadata, durationMs: Math.max(0, completedAtMs - startedAtMs),
        status: failed ? 'error' : completed ? 'ok' : 'cancelled' } })
  }
}
