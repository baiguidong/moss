export function scheduleMcpRuntimeReload(sessionRecords, disposeRuntime) {
  let resetSessionCount = 0;
  let skippedBusySessionCount = 0;

  for (const sessionRecord of sessionRecords) {
    if (sessionRecord.agentMode === 'remote-direct') continue;
    if (!sessionRecord.runtime) continue;
    if (sessionRecord.busy) {
      sessionRecord.pendingMcpRuntimeReload = true;
      skippedBusySessionCount += 1;
      continue;
    }
    sessionRecord.pendingMcpRuntimeReload = false;
    disposeRuntime(sessionRecord);
    resetSessionCount += 1;
  }

  return { resetSessionCount, skippedBusySessionCount };
}

export function applyPendingMcpRuntimeReload(sessionRecord, disposeRuntime, shouldDefer = () => false) {
  if (
    !sessionRecord?.pendingMcpRuntimeReload ||
    sessionRecord.busy ||
    shouldDefer(sessionRecord)
  ) return false;
  sessionRecord.pendingMcpRuntimeReload = false;
  if (!sessionRecord.runtime) return false;
  disposeRuntime(sessionRecord);
  return true;
}
