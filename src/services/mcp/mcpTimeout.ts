export type McpTimeoutReason = 'first_byte' | 'idle_progress' | 'total'

export type McpTimeoutPolicy = {
  firstByteTimeoutMs: number
  idleProgressTimeoutMs: number
  maxTotalTimeoutMs: number
}

export type McpTimeoutState = {
  startedAt: number
  firstByteAt?: number
  lastProgressAt?: number
}

export function nextMcpTimeout(
  policy: McpTimeoutPolicy,
  state: McpTimeoutState,
  now: number,
): { at: number; reason: McpTimeoutReason } {
  const totalAt = state.startedAt + policy.maxTotalTimeoutMs
  if (now >= totalAt) return { at: totalAt, reason: 'total' }
  if (state.firstByteAt === undefined) {
    return {
      at: Math.min(state.startedAt + policy.firstByteTimeoutMs, totalAt),
      reason: 'first_byte',
    }
  }
  const lastProgressAt = state.lastProgressAt ?? state.firstByteAt
  return {
    at: Math.min(lastProgressAt + policy.idleProgressTimeoutMs, totalAt),
    reason: now >= totalAt ? 'total' : 'idle_progress',
  }
}

export class McpToolTimeoutError extends Error {
  readonly reason: McpTimeoutReason

  constructor(serverName: string, toolName: string, reason: McpTimeoutReason, timeoutMs: number) {
    super(
      `MCP server "${serverName}" tool "${toolName}" timed out (${reason}) after ${Math.floor(timeoutMs / 1000)}s`,
    )
    this.name = 'McpToolTimeoutError'
    this.reason = reason
  }
}

export type ElicitationWaitResult<T> =
  | { kind: 'resolved'; value: T }
  | { kind: 'timeout' }
  | { kind: 'aborted' }

/** Race an elicitation response without conflating it with an MCP tool timeout. */
export async function waitForMcpElicitation<T>(params: {
  promise: Promise<T>
  signal: AbortSignal
  timeoutMs: number
}): Promise<ElicitationWaitResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let abortHandler: (() => void) | undefined
  try {
    return await new Promise<ElicitationWaitResult<T>>(resolve => {
      timeoutId = setTimeout(() => resolve({ kind: 'timeout' }), params.timeoutMs)
      abortHandler = () => resolve({ kind: 'aborted' })
      if (params.signal.aborted) {
        resolve({ kind: 'aborted' })
        return
      }
      params.signal.addEventListener('abort', abortHandler, { once: true })
      void params.promise.then(
        value => resolve({ kind: 'resolved', value }),
        () => resolve({ kind: 'aborted' }),
      )
    })
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    if (abortHandler) params.signal.removeEventListener('abort', abortHandler)
  }
}
