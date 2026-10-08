// Session controls only. Runtime ownership, persistence and decision routing stay
// with Main; these handlers preserve the existing IPC responses and ordering.
export function registerSessionControlIpc({
  ipcMain,
  getSessionRecord,
  projectTaskCancellationRequests,
  updateProjectRootTaskLifecycle,
  appendProjectEvent,
  rejectPendingQuestionRequestsForSession,
  schedulePersistSession,
  pendingQuestionRequests,
  respondToPendingQuestionRequest,
  isPlainObject,
  buildAskUserQuestionUpdatedInput,
}) {
  ipcMain.handle('agent:abort', async (_event, { sessionId }) => {
    const sessionRecord = getSessionRecord(sessionId);
    const runtime = sessionRecord.runtime;
    const runningWorkflowIds = Object.values(runtime?.getAppState?.()?.tasks || {})
      .filter((task) => task?.type === 'local_workflow' && task?.status === 'running')
      .map((task) => task.id);
    if (sessionRecord.projectId && !sessionRecord.parentSessionId) {
      projectTaskCancellationRequests.add(sessionRecord.id);
    }
    await Promise.resolve(runtime?.abort?.());
    if (typeof runtime?.stopTask === 'function') {
      await Promise.all(runningWorkflowIds.map((taskId) => runtime.stopTask(taskId).catch(() => {})));
    }
    if (sessionRecord.projectId && !sessionRecord.parentSessionId) {
      await updateProjectRootTaskLifecycle(sessionRecord.projectId, sessionRecord.id, {
        status: 'stopped',
        completedAt: Date.now(),
        error: '用户已停止任务。',
      }).catch(() => {});
      await appendProjectEvent(sessionRecord.projectId, {
        type: 'task.stopped',
        summary: `已停止任务：${sessionRecord.title}`,
        actor: 'user',
        targetType: 'task',
        targetId: sessionRecord.id,
      }).catch(() => {});
    }
    await rejectPendingQuestionRequestsForSession(
      sessionRecord.id,
      'Question canceled because the session was aborted.',
    );
    schedulePersistSession(sessionRecord, true);
    return { ok: true };
  });

  ipcMain.handle('agent:answer-question', async (_event, { requestId, sessionId, answers, annotations }) => {
    const pending = pendingQuestionRequests.get(requestId);
    if (!pending) {
      throw new Error('Question request is no longer pending.');
    }
    if (pending.sessionId !== sessionId) {
      throw new Error('Question request does not belong to this session.');
    }

    const result = await respondToPendingQuestionRequest(pending, {
      allowed: true,
      source: 'desktop',
      resolutionAnswers: isPlainObject(answers) ? answers : {},
      permissionDecision: {
        behavior: 'allow',
        updatedInput: buildAskUserQuestionUpdatedInput(pending.input, answers, annotations),
      },
    });
    if (!pending.appDecisionId && result?.behavior !== 'allow') {
      throw new Error(result?.message || 'Question was not executed.');
    }

    return { ok: true };
  });

  ipcMain.handle('agent:reject-question', async (_event, { requestId, sessionId, message }) => {
    const pending = pendingQuestionRequests.get(requestId);
    if (!pending) {
      return { ok: true };
    }
    if (pending.sessionId !== sessionId) {
      throw new Error('Question request does not belong to this session.');
    }

    await respondToPendingQuestionRequest(pending, {
      allowed: false,
      source: 'desktop',
      permissionDecision: {
        behavior: 'deny',
        message: typeof message === 'string' && message.trim()
          ? message.trim()
          : 'User declined to answer questions',
      },
    });

    return { ok: true };
  });
}
