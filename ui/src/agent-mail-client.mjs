export class AgentMailApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'AgentMailApiError';
    this.statusCode = statusCode;
    this.code = code || 'AGENT_MAIL_API_ERROR';
  }
}

function normalizeServerUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

async function requestAgentMail({
  serverUrl,
  authToken,
  path,
  method = 'GET',
  body,
  signal,
  fetchImpl = fetch,
}) {
  const baseUrl = normalizeServerUrl(serverUrl);
  if (!baseUrl || !authToken) throw new AgentMailApiError(401, 'AGENT_MAIL_NOT_AUTHENTICATED', 'Moss Server authentication is required.');
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${authToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new AgentMailApiError(0, 'AGENT_MAIL_NETWORK_ERROR', error instanceof Error ? error.message : String(error));
  }
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    throw new AgentMailApiError(
      response.status,
      payload?.code,
      payload?.error || `${response.status} ${response.statusText}`,
    );
  }
  return payload;
}

export function fetchAgentMailCapabilities(connection, options = {}) {
  return requestAgentMail({ ...connection, ...options, path: '/api/v1/bootstrap' });
}

export function searchAgentMailRecipients(connection, query, options = {}) {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  params.set('limit', String(options.limit || 20));
  return requestAgentMail({
    ...connection,
    ...options,
    path: `/api/v1/agent-mail/recipients?${params}`,
  });
}

export function sendAgentMail(connection, input, options = {}) {
  return requestAgentMail({
    ...connection,
    ...options,
    path: '/api/v1/agent-mail/messages',
    method: 'POST',
    body: {
      to_user_id: input.toUserId,
      subject: input.subject,
      content: input.content,
      client_message_id: input.clientMessageId,
      reply_to: input.replyTo,
    },
  });
}

export function pullAgentMail(connection, input, options = {}) {
  return requestAgentMail({
    ...connection,
    ...options,
    path: '/api/v1/agent-mail/pull',
    method: 'POST',
    body: {
      consumer_id: input.consumerId,
      wait_ms: input.waitMs ?? 25_000,
      limit: input.limit ?? 5,
    },
  });
}

export function updateAgentMailMessage(connection, messageId, action, input, options = {}) {
  if (!['accept', 'heartbeat', 'complete', 'fail'].includes(action)) {
    throw new AgentMailApiError(400, 'AGENT_MAIL_INVALID_ACTION', `Unsupported Agent Mail action: ${action}`);
  }
  return requestAgentMail({
    ...connection,
    ...options,
    path: `/api/v1/agent-mail/messages/${encodeURIComponent(messageId)}/${action}`,
    method: 'POST',
    body: {
      consumer_id: input.consumerId,
      lease_token: input.leaseToken,
      ...(input.error ? { error: input.error } : {}),
    },
  });
}

export function updateAgentMailAcl(connection, senderUserId, mode, options = {}) {
  return requestAgentMail({
    ...connection,
    ...options,
    path: `/api/v1/agent-mail/acl/${encodeURIComponent(senderUserId)}`,
    method: 'PUT',
    body: { mode },
  });
}

export function listAgentMail(connection, direction = 'inbox', options = {}) {
  const resolved = direction === 'outbox' ? 'outbox' : 'inbox';
  return requestAgentMail({
    ...connection,
    ...options,
    path: `/api/v1/agent-mail/${resolved}?limit=${Math.min(100, Math.max(1, Number(options.limit) || 50))}`,
  });
}
