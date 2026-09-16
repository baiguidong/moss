import {
  AgentMailApiError,
  pullAgentMail,
  updateAgentMailAcl,
  updateAgentMailMessage,
} from './agent-mail-client.mjs';

function delay(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

function normalizeServerUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function createAgentMailPoller({
  consumerId,
  store,
  getEnabled,
  getConnection,
  runMessage,
  onManualMessage = () => {},
  onStatus = () => {},
  log = () => {},
  api = { pullAgentMail, updateAgentMailMessage, updateAgentMailAcl },
}) {
  let controller = null;
  let loopPromise = null;
  let connection = null;
  let draining = false;
  let drainRequested = false;
  let backoffMs = 1_000;
  let status = { state: 'stopped', error: null, serverUrl: '', pendingManual: 0 };

  const setStatus = (patch) => {
    status = { ...status, ...patch };
    onStatus({ ...status });
  };

  const resolveConnection = async () => {
    if (connection) return connection;
    const resolved = await getConnection();
    connection = {
      ...resolved,
      serverUrl: normalizeServerUrl(resolved?.serverUrl),
      authToken: String(resolved?.authToken || ''),
      mailboxKey: String(resolved?.mailboxKey || normalizeServerUrl(resolved?.serverUrl)),
    };
    if (!connection.serverUrl || !connection.authToken || !connection.mailboxKey) {
      throw new Error('Moss Server authentication is unavailable.');
    }
    const manualRecords = store.listManual(connection.mailboxKey);
    const activeManualRecords = manualRecords.filter((record) => {
      if (!record.message?.expiresAt || Number(record.message.expiresAt) > Date.now()) return true;
      store.finish(connection.mailboxKey, record.messageId, 'failed', 'Agent Mail expired while waiting for approval.');
      return false;
    });
    setStatus({ pendingManual: activeManualRecords.length });
    for (const record of activeManualRecords) {
      onManualMessage(record.message, {
        serverUrl: connection.serverUrl,
        mailboxKey: connection.mailboxKey,
        mailConnection: connection,
        sessionId: record.sessionId,
      });
    }
    void drain();
    return connection;
  };

  const reportTerminal = async (activeConnection, record, action, error) => {
    try {
      await api.updateAgentMailMessage(activeConnection, record.messageId, action, {
        consumerId: record.consumerId,
        leaseToken: record.leaseToken,
        error,
      });
    } catch (reportError) {
      log('warn', 'Unable to report Agent Mail terminal state', {
        messageId: record.messageId,
        error: reportError instanceof Error ? reportError.message : String(reportError),
      });
    }
  };

  const drain = async () => {
    if (draining) {
      drainRequested = true;
      return;
    }
    if (!connection) return;
    draining = true;
    const activeConnection = connection;
    const activeController = controller;
    try {
      while (activeController && !activeController.signal.aborted) {
        const record = store.nextRunnable(activeConnection.mailboxKey);
        if (!record) return;
        try {
          await api.updateAgentMailMessage(activeConnection, record.messageId, 'heartbeat', {
            consumerId: record.consumerId,
            leaseToken: record.leaseToken,
          });
        } catch (error) {
          log('warn', 'Agent Mail lease is unavailable; waiting for redelivery', {
            messageId: record.messageId,
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        store.markRunning(activeConnection.mailboxKey, record.messageId);
        const heartbeat = setInterval(() => {
          void api.updateAgentMailMessage(activeConnection, record.messageId, 'heartbeat', {
            consumerId: record.consumerId,
            leaseToken: record.leaseToken,
          }).catch(() => {});
        }, 30_000);
        heartbeat.unref?.();
        try {
          await runMessage(record.message, {
            serverUrl: activeConnection.serverUrl,
            mailboxKey: activeConnection.mailboxKey,
            mailConnection: activeConnection,
            sessionId: record.sessionId,
          });
          store.finish(activeConnection.mailboxKey, record.messageId, 'completed');
          await reportTerminal(activeConnection, record, 'complete');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          store.finish(activeConnection.mailboxKey, record.messageId, 'failed', message);
          await reportTerminal(activeConnection, record, 'fail', message);
        } finally {
          clearInterval(heartbeat);
        }
      }
    } finally {
      draining = false;
      if (drainRequested) {
        drainRequested = false;
        void drain();
      }
    }
  };

  const handlePulled = async (activeConnection, result) => {
    if (!result?.leaseToken || !Array.isArray(result.messages)) return;
    for (const message of result.messages) {
      let record = store.putLeased(
        activeConnection.mailboxKey,
        consumerId,
        result.leaseToken,
        result.leaseUntil,
        message,
      );
      await api.updateAgentMailMessage(activeConnection, message.messageId, 'accept', {
        consumerId,
        leaseToken: result.leaseToken,
      });
      record = store.markAccepted(activeConnection.mailboxKey, message.messageId, message.deliveryMode);
      if (record.state === 'completed') await reportTerminal(activeConnection, record, 'complete');
      else if (record.state === 'failed') await reportTerminal(activeConnection, record, 'fail', record.error);
      else if (record.state === 'manual') {
        onManualMessage(message, {
          serverUrl: activeConnection.serverUrl,
          mailboxKey: activeConnection.mailboxKey,
          mailConnection: activeConnection,
          sessionId: record.sessionId,
        });
      }
    }
    setStatus({ pendingManual: store.listManual(activeConnection.mailboxKey).length });
    void drain();
  };

  const loop = async () => {
    while (controller && !controller.signal.aborted) {
      if (!getEnabled()) {
        setStatus({ state: 'disabled', error: null });
        await delay(2_000, controller.signal);
        continue;
      }
      try {
        const resolved = await resolveConnection();
        void drain();
        setStatus({ state: 'polling', error: null, serverUrl: resolved.serverUrl });
        const result = await api.pullAgentMail(resolved, {
          consumerId,
          waitMs: 25_000,
          limit: 5,
        }, { signal: controller.signal });
        backoffMs = 1_000;
        await handlePulled(resolved, result);
      } catch (error) {
        if (controller?.signal.aborted || error?.name === 'AbortError') break;
        const standby = error instanceof AgentMailApiError && error.code === 'AGENT_MAIL_CONSUMER_ACTIVE';
        if (error instanceof AgentMailApiError && (error.statusCode === 401 || error.statusCode === 403)) connection = null;
        setStatus({
          state: standby ? 'standby' : 'error',
          error: error instanceof Error ? error.message : String(error),
        });
        await delay(standby ? 10_000 : backoffMs, controller.signal);
        backoffMs = Math.min(30_000, backoffMs * 2);
      }
    }
    setStatus({ state: 'stopped' });
  };

  const start = () => {
    if (loopPromise) return;
    controller = new AbortController();
    loopPromise = loop().finally(() => { loopPromise = null; });
  };

  return {
    start,
    async stop() {
      controller?.abort();
      await loopPromise;
      controller = null;
      connection = null;
    },
    refresh() {
      connection = null;
      controller?.abort();
      if (loopPromise) void loopPromise.finally(start);
      else start();
    },
    async approve(messageId, { trustSender = false } = {}) {
      const resolved = await resolveConnection();
      const current = store.get(resolved.mailboxKey, messageId);
      if (!current || current.state !== 'manual') throw new Error('Agent Mail message is not waiting for approval.');
      if (trustSender) {
        await api.updateAgentMailAcl(resolved, current.message.fromUserId, 'auto');
      }
      const record = store.approve(resolved.mailboxKey, messageId);
      setStatus({ pendingManual: store.listManual(resolved.mailboxKey).length });
      void drain();
      return record;
    },
    async reject(messageId, reason = 'Rejected by mailbox owner.') {
      const resolved = await resolveConnection();
      const record = store.get(resolved.mailboxKey, messageId);
      if (!record || record.state !== 'manual') throw new Error('Agent Mail message is not waiting for approval.');
      store.finish(resolved.mailboxKey, messageId, 'failed', reason);
      await reportTerminal(resolved, record, 'fail', reason);
      setStatus({ pendingManual: store.listManual(resolved.mailboxKey).length });
      return store.get(resolved.mailboxKey, messageId);
    },
    async block(messageId) {
      const resolved = await resolveConnection();
      const record = store.get(resolved.mailboxKey, messageId);
      if (!record || record.state !== 'manual') throw new Error('Agent Mail message is not waiting for approval.');
      await api.updateAgentMailAcl(resolved, record.message.fromUserId, 'blocked');
      store.finish(resolved.mailboxKey, messageId, 'failed', 'Sender blocked by mailbox owner.');
      await reportTerminal(resolved, record, 'fail', 'Sender blocked by mailbox owner.');
      setStatus({ pendingManual: store.listManual(resolved.mailboxKey).length });
      return store.get(resolved.mailboxKey, messageId);
    },
    getStatus() {
      return { ...status };
    },
    listManual() {
      return connection ? store.listManual(connection.mailboxKey) : [];
    },
  };
}
