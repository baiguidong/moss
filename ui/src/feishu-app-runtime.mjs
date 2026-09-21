import {
  CHANNEL_HOST_METHODS,
} from '../../packages/app-sdk/src/index.mjs';
import { defaultInstanceId } from '../../packages/app-runtime/src/index.mjs';

export const FEISHU_APP_ID = 'moss.feishu';
export const FEISHU_APP_INSTANCE_ID = defaultInstanceId(FEISHU_APP_ID);
export const FEISHU_APP_MIGRATION_VERSION = 1;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))]
    : [];
}

function normalizePairedUsers(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const userId = String(entry.userId || '').trim();
    if (!userId) return [];
    return [{
      userId,
      displayName: text(entry.displayName) || 'Feishu User',
      pairedAt: Number(entry.pairedAt) || 0,
    }];
  });
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isFeishuLegacyFallbackEnabled(env = process.env) {
  return env.MOSS_FEISHU_LEGACY_ADAPTER === '1';
}

export function resolveFeishuChannelIdentity(configuration, externalUserId) {
  const feishu = isRecord(configuration) ? configuration : {};
  const appId = text(feishu.appId);
  const userId = text(externalUserId);
  if (!appId) throw new Error('Feishu Adapter is not configured.');
  const authorized = normalizePairedUsers(feishu.pairedUsers)
    .some((entry) => entry.userId === userId)
    || normalizeStringList(feishu.allowedUsers).includes(userId);
  if (!userId || !authorized) throw new Error('Feishu user is not paired with this Moss client.');
  return { adapterInstanceId: `feishu:${appId}`, tenantKey: appId };
}

export function claimFeishuPairingEvent(store, {
  adapterInstanceId,
  eventId,
  knownUser = false,
} = {}) {
  const normalizedAdapterInstanceId = text(adapterInstanceId);
  const normalizedEventId = text(eventId);
  const existingEvent = normalizedAdapterInstanceId && normalizedEventId
    ? store.getEvent(normalizedAdapterInstanceId, normalizedEventId)
    : null;

  if (existingEvent?.eventType !== undefined && existingEvent.eventType !== 'pairing') {
    return { proceed: false, result: { paired: false, duplicate: true } };
  }
  if (existingEvent && existingEvent.status !== 'received') {
    return {
      proceed: false,
      result: {
        paired: Boolean(knownUser && existingEvent.status === 'completed'),
        alreadyPaired: Boolean(knownUser),
        duplicate: true,
        conversationId: existingEvent.conversationId || null,
      },
    };
  }
  // A known user must not claim this event as pairing: the Backend will pass
  // the same event through as a normal message after refreshing its auth set.
  if (knownUser) return { proceed: true, existingEvent };
  if (!normalizedAdapterInstanceId) {
    return { proceed: false, result: { paired: false } };
  }
  if (!normalizedEventId) return { proceed: true, existingEvent: null };

  const claim = existingEvent
    ? { claimed: false, event: existingEvent }
    : store.claimEvent({
        adapterInstanceId: normalizedAdapterInstanceId,
        eventId: normalizedEventId,
        conversationId: null,
        eventType: 'pairing',
      });
  if (
    !claim.claimed
    && (claim.event?.eventType !== 'pairing' || claim.event?.status !== 'received')
  ) {
    return { proceed: false, result: { paired: false, duplicate: true } };
  }
  return { proceed: true, existingEvent: claim.event || null };
}

export function hasFeishuAppMigrationMarker(adapters) {
  return Number(adapters?.feishu?.appMigrationVersion) >= FEISHU_APP_MIGRATION_VERSION;
}

export function withFeishuAppMigrationMarker(adapters) {
  const source = isRecord(adapters) ? adapters : {};
  const feishu = isRecord(source.feishu) ? source.feishu : {};
  return {
    ...source,
    feishu: {
      ...feishu,
      appMigrationVersion: FEISHU_APP_MIGRATION_VERSION,
    },
  };
}

export function splitLegacyFeishuAppConfiguration(adapters) {
  const source = isRecord(adapters) ? adapters : {};
  const feishu = isRecord(source.feishu) ? source.feishu : {};
  const config = {
    appId: text(feishu.appId),
    streamingCard: Boolean(feishu.streamingCard),
    allowedUsers: normalizeStringList(feishu.allowedUsers),
    pairedUsers: normalizePairedUsers(feishu.pairedUsers),
    pairing: isRecord(source.pairing) ? {
      code: text(source.pairing.code) || null,
      expiresAt: Number(source.pairing.expiresAt) || null,
      createdAt: Number(source.pairing.createdAt) || null,
    } : { code: null, expiresAt: null, createdAt: null },
  };
  const secrets = {
    appSecret: typeof feishu.appSecret === 'string' ? feishu.appSecret : '',
    encryptKey: typeof feishu.encryptKey === 'string' ? feishu.encryptKey : '',
    verificationToken: typeof feishu.verificationToken === 'string' ? feishu.verificationToken : '',
  };
  return {
    config,
    secrets,
    configured: Boolean(config.appId && secrets.appSecret),
  };
}

export function mapChannelRequestToLegacy(method, input = {}) {
  const identity = {
    openId: text(input.externalUserId),
    ...(text(input.externalConversationId) ? { chatId: text(input.externalConversationId) } : {}),
    ...(text(input.externalEventId) ? { eventId: text(input.externalEventId) } : {}),
  };
  switch (method) {
    case 'connection.update':
      return {
        type: 'adapter.connection',
        payload: {
          connected: Boolean(input.connected),
          ...(typeof input.error === 'string' ? { error: input.error } : {}),
        },
      };
    case 'pairing.attempt':
      return {
        type: 'pairing.attempt',
        payload: {
          ...identity,
          code: text(input.code),
          ...(text(input.displayName) ? { displayName: text(input.displayName) } : {}),
        },
      };
    case 'conversation.list':
    case 'conversation.current':
    case 'conversation.select':
    case 'session.abort':
      return {
        type: method,
        payload: {
          ...identity,
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.page !== undefined ? { page: input.page } : {}),
          ...(input.pageSize !== undefined ? { pageSize: input.pageSize } : {}),
          ...(input.query !== undefined ? { query: input.query } : {}),
          ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        },
      };
    case 'conversation.create':
      return {
        type: 'conversation.new',
        payload: { ...identity, ...(input.title !== undefined ? { title: input.title } : {}) },
      };
    case 'message.receive':
      return {
        type: 'chat.message.received',
        payload: {
          ...identity,
          ...(typeof input.text === 'string' ? { text: input.text } : {}),
          ...(Array.isArray(input.attachments) ? { attachments: input.attachments } : {}),
        },
      };
    case 'delivery.ack':
      if (input.kind === 'turn') {
        return {
          type: 'turn.delivery.ack',
          payload: {
            turnId: text(input.deliveryId),
            chatId: text(input.externalConversationId),
            ok: input.ok !== false,
            ...(typeof input.error === 'string' ? { error: input.error } : {}),
          },
        };
      }
      return {
        type: 'delivery.ack',
        payload: {
          deliveryId: text(input.deliveryId),
          ok: input.ok !== false,
          ...(text(input.externalMessageId) ? { messageId: text(input.externalMessageId) } : {}),
          ...(text(input.externalCardId) ? { cardId: text(input.externalCardId) } : {}),
          ...(typeof input.error === 'string' ? { error: input.error } : {}),
        },
      };
    case 'decision.respond':
      return {
        type: 'decision.respond',
        payload: {
          ...identity,
          decisionId: text(input.decisionId),
          actionToken: text(input.actionToken),
          allowed: Boolean(input.allowed),
        },
      };
    default:
      throw new Error(`Unsupported Feishu Channel method: ${method}`);
  }
}

export function createFeishuChannelHandlers({ handleRequest, allowRequest = () => true }) {
  if (typeof handleRequest !== 'function') throw new TypeError('handleRequest is required');
  return Object.fromEntries(CHANNEL_HOST_METHODS.map((method) => [method, async (input, context) => {
    if (
      context.appId !== FEISHU_APP_ID
      || context.instanceId !== FEISHU_APP_INSTANCE_ID
      || !allowRequest(method, input, context)
    ) {
      throw new Error('This Channel Host handler is reserved for the moss.feishu App.');
    }
    return handleRequest(mapChannelRequestToLegacy(method, input), context);
  }]));
}

export function mapLegacyFeishuEventToChannel(type, payload = {}) {
  if (!['turn.accepted', 'turn.output', 'turn.completed', 'turn.failed', 'notification.deliver', 'decision.resolved'].includes(type)) {
    throw new Error(`Unsupported Feishu Adapter event: ${type}`);
  }
  const source = isRecord(payload) ? payload : {};
  const { chatId, ...data } = source;
  if (type.startsWith('turn.')) {
    return {
      name: type,
      data: { ...data, externalConversationId: text(chatId) },
      eventId: `${type}:${text(source.turnId)}`,
    };
  }
  if (type === 'notification.deliver') {
    return {
      name: type,
      data: { ...data, externalConversationId: text(chatId) },
      eventId: `notification:${text(source.deliveryId)}`,
    };
  }
  const decisionId = text(source.decisionId || source.decision?.id);
  return {
    name: type,
    data: { ...data, decisionId },
    eventId: `decision:${decisionId}:${text(source.reason || source.decision?.status) || 'resolved'}`,
  };
}

export async function publishFeishuAppEvent(runtime, type, payload, options = {}) {
  if (!runtime) throw new Error('Desktop App Runtime is unavailable.');
  const event = mapLegacyFeishuEventToChannel(type, payload);
  return runtime.publishChannelEvent(
    FEISHU_APP_ID,
    FEISHU_APP_INSTANCE_ID,
    event.name,
    event.data,
    { eventId: event.eventId, ...options },
  );
}

export function getFeishuAppProcessStatus(runtime) {
  const installation = runtime?.installations?.get(FEISHU_APP_ID);
  const instance = runtime?.instances?.get(FEISHU_APP_INSTANCE_ID);
  if (!installation || !instance) return null;
  const deployment = runtime.localDeployment?.(FEISHU_APP_ID, FEISHU_APP_INSTANCE_ID);
  const processStatus = deployment ? runtime.supervisor?.status(deployment.key) : null;
  const enabled = Boolean(installation.enabled && instance.enabled);
  const state = processStatus?.state || 'stopped';
  return {
    status: !enabled ? 'disabled' : state === 'error' || state === 'crash-loop' ? 'error' : state === 'stopped' ? 'stopped' : 'running',
    pid: processStatus?.pid || null,
    bridgeReady: state === 'running',
    enabled,
    ...(processStatus?.lastError ? { error: processStatus.lastError } : {}),
  };
}

export function isFeishuAppReady(runtime, transportStatus) {
  const status = getFeishuAppProcessStatus(runtime);
  return Boolean(status?.enabled && status.bridgeReady && transportStatus?.connected);
}

export function shouldUseFeishuAppStatus({
  appMode = false,
  appEnabled = false,
  legacyFallback = false,
  legacyPid = null,
} = {}) {
  return Boolean(!legacyFallback && !legacyPid && (appMode || appEnabled));
}

export async function configureFeishuAppFromLegacy(runtime, adapters, { enable = false } = {}) {
  if (!runtime) return { available: false, configured: false, changed: false };
  const app = await runtime.getApp(FEISHU_APP_ID).catch(() => null);
  const instance = app?.instances?.find((entry) => entry.id === FEISHU_APP_INSTANCE_ID);
  if (!app || !instance) return { available: false, configured: false, changed: false };
  const desired = splitLegacyFeishuAppConfiguration(adapters);
  if (!desired.configured) return { available: true, configured: false, changed: false, app, instance };

  const currentSecrets = await runtime.credentials.get(FEISHU_APP_ID, FEISHU_APP_INSTANCE_ID);
  let changed = false;
  if (!sameJson(instance.config || {}, desired.config) || !sameJson(currentSecrets || {}, desired.secrets)) {
    await runtime.updateInstance(FEISHU_APP_ID, FEISHU_APP_INSTANCE_ID, {
      config: desired.config,
      secrets: desired.secrets,
    });
    changed = true;
  }

  const requestedGrants = app.manifest?.permissions || [];
  if (!sameJson([...(app.installation.grants || [])].sort(), [...requestedGrants].sort())) {
    await runtime.setAppGrants(FEISHU_APP_ID, requestedGrants);
    changed = true;
  }
  if (enable) {
    const currentInstance = runtime.instances.get(FEISHU_APP_INSTANCE_ID);
    if (!currentInstance?.enabled) {
      await runtime.setInstanceEnabled(FEISHU_APP_ID, FEISHU_APP_INSTANCE_ID, true);
      changed = true;
    }
    const currentInstallation = runtime.installations.get(FEISHU_APP_ID);
    if (!currentInstallation?.enabled) {
      await runtime.setAppEnabled(FEISHU_APP_ID, true);
      changed = true;
    }
  }
  return {
    available: true,
    configured: true,
    changed,
    app: await runtime.getApp(FEISHU_APP_ID),
    instance: runtime.instances.get(FEISHU_APP_INSTANCE_ID),
  };
}

export async function persistFeishuAppAuthorization(runtime, adapters) {
  if (!runtime) return false;
  const persist = async () => {
    const instance = runtime.instances?.get(FEISHU_APP_INSTANCE_ID);
    if (!instance || instance.appId !== FEISHU_APP_ID) return false;
    const desired = splitLegacyFeishuAppConfiguration(adapters).config;
    const config = {
      ...(instance.config || {}),
      allowedUsers: desired.allowedUsers,
      pairedUsers: desired.pairedUsers,
      pairing: desired.pairing,
    };
    if (sameJson(instance.config || {}, config)) return false;
    await runtime.instances.update(FEISHU_APP_INSTANCE_ID, { config });
    const deployment = runtime.localDeployment?.(FEISHU_APP_ID, FEISHU_APP_INSTANCE_ID);
    if (deployment && typeof runtime.prepareDeployment === 'function') {
      await runtime.prepareDeployment(deployment);
    }
    runtime.publishRuntimeEvent?.({
      type: 'instance-changed',
      appId: FEISHU_APP_ID,
      instanceId: FEISHU_APP_INSTANCE_ID,
    });
    return true;
  };
  return typeof runtime.transitionApp === 'function'
    ? runtime.transitionApp(FEISHU_APP_ID, persist)
    : persist();
}
