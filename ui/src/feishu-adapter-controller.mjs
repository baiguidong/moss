function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const SAFE_TURN_FAILURE_MESSAGE = 'Moss 会话处理失败，请在桌面端查看详情后重试。';

export function createFeishuAdapterController({
  store,
  resolveIdentity,
  getWritableSession,
  createSession,
  sendPrompt,
  sendAdapterEvent,
  log = () => {},
}) {
  const drains = new Map();

  function getConversation(payload = {}, requestContext = null) {
    const chatId = normalizeText(payload.chatId);
    const openId = normalizeText(payload.openId);
    if (!openId) throw new Error('Feishu user identity is incomplete.');
    if (!chatId) throw new Error('Feishu private-chat identity is incomplete.');
    const identity = resolveIdentity(openId, requestContext);
    return {
      ...identity,
      conversation: store.getOrCreateConversation({
        adapterInstanceId: identity.adapterInstanceId,
        tenantKey: identity.tenantKey,
        chatId,
        pairedOpenId: openId,
      }),
    };
  }

  function deliverTurn(turn, type, payload) {
    const conversation = turn.conversationId ? store.getConversation(turn.conversationId) : null;
    if (!conversation) return false;
    const sent = sendAdapterEvent(type, {
      turnId: turn.id,
      sessionId: turn.sessionId,
      chatId: conversation.chatId,
      ...payload,
    });
    return Boolean(sent);
  }

  function drainSession(sessionId) {
    if (drains.has(sessionId)) return drains.get(sessionId);
    const drain = (async () => {
      while (true) {
        const turn = store.listQueuedTurns().find((entry) => entry.sessionId === sessionId);
        if (!turn) return;
        const session = getWritableSession(sessionId);
        if (!session) {
          const message = 'The selected Moss session is no longer writable.';
          const failed = store.updateTurn(turn.id, { status: 'failed', error: message });
          store.updateEvent(turn.payload.adapterInstanceId, turn.sourceEventId, {
            status: 'failed', sessionId, turnId: turn.id, error: message,
          });
          deliverTurn(failed, 'turn.failed', { message: SAFE_TURN_FAILURE_MESSAGE });
          continue;
        }

        store.updateTurn(turn.id, { status: 'running' });
        store.updateEvent(turn.payload.adapterInstanceId, turn.sourceEventId, {
          status: 'running', sessionId, turnId: turn.id,
        });
        try {
          const result = await sendPrompt(sessionId, turn.prompt);
          const completed = store.updateTurn(turn.id, {
            status: 'completed',
            resultText: result?.assistantText || '',
          });
          store.updateEvent(turn.payload.adapterInstanceId, turn.sourceEventId, {
            status: 'completed', sessionId, turnId: turn.id,
          });
          deliverTurn(completed, 'turn.completed', {
            text: completed.resultText || '处理完成。',
            title: result?.title || session.title,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failed = store.updateTurn(turn.id, { status: 'failed', error: message });
          store.updateEvent(turn.payload.adapterInstanceId, turn.sourceEventId, {
            status: 'failed', sessionId, turnId: turn.id, error: message,
          });
          deliverTurn(failed, 'turn.failed', { message: SAFE_TURN_FAILURE_MESSAGE });
          log('error', `Feishu turn failed (${turn.id}): ${message}`);
        }
      }
    })().finally(() => drains.delete(sessionId));
    drains.set(sessionId, drain);
    return drain;
  }

  async function handleRequest(request, requestContext = null) {
    if (request?.type !== 'chat.message.received') {
      throw new Error(`Unsupported Feishu Adapter request: ${request?.type}`);
    }
    const payload = request?.payload && typeof request.payload === 'object' ? request.payload : {};
    const { adapterInstanceId, conversation } = getConversation(payload, requestContext);

    const eventId = normalizeText(payload.eventId);
    const text = normalizeText(payload.text);
    if (!eventId || !text) throw new Error('Feishu message id and text are required.');
    const claimed = store.claimEvent({
      adapterInstanceId,
      eventId,
      conversationId: conversation.id,
      eventType: 'message',
    });
    if (!claimed.claimed) {
      return {
        duplicate: true,
        sessionId: claimed.event?.sessionId || null,
        turnId: claimed.event?.turnId || null,
        status: claimed.event?.status || 'received',
      };
    }

    // The first message creates the private chat's one fixed Moss session.
    // Later messages can only reuse that persisted mapping; the transport has
    // no API for listing, selecting, replacing or stopping it.
    let session = getWritableSession(conversation.activeSessionId);
    if (!session) {
      session = await createSession();
      store.setActiveSession(conversation.id, session.id);
    }
    const turn = store.enqueueTurn({
      sessionId: session.id,
      conversationId: conversation.id,
      sourceChannel: 'feishu',
      sourceEventId: eventId,
      prompt: text,
      payload: { adapterInstanceId },
    });
    store.updateEvent(adapterInstanceId, eventId, {
      status: 'accepted', sessionId: session.id, turnId: turn.id,
    });
    void drainSession(session.id);
    return { accepted: true, queued: true, turnId: turn.id, session };
  }

  function onReady() {
    for (const turn of store.listQueuedTurns()) void drainSession(turn.sessionId);
    for (const turn of store.listPendingTurnDeliveries()) {
      deliverTurn(
        turn,
        turn.status === 'completed' ? 'turn.completed' : 'turn.failed',
        turn.status === 'completed'
          ? { text: turn.resultText || '处理完成。' }
          : { message: SAFE_TURN_FAILURE_MESSAGE },
      );
    }
    return { clientOnline: true };
  }

  return { handleRequest, onReady };
}
