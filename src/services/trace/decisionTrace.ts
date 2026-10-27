import { resolveTraceCapture } from './traceOutput.js'

export type PermissionDecisionTraceInput = {
  sessionId: string
  turnId: string
  toolUseId: string
  toolName: string
  agentId?: string
  decision: 'accept' | 'reject'
  source: string
  permissionMode?: string
  waitingForUserPermissionMs?: number
}

/**
 * Build the metadata for a permission decision without including tool input.
 * Tool arguments can contain credentials or source code, so they remain out of
 * decision traces unless a separate, explicit trace policy is introduced.
 */
export function createPermissionDecisionTraceMetadata(
  input: PermissionDecisionTraceInput,
): Record<string, unknown> {
  return {
    turnId: input.turnId,
    toolUseId: input.toolUseId,
    toolName: input.toolName,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    decision: input.decision,
    source: input.source,
    ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
    ...(input.waitingForUserPermissionMs !== undefined
      ? { waitingForUserPermissionMs: input.waitingForUserPermissionMs }
      : {}),
  }
}

/** Best-effort event recording; tracing must never affect permission flow. */
export function recordPermissionDecisionTrace(
  input: PermissionDecisionTraceInput,
): void {
  let capture: ReturnType<typeof resolveTraceCapture>
  try {
    capture = resolveTraceCapture()
  } catch {
    return
  }
  if (!capture) return
  try {
    void capture
      .recordEvent({
        sessionId: input.sessionId,
        phase: 'permission_decision',
        severity: input.decision === 'reject' ? 'warning' : 'info',
        metadata: createPermissionDecisionTraceMetadata(input),
      })
      .catch(() => {})
  } catch {
    // Tracing is diagnostic only and must not block tool execution.
  }
}
