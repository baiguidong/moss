import { parseAppServiceKey } from '../../packages/app-sdk/src/tool-services.mjs';

/** Old users must release removed Apps; new global tools must reach every session. */
export function isSessionAffectedByApp(record, appId, globallyAvailable = false) {
  return !appId || globallyAvailable || record.runtimeToolAppIds?.has(appId)
    || (record.appIds || []).includes(appId)
    || (record.appServiceIds || []).some(key => parseAppServiceKey(key)?.appId === appId);
}

export function scheduleMcpRuntimeReload(
  sessionRecords,
  disposeRuntime,
  shouldDefer = () => false,
) {
  let resetSessionCount = 0;
  let skippedBusySessionCount = 0;

  for (const sessionRecord of sessionRecords) {
    if (sessionRecord.agentMode === 'remote-direct') continue;
    if (!sessionRecord.runtime) continue;
    if (sessionRecord.busy || sessionRecord.preparingPrompt || shouldDefer(sessionRecord)) {
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
    sessionRecord.preparingPrompt ||
    shouldDefer(sessionRecord)
  ) return false;
  sessionRecord.pendingMcpRuntimeReload = false;
  if (!sessionRecord.runtime) return false;
  disposeRuntime(sessionRecord);
  return true;
}
