const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped']);

export function deriveProjectSessionTaskStatus({
  persistedStatus,
  pendingQuestionCount = 0,
  active = false,
} = {}) {
  if (pendingQuestionCount > 0) return 'waiting_for_user';
  if (active) return 'working';
  return TERMINAL_STATUSES.has(persistedStatus) ? persistedStatus : 'idle';
}

export function shouldRecoverInterruptedProjectTask({
  status,
  sessionUpdatedAt = 0,
  recoveryCutoff = Date.now(),
} = {}) {
  if (!['working', 'waiting_for_user'].includes(status)) return false;
  return (Number(sessionUpdatedAt) || 0) <= recoveryCutoff;
}

export function shouldCancelProjectTaskOnArchive({
  status,
  busy = false,
  activeWorkerCount = 0,
} = {}) {
  return ['working', 'waiting_for_user'].includes(status) ||
    busy || Number(activeWorkerCount) > 0;
}

export async function runProjectFinalizerBestEffort(finalize, onFailure) {
  try {
    return { result: await finalize(), error: null };
  } catch (error) {
    try {
      await onFailure?.(error);
    } catch {}
    return { result: null, error };
  }
}

export async function waitForProjectTaskRunBeforeContinuation(
  activeRun,
  isStopRequested = () => false,
) {
  if (!activeRun) return;
  if (isStopRequested()) {
    throw new Error('任务正在停止，请等待当前运行结束后再继续。');
  }
  await activeRun.catch(() => {});
  if (isStopRequested()) {
    throw new Error('任务已停止，请重新发送消息以继续。');
  }
}
