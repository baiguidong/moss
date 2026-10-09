import { normalizePermissionMode } from './permission-modes.mjs';
import { applyRemoteSessionWorkspace, getSessionWorkspaceRoot, isAccessibleDirectory } from './workspace-paths.mjs';

export function createRemoteRuntimeFactory({
  getSettings,
  buildClaudeSessionConfig,
  emitSessionMeta,
  fetchRemoteDirectSessionInfo,
  getClaudeRuntimeModule,
  isRemoteDirectSessionNotFoundError,
  mossLog,
  normalizePermissionDecision,
  prepareAssistantContextForSessionStart,
  resolveRemoteDirectConnection,
  resumeRemoteDirectSession,
  schedulePersistSession,
  startWorkspaceWatcher,
  syncRemoteSkillsForConnection,
}) {
  function createRemoteDirectRuntime({
    sessionRecord,
    onPermissionRequest,
    onAppEvent,
    onSessionCreated,
    coordinatorMode = false,
    runtimeSystemPrompt = '',
  }) {
    const shouldPersistSessionRecord = Boolean(
      sessionRecord &&
      typeof sessionRecord.id === 'string' &&
      Array.isArray(sessionRecord.history),
    );
    let disposed = false;
    let activeManager = null;
    let managerConnectPromise = null;
    let rejectManagerConnection = null;
    let currentTurn = null;
    let sessionPromise = null;

    const ensureSessionConfig = async () => {
      if (sessionPromise) {
        return sessionPromise;
      }
      if (sessionRecord.deleting || sessionRecord.deleted) {
        throw new Error('会话正在删除，无法连接服务器。');
      }

      sessionPromise = (async () => {
        const mod = await getClaudeRuntimeModule();
        if (
          typeof mod.createDirectConnectSession !== 'function' ||
          typeof mod.DirectConnectSessionManager !== 'function'
        ) {
          throw new Error(
            'electron-direct.mjs did not export direct-connect runtime helpers.',
          );
        }

        const { serverUrl, authToken } = await resolveRemoteDirectConnection();
        try {
          await syncRemoteSkillsForConnection({ serverUrl, authToken });
        } catch (error) {
          // Skill synchronization is additive. A stale/older Server or one bad
          // local skill must not make the entire remote chat unavailable.
          mossLog('warn', 'remote-skills', 'Unable to synchronize desktop skills; continuing without the update', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        await prepareAssistantContextForSessionStart(sessionRecord);
        const localRuntimeConfig = await buildClaudeSessionConfig(
          sessionRecord.workspace,
          sessionRecord,
          runtimeSystemPrompt,
        );
        const runtimeOptions = {
          ...(localRuntimeConfig.customSystemPrompt
            ? { customSystemPrompt: localRuntimeConfig.customSystemPrompt }
            : {}),
          ...(localRuntimeConfig.appendSystemPrompt
            ? { appendSystemPrompt: localRuntimeConfig.appendSystemPrompt }
            : {}),
          webSearch: {
            ...localRuntimeConfig.webSearch,
            // Capability was probed with the desktop model, not the server model.
            nativeCapability: undefined,
          },
          mcpServers: localRuntimeConfig.mcpServers,
          environment: Object.fromEntries(Object.entries(localRuntimeConfig.environment)
            .filter(([key]) => key !== 'MOSS_TRACE_SCOPE')),
          coordinatorMode: coordinatorMode === true,
          agentMailEnabled: localRuntimeConfig.agentMailEnabled === true,
        };
        let created;

        if (sessionRecord.underlyingSessionId) {
          try {
            const remoteSession = await fetchRemoteDirectSessionInfo({
              serverUrl,
              authToken,
              sessionId: sessionRecord.underlyingSessionId,
            });
            const desiredState = typeof remoteSession?.session?.desiredState === 'string'
              ? remoteSession.session.desiredState
              : 'active';

            created = desiredState === 'active'
              ? await mod.attachDirectConnectSession({
                  serverUrl,
                  authToken,
                  sessionId: sessionRecord.underlyingSessionId,
                })
              : await resumeRemoteDirectSession({
                  serverUrl,
                  authToken,
                  sessionId: sessionRecord.underlyingSessionId,
                });
          } catch (error) {
            if (!isRemoteDirectSessionNotFoundError(error)) {
              throw error;
            }
            mossLog('warn', 'session', 'Remote Direct session missing on send', {
              sessionId: sessionRecord.id,
              underlyingSessionId: sessionRecord.underlyingSessionId,
            });
            sessionRecord.underlyingSessionId = null;
            sessionRecord.historyLoadedFromSource = false;
          }
        }

        if (!created) {
          created = await mod.createDirectConnectSession({
            serverUrl,
            authToken,
            permissionMode: normalizePermissionMode(
              sessionRecord.permissionMode,
              getSettings().permissionMode,
            ),
            dangerouslySkipPermissions:
              normalizePermissionMode(sessionRecord.permissionMode, getSettings().permissionMode)
                === 'bypassPermissions',
            assistantName: sessionRecord.assistantName,
            advancedSettings: {
              ...getSettings().advanced,
              moss_response_language: getSettings().language,
              moss_tool_loading: getSettings().toolLoading,
            },
            autoMemory: getSettings().autoMemory,
            sessionMemory: getSettings().sessionMemory,
            runtimeOptions,
          });
        }

        sessionRecord.agentMode = 'remote-direct';
        sessionRecord.resumeReadOnlyReason = null;
        if (created?.config?.sessionId) {
          sessionRecord.underlyingSessionId = created.config.sessionId;
        }
        const workspaceChanged = applyRemoteSessionWorkspace(
          sessionRecord,
          created?.workDir,
        );
        if (workspaceChanged && isAccessibleDirectory(getSessionWorkspaceRoot(sessionRecord))) {
          void startWorkspaceWatcher(sessionRecord);
        }
        if (shouldPersistSessionRecord) {
          sessionRecord.updatedAt = Date.now();
          schedulePersistSession(sessionRecord, true);
          emitSessionMeta(sessionRecord);
        }
        onSessionCreated?.(created);
        return {
          mod,
          config: created.config,
          workDir: created.workDir,
        };
      })().catch((error) => {
        sessionPromise = null;
        throw error;
      });

      return sessionPromise;
    };

    return {
      kind: 'remote-direct',
      coordinatorMode,
      ensureSession: ensureSessionConfig,
      waitForSessionCreation: () => sessionPromise,
      async *send(prompt) {
        if (sessionRecord.deleting || sessionRecord.deleted) {
          throw new Error('会话正在删除，无法发送消息。');
        }
        if (disposed) {
          throw new Error('Remote runtime has been disposed.');
        }
        if (currentTurn) {
          throw new Error('Remote runtime is already processing a request.');
        }

        const queue = [];
        let pendingResolve = null;
        let pendingReject = null;
        let settled = false;
        let pendingError = null;

        const flushMessage = (message) => {
          if (pendingResolve) {
            const resolve = pendingResolve;
            pendingResolve = null;
            pendingReject = null;
            resolve(message);
            return;
          }
          queue.push(message);
        };

        const fail = (error) => {
          if (settled) return;
          settled = true;
          pendingError = error instanceof Error ? error : new Error(String(error));
          if (pendingReject) {
            const reject = pendingReject;
            pendingResolve = null;
            pendingReject = null;
            reject(pendingError);
          }
        };

        const nextMessage = () =>
          new Promise((resolve, reject) => {
            if (queue.length > 0) {
              resolve(queue.shift());
              return;
            }
            if (pendingError) {
              reject(pendingError);
              return;
            }
            pendingResolve = resolve;
            pendingReject = reject;
          });

        let rejectBeforePrompt;
        const beforePromptAbort = new Promise((_, reject) => {
          rejectBeforePrompt = reject;
        });
        const turn = {
          finished: false,
          promptSent: false,
          abortRequested: false,
          flushMessage,
          fail,
          abortBeforePrompt(error) {
            if (turn.promptSent || turn.abortRequested) return;
            turn.abortRequested = true;
            rejectBeforePrompt(error);
          },
        };
        currentTurn = turn;

        const beforePrompt = (promise) => Promise.race([promise, beforePromptAbort]);

        const ensureManager = async (mod, config) => {
          if (activeManager?.isConnected?.()) {
            return activeManager;
          }

          if (managerConnectPromise) {
            await managerConnectPromise;
            if (!activeManager?.isConnected?.()) {
              throw new Error('Remote session failed to connect.');
            }
            return activeManager;
          }

          if (activeManager) {
            throw new Error(
              'Remote session is reconnecting. Wait for it to reconnect before sending a new message.',
            );
          }

          managerConnectPromise = new Promise((resolve, reject) => {
            rejectManagerConnection = reject;
            const manager = new mod.DirectConnectSessionManager(config, {
              onConnected: () => {
                managerConnectPromise = null;
                rejectManagerConnection = null;
                resolve();
              },
              onMessage: (message) => {
                if (!currentTurn) {
                  return;
                }
                currentTurn.flushMessage(message);
                if (message?.type === 'result') {
                  currentTurn.finished = true;
                }
              },
              onPermissionRequest: async (request, requestId) => {
                try {
                  const decision = normalizePermissionDecision(
                    await onPermissionRequest?.(request.tool_name, request.input, {
                      suggestions: request.permission_suggestions,
                      blockedPath: request.blocked_path,
                    }),
                  );
                  manager.respondToPermissionRequest(requestId, decision);
                } catch (error) {
                  manager.respondToPermissionRequest(requestId, {
                    behavior: 'deny',
                    message: error instanceof Error ? error.message : String(error),
                  });
                }
              },
              onAppEvent,
              onReconnecting: () => {
                const turn = currentTurn;
                if (turn && !turn.finished) {
                  turn.fail(new Error(
                    'Remote connection was interrupted. The active turn was canceled; reconnect before sending it again.',
                  ));
                }
              },
              onDisconnected: () => {
                const turn = currentTurn;
                activeManager = null;
                const rejectConnection = rejectManagerConnection;
                rejectManagerConnection = null;
                managerConnectPromise = null;
                rejectConnection?.(new Error('Remote session disconnected before connecting.'));
                if (turn && !turn.finished) {
                  turn.fail(new Error('Remote session disconnected before completion.'));
                }
              },
              onError: (error) => {
                const turn = currentTurn;
                if (managerConnectPromise) {
                  managerConnectPromise = null;
                  rejectManagerConnection = null;
                  reject(error);
                }
                if (turn) {
                  turn.fail(error);
                }
              },
            });

            activeManager = manager;

            try {
              manager.connect();
            } catch (error) {
              activeManager = null;
              managerConnectPromise = null;
              rejectManagerConnection = null;
              reject(error);
            }
          });

          await managerConnectPromise;
          return activeManager;
        };

        try {
          const { mod, config } = await beforePrompt(ensureSessionConfig());
          if (turn.abortRequested) throw new Error('Request interrupted by user.');
          const manager = await beforePrompt(ensureManager(mod, config));
          await beforePrompt(manager.setPermissionMode?.(
            normalizePermissionMode(sessionRecord.permissionMode, getSettings().permissionMode),
          ));
          if (turn.abortRequested) throw new Error('Request interrupted by user.');
          const sent = manager.sendMessage(prompt);
          if (!sent) {
            throw new Error('Failed to send prompt to remote session.');
          }
          turn.promptSent = true;

          while (true) {
            const message = await nextMessage();
            yield message;
            if (message?.type === 'result') {
              break;
            }
          }
          if (pendingError) {
            throw pendingError;
          }
        } finally {
          if (currentTurn === turn) currentTurn = null;
        }
      },
      async abort() {
        const turn = currentTurn;
        if (!turn) return;
        const interrupted = new Error('Request interrupted by user.');
        if (!turn.promptSent) {
          turn.abortBeforePrompt(interrupted);
          if (activeManager) {
            try {
              activeManager.disconnect?.();
            } catch {}
            activeManager = null;
          }
          const rejectConnection = rejectManagerConnection;
          rejectManagerConnection = null;
          managerConnectPromise = null;
          rejectConnection?.(interrupted);
          turn.fail(interrupted);
          return;
        }
        if (!activeManager?.isConnected?.()) {
          try {
            activeManager?.disconnect?.();
          } catch {}
          activeManager = null;
          turn.fail(interrupted);
          return;
        }
        try {
          const result = await activeManager.sendInterrupt();
          if (result?.interrupted === false) {
            // The prompt was still waiting in the Server-side turn queue. Close
            // this attachment so that queued work is discarded before reconnect.
            activeManager.disconnect();
            activeManager = null;
            turn.fail(interrupted);
          }
        } catch {
          // Closing the socket makes the Server interrupt any active turn and
          // prevents a late result from being attributed to the next prompt.
          try {
            activeManager?.disconnect?.();
          } catch {}
          activeManager = null;
          turn.fail(interrupted);
        }
      },
      async setPermissionMode(mode) {
        if (activeManager?.isConnected?.()) {
          await activeManager.setPermissionMode(mode);
        }
      },
      dispose() {
        disposed = true;
        const error = new Error('Remote runtime has been disposed.');
        const rejectConnection = rejectManagerConnection;
        rejectManagerConnection = null;
        managerConnectPromise = null;
        rejectConnection?.(error);
        currentTurn?.abortBeforePrompt?.(error);
        currentTurn?.fail?.(error);
        try {
          activeManager?.disconnect?.();
        } catch {}
        activeManager = null;
        currentTurn = null;
      },
    };
  }

  return {
    createRemoteDirectRuntime,
  };
}
