// Session controls only. Runtime ownership, persistence and decision routing stay
// with Main; these handlers preserve the existing IPC responses and ordering.
export function registerSessionControlIpc({
  ipcMain,
  abortPendingSends = () => {},
  stopComputerUse = async () => {},
  stopAppTasks = async () => {},
  getSessionRecord,
  projectTaskCancellationRequests,
  updateProjectRootTaskLifecycle,
  appendProjectEvent,
  rejectPendingQuestionRequestsForSession,
  schedulePersistSession,
  pendingQuestionRequests,
  respondToPendingQuestionRequest,
  buildAskUserQuestionUpdatedInput,
}) {
  ipcMain.handle('agent:abort', async (_event, { sessionId }) => {
    const sessionRecord = getSessionRecord(sessionId);
    abortPendingSends(sessionId);
    if (sessionRecord.projectId && !sessionRecord.parentSessionId) {
      projectTaskCancellationRequests.add(sessionRecord.id);
    }
    const runtime = sessionRecord.runtime;
    // Trigger the model interrupt before any host cleanup. App/browser task
    // shutdown can wait on an external process; waiting for it first makes the
    // Stop button look ineffective and keeps the model request alive.
    const invoke = operation => {
      try { return Promise.resolve(operation()); }
      catch (error) { return Promise.reject(error); }
    };
    const runtimeAbort = invoke(() => runtime?.abort?.());
    const computerUseStop = invoke(() => stopComputerUse(sessionId));
    const appTaskStop = invoke(() => stopAppTasks(sessionId));
    await Promise.all([runtimeAbort, computerUseStop, appTaskStop]);
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
      permissionDecision: {
        behavior: 'allow',
        updatedInput: buildAskUserQuestionUpdatedInput(pending.input, answers, annotations),
      },
    });
    if (result?.behavior !== 'allow') {
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
