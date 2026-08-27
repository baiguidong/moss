import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const DEFAULT_DECISION_TTL_MS = 30 * 60_000;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createDecisionBroker({
  store,
  notificationBroker,
  getSigningSecret,
  resolveDurableDecision = async () => {
    throw new Error('This decision is no longer attached to a live Moss action.');
  },
  onChanged = () => {},
  now = () => Date.now(),
}) {
  const liveHandlers = new Map();
  const expirationTimers = new Map();

  function buildActionToken(decision) {
    const secret = String(getSigningSecret() || '');
    if (!secret) throw new Error('Feishu decision signing secret is unavailable.');
    const expiresAt = Number(decision.expiresAt) || 0;
    const signature = createHmac('sha256', secret)
      .update(`${decision.id}:${expiresAt}`)
      .digest('base64url');
    return `${expiresAt}.${signature}`;
  }

  function clearExpiration(id) {
    const timer = expirationTimers.get(id);
    if (timer) clearTimeout(timer);
    expirationTimers.delete(id);
  }

  function scheduleExpiration(decision) {
    if (!decision.expiresAt) return;
    const delay = Math.max(0, decision.expiresAt - now());
    const timer = setTimeout(() => {
      expirationTimers.delete(decision.id);
      void expire(decision.id, '等待确认已超时。');
    }, delay);
    timer.unref?.();
    expirationTimers.set(decision.id, timer);
  }

  async function expire(decisionId, message, source = 'system') {
    const current = store.getDecision(decisionId);
    if (!current || current.status !== 'pending') return current;
    const expired = store.expireDecision(decisionId, message);
    if (!expired || expired.status !== 'expired') return expired;
    clearExpiration(decisionId);
    const handler = liveHandlers.get(decisionId);
    liveHandlers.delete(decisionId);
    try {
      await handler?.({ allowed: false, expired: true, source, context: null });
    } catch {
      // The durable decision is already expired; runtime cleanup is best effort.
    }
    notificationBroker.resolveDecision(decisionId);
    onChanged({ decision: expired, reason: 'expired' });
    return expired;
  }

  function create({
    sessionId,
    kind,
    title,
    summary,
    desktopMessage,
    desktopDetails,
    desktopOptions = [],
    payload = {},
    expiresAt = now() + DEFAULT_DECISION_TTL_MS,
    handler,
  }) {
    const id = randomUUID();
    const notificationId = `decision:${id}`;
    const unsigned = { id, expiresAt };
    const actionToken = buildActionToken(unsigned);
    if (typeof handler === 'function') liveHandlers.set(id, handler);
    const decision = store.createDecision({
      id,
      sessionId,
      kind,
      mobileTitle: title,
      mobileSummary: summary,
      actionTokenHash: hashToken(actionToken),
      notificationId,
      payload,
      expiresAt,
    });
    notificationBroker.create({
      severity: 'warning',
      source: '待确认',
      title,
      message: desktopMessage || summary,
      details: desktopDetails,
      mobileTitle: title,
      mobileSummary: summary,
      mobilePolicy: 'summary',
      decisionRequestId: id,
      decisionOptions: desktopOptions,
    }, { id: notificationId, now: decision.createdAt });
    scheduleExpiration(decision);
    onChanged({ decision, reason: 'created' });
    return { decision, actionToken };
  }

  async function respond({ decisionId, allowed, source, actionToken, context = null }) {
    const decision = store.getDecision(decisionId);
    if (!decision) throw new Error('Decision request not found.');
    if (source === 'feishu') {
      if (!actionToken || !safeEqual(hashToken(actionToken), decision.actionTokenHash)) {
        throw new Error('Decision action token is invalid.');
      }
    }
    const claimed = store.claimDecision(decisionId, source);
    if (!claimed.claimed) throw new Error('Decision request is no longer pending.');
    clearExpiration(decisionId);
    try {
      const handler = liveHandlers.get(decisionId);
      const resolution = handler
        ? await handler({ allowed: Boolean(allowed), source, context })
        : await resolveDurableDecision(claimed.decision, {
          allowed: Boolean(allowed),
          source,
          context,
        });
      const settled = store.settleDecision(decisionId, {
        status: allowed ? 'resolved' : 'rejected',
        source,
        resolution: resolution || { allowed: Boolean(allowed) },
      });
      liveHandlers.delete(decisionId);
      notificationBroker.resolveDecision(decisionId);
      onChanged({ decision: settled, reason: 'resolved' });
      return settled;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = store.settleDecision(decisionId, {
        status: 'failed', source, error: message,
      });
      liveHandlers.delete(decisionId);
      notificationBroker.resolveDecision(decisionId);
      onChanged({ decision: failed, reason: 'failed' });
      throw error;
    }
  }

  return {
    create,
    respond,
    get(id) {
      return store.getDecision(id);
    },
    getActionToken(id) {
      const decision = store.getDecision(id);
      if (!decision || decision.status !== 'pending') return null;
      return buildActionToken(decision);
    },
    async cancelSession(sessionId, message = 'Decision canceled with its session.', options = {}) {
      const kinds = Array.isArray(options.kinds) ? new Set(options.kinds) : null;
      const decisions = store.listPendingDecisionsForSession(sessionId)
        .filter((decision) => !kinds || kinds.has(decision.kind));
      return Promise.all(decisions.map((decision) => expire(decision.id, message)));
    },
    expireDecision(decisionId, message) {
      return expire(decisionId, message);
    },
  };
}
