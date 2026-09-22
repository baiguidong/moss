import { createHash, randomUUID } from 'node:crypto';
import { APP_ERROR_CODES, AppServiceError } from '../../packages/app-sdk/src/index.mjs';

export const DEFAULT_AGENT_CHANNEL_POLICY = Object.freeze({
  replyMode: 'human_only',
  agentId: null,
  permissionMode: 'default',
  resources: Object.freeze({ tools: Object.freeze([]), skills: Object.freeze([]), connectors: Object.freeze([]) }),
  session: Object.freeze({ mode: 'rotating', rotateAfterTurns: 24 }),
  proactive: Object.freeze({ enabled: false, maxConsecutiveReplies: 1, cooldownMs: 30_000 }),
});

const REPLY_MODES = new Set(['human_only', 'ai_auto', 'ai_draft_review', 'mention_only', 'inherit']);
const SESSION_MODES = new Set(['fixed', 'rotating', 'new_each_turn']);
const PERMISSION_MODES = new Set(['default', 'acceptEdits', 'dontAsk']);
const TURN_TRANSITIONS = Object.freeze({
  received: new Set(['human', 'queued', 'failed', 'cancelled']),
  queued: new Set(['running', 'failed', 'cancelled']),
  running: new Set(['awaiting_review', 'completed', 'failed', 'cancelled']),
  awaiting_review: new Set(['completed', 'rejected', 'cancelled']),
  human: new Set(['completed', 'rejected']),
  completed: new Set(['cancelled']),
  rejected: new Set(),
  failed: new Set(),
  cancelled: new Set(),
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function text(value, field, { optional = false, maxLength = 512 } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized && optional) return '';
  if (!normalized || normalized.length > maxLength) throw new Error(`Invalid ${field}.`);
  return normalized;
}

function uniqueStrings(value, field) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 256) throw new Error(`${field} must be an array or null.`);
  const result = [];
  const seen = new Set();
  for (const item of value) {
    const normalized = text(item, field, { maxLength: 256 });
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function boundedInteger(value, field, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function normalizeBindingPatch(value, { member = false } = {}) {
  if (!isRecord(value)) throw new Error('Agent Channel binding patch must be an object.');
  const result = {};
  if (Object.hasOwn(value, 'inheritDefault')) {
    if (typeof value.inheritDefault !== 'boolean') throw new Error('Invalid Agent Channel inheritance mode.');
    result.inheritDefault = value.inheritDefault;
  }
  if (Object.hasOwn(value, 'replyMode')) {
    if (!REPLY_MODES.has(value.replyMode) || (!member && value.replyMode === 'inherit')) {
      throw new Error('Invalid Agent Channel reply mode.');
    }
    result.replyMode = value.replyMode;
  }
  if (Object.hasOwn(value, 'agentId')) {
    result.agentId = value.agentId === null
      ? null
      : text(value.agentId, 'agentId', { maxLength: 128 });
  }
  if (Object.hasOwn(value, 'permissionMode')) {
    if (value.permissionMode !== null && !PERMISSION_MODES.has(value.permissionMode)) {
      throw new Error('Invalid Agent Channel permission mode.');
    }
    result.permissionMode = value.permissionMode;
  }
  if (Object.hasOwn(value, 'resources')) {
    if (value.resources === null) {
      result.resources = null;
    } else {
      if (!isRecord(value.resources)) throw new Error('Agent Channel resources must be an object or null.');
      result.resources = {};
      for (const key of ['tools', 'skills', 'connectors']) {
        if (Object.hasOwn(value.resources, key)) {
          result.resources[key] = uniqueStrings(value.resources[key], `resources.${key}`);
        }
      }
    }
  }
  if (Object.hasOwn(value, 'session')) {
    if (value.session === null) {
      result.session = null;
    } else {
      if (!isRecord(value.session)) throw new Error('Agent Channel session policy must be an object or null.');
      result.session = {};
      if (Object.hasOwn(value.session, 'mode')) {
        if (!SESSION_MODES.has(value.session.mode)) throw new Error('Invalid Agent Channel session mode.');
        result.session.mode = value.session.mode;
      }
      if (Object.hasOwn(value.session, 'rotateAfterTurns')) {
        result.session.rotateAfterTurns = boundedInteger(
          value.session.rotateAfterTurns,
          'session.rotateAfterTurns',
          1,
          1000,
        );
      }
    }
  }
  if (Object.hasOwn(value, 'proactive')) {
    if (value.proactive === null) {
      result.proactive = null;
    } else {
      if (!isRecord(value.proactive)) throw new Error('Agent Channel proactive policy must be an object or null.');
      result.proactive = {};
      if (Object.hasOwn(value.proactive, 'enabled')) {
        if (typeof value.proactive.enabled !== 'boolean') throw new Error('proactive.enabled must be a boolean.');
        result.proactive.enabled = value.proactive.enabled;
      }
      if (Object.hasOwn(value.proactive, 'maxConsecutiveReplies')) {
        result.proactive.maxConsecutiveReplies = boundedInteger(
          value.proactive.maxConsecutiveReplies,
          'proactive.maxConsecutiveReplies',
          1,
          20,
        );
      }
      if (Object.hasOwn(value.proactive, 'cooldownMs')) {
        result.proactive.cooldownMs = boundedInteger(
          value.proactive.cooldownMs,
          'proactive.cooldownMs',
          0,
          86_400_000,
        );
      }
    }
  }
  return result;
}

function mergeNested(base, override, keys) {
  if (override === null || override === undefined) return { ...base };
  return Object.fromEntries(keys.map((key) => [
    key,
    Object.hasOwn(override, key) && override[key] !== null ? override[key] : base[key],
  ]));
}

function mergeResources(base, override) {
  if (override === null || override === undefined) return { ...base };
  return Object.fromEntries(['tools', 'skills', 'connectors'].map((key) => [
    key,
    Object.hasOwn(override, key) ? override[key] : base[key],
  ]));
}

function narrowResources(base, override) {
  if (override === null || override === undefined) return { ...base };
  return Object.fromEntries(['tools', 'skills', 'connectors'].map((key) => {
    if (!Object.hasOwn(override, key) || override[key] === null) return [key, base[key]];
    if (base[key] === null) return [key, override[key]];
    const allowed = new Set(Array.isArray(base[key]) ? base[key] : []);
    return [key, override[key].filter((value) => allowed.has(value))];
  }));
}

function narrowPermissionMode(base, override) {
  if (!override) return base;
  const safetyRank = { dontAsk: 0, default: 1, acceptEdits: 2 };
  return safetyRank[override] < safetyRank[base] ? override : base;
}

function narrowProactive(base, override) {
  if (override === null || override === undefined) return { ...base };
  return {
    enabled: Object.hasOwn(override, 'enabled') ? base.enabled && override.enabled : base.enabled,
    maxConsecutiveReplies: Object.hasOwn(override, 'maxConsecutiveReplies')
      ? Math.min(base.maxConsecutiveReplies, override.maxConsecutiveReplies)
      : base.maxConsecutiveReplies,
    cooldownMs: Object.hasOwn(override, 'cooldownMs')
      ? Math.max(base.cooldownMs, override.cooldownMs)
      : base.cooldownMs,
  };
}

function mergePolicy(defaults, conversation, member) {
  const base = {
    ...DEFAULT_AGENT_CHANNEL_POLICY,
    ...(isRecord(defaults) ? defaults : {}),
    resources: {
      ...DEFAULT_AGENT_CHANNEL_POLICY.resources,
      ...(isRecord(defaults?.resources) ? defaults.resources : {}),
    },
    session: {
      ...DEFAULT_AGENT_CHANNEL_POLICY.session,
      ...(isRecord(defaults?.session) ? defaults.session : {}),
    },
    proactive: {
      ...DEFAULT_AGENT_CHANNEL_POLICY.proactive,
      ...(isRecord(defaults?.proactive) ? defaults.proactive : {}),
    },
  };
  const apply = (target, source, isMember) => {
    if (!isRecord(source)) return target;
    const next = { ...target };
    if (source.replyMode && (!isMember || source.replyMode !== 'inherit')) next.replyMode = source.replyMode;
    if (Object.hasOwn(source, 'agentId') && source.agentId !== null) next.agentId = source.agentId;
    if (Object.hasOwn(source, 'permissionMode') && source.permissionMode !== null) {
      next.permissionMode = isMember
        ? narrowPermissionMode(target.permissionMode, source.permissionMode)
        : source.permissionMode;
    }
    next.resources = isMember
      ? narrowResources(target.resources, source.resources)
      : mergeResources(target.resources, source.resources);
    next.session = mergeNested(target.session, source.session, ['mode', 'rotateAfterTurns']);
    next.proactive = isMember
      ? narrowProactive(target.proactive, source.proactive)
      : mergeNested(target.proactive, source.proactive, ['enabled', 'maxConsecutiveReplies', 'cooldownMs']);
    return next;
  };
  return apply(apply(base, conversation, false), member, true);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fingerprint(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function createAgentChannelStore(db, { now = () => Date.now() } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_channel_bindings (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      external_conversation_id TEXT NOT NULL,
      external_member_id TEXT NOT NULL DEFAULT '',
      policy_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(app_id, instance_id, external_conversation_id, external_member_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_channel_bindings_scope
      ON agent_channel_bindings(app_id, instance_id, external_conversation_id);

    CREATE TABLE IF NOT EXISTS agent_channel_conversations (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      external_conversation_id TEXT NOT NULL,
      active_session_id TEXT,
      turn_count INTEGER NOT NULL DEFAULT 0,
      context_generation INTEGER NOT NULL DEFAULT 0,
      continuity_summary TEXT,
      last_agent_reply_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(app_id, instance_id, external_conversation_id)
    );

    CREATE TABLE IF NOT EXISTS agent_channel_turns (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      external_conversation_id TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      external_event_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'human',
      hop INTEGER NOT NULL DEFAULT 0,
      fingerprint TEXT NOT NULL,
      session_id TEXT,
      status TEXT NOT NULL,
      reply_mode TEXT NOT NULL,
      policy_json TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}',
      result_text TEXT,
      reviewed_text TEXT,
      error TEXT,
      delivered_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(app_id, instance_id, external_event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_channel_turns_queue
      ON agent_channel_turns(status, session_id, created_at);

    CREATE TABLE IF NOT EXISTS agent_channel_observations (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      external_conversation_id TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      external_event_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      consumed_at INTEGER,
      UNIQUE(app_id, instance_id, external_event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_channel_observations_pending
      ON agent_channel_observations(app_id, instance_id, external_conversation_id, consumed_at, created_at);
  `);

  db.prepare(`
    UPDATE agent_channel_turns
    SET status = 'failed', error = 'Moss exited while this turn was running.', updated_at = ?
    WHERE status = 'running'
  `).run(now());

  const selectBinding = db.prepare(`
    SELECT * FROM agent_channel_bindings
    WHERE app_id = ? AND instance_id = ? AND external_conversation_id = ? AND external_member_id = ?
  `);
  const insertBinding = db.prepare(`
    INSERT INTO agent_channel_bindings (
      id, app_id, instance_id, external_conversation_id, external_member_id,
      policy_json, revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const updateBinding = db.prepare(`
    UPDATE agent_channel_bindings
    SET policy_json = ?, revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ?
  `);
  const deleteBinding = db.prepare(`
    DELETE FROM agent_channel_bindings
    WHERE app_id = ? AND instance_id = ? AND external_conversation_id = ? AND external_member_id = ?
  `);
  const listBindings = db.prepare(`
    SELECT * FROM agent_channel_bindings
    WHERE app_id = ? AND instance_id = ? AND external_conversation_id = ?
    ORDER BY external_member_id ASC
  `);

  const selectConversation = db.prepare(`
    SELECT * FROM agent_channel_conversations
    WHERE app_id = ? AND instance_id = ? AND external_conversation_id = ?
  `);
  const selectConversationById = db.prepare('SELECT * FROM agent_channel_conversations WHERE id = ?');
  const insertConversation = db.prepare(`
    INSERT OR IGNORE INTO agent_channel_conversations (
      id, app_id, instance_id, external_conversation_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateConversationSession = db.prepare(`
    UPDATE agent_channel_conversations
    SET active_session_id = ?, context_generation = context_generation + ?,
        continuity_summary = ?, turn_count = ?, updated_at = ?
    WHERE id = ?
  `);
  const recordConversationReply = db.prepare(`
    UPDATE agent_channel_conversations
    SET turn_count = turn_count + 1, last_agent_reply_at = ?, updated_at = ?
    WHERE id = ?
  `);

  const selectTurn = db.prepare('SELECT * FROM agent_channel_turns WHERE id = ?');
  const selectTurnByEvent = db.prepare(`
    SELECT * FROM agent_channel_turns WHERE app_id = ? AND instance_id = ? AND external_event_id = ?
  `);
  const listTurnsByScope = db.prepare(`
    SELECT * FROM agent_channel_turns
    WHERE app_id = ? AND instance_id = ?
    ORDER BY created_at DESC
  `);
  const insertTurn = db.prepare(`
    INSERT OR IGNORE INTO agent_channel_turns (
      id, app_id, instance_id, external_conversation_id, external_user_id,
      external_event_id, source, hop, fingerprint, session_id, status, reply_mode,
      policy_json, input_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?, ?)
  `);
  const updateTurn = db.prepare(`
    UPDATE agent_channel_turns
    SET session_id = COALESCE(?, session_id), status = ?, result_text = ?,
        reviewed_text = ?, error = ?, input_json = ?,
        delivered_at = ?, updated_at = ?
    WHERE id = ?
  `);
  const listQueuedTurns = db.prepare(`
    SELECT * FROM agent_channel_turns WHERE status = 'queued' ORDER BY created_at ASC
  `);
  const listPendingTurnDeliveries = db.prepare(`
    SELECT * FROM agent_channel_turns
    WHERE status IN ('awaiting_review', 'completed', 'failed') AND delivered_at IS NULL
    ORDER BY updated_at ASC
  `);
  const cancelQueuedTurns = db.prepare(`
    UPDATE agent_channel_turns
    SET status = 'cancelled', error = ?, updated_at = ?
    WHERE session_id = ? AND status = 'queued'
  `);
  const selectObservationByEvent = db.prepare(`
    SELECT * FROM agent_channel_observations
    WHERE app_id = ? AND instance_id = ? AND external_event_id = ?
  `);
  const insertObservation = db.prepare(`
    INSERT OR IGNORE INTO agent_channel_observations (
      id, app_id, instance_id, external_conversation_id, external_user_id,
      external_event_id, text, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const listPendingObservations = db.prepare(`
    SELECT * FROM agent_channel_observations
    WHERE app_id = ? AND instance_id = ? AND external_conversation_id = ? AND consumed_at IS NULL
    ORDER BY created_at ASC
    LIMIT ?
  `);
  const consumeObservation = db.prepare(`
    UPDATE agent_channel_observations SET consumed_at = ?
    WHERE id = ? AND consumed_at IS NULL
  `);
  const pruneObservations = db.prepare(`
    DELETE FROM agent_channel_observations
    WHERE app_id = ? AND instance_id = ? AND external_conversation_id = ?
      AND id NOT IN (
        SELECT id FROM agent_channel_observations
        WHERE app_id = ? AND instance_id = ? AND external_conversation_id = ?
        ORDER BY created_at DESC
        LIMIT 200
      )
  `);

  function normalizeBinding(row) {
    if (!row) return null;
    return {
      id: row.id,
      appId: row.app_id,
      instanceId: row.instance_id,
      externalConversationId: row.external_conversation_id,
      externalMemberId: row.external_member_id || null,
      policy: parseJson(row.policy_json, {}),
      revision: Number(row.revision) || 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function normalizeConversation(row) {
    if (!row) return null;
    return {
      id: row.id,
      appId: row.app_id,
      instanceId: row.instance_id,
      externalConversationId: row.external_conversation_id,
      activeSessionId: row.active_session_id || null,
      turnCount: Number(row.turn_count) || 0,
      contextGeneration: Number(row.context_generation) || 0,
      continuitySummary: row.continuity_summary || '',
      lastAgentReplyAt: row.last_agent_reply_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function normalizeTurn(row) {
    if (!row) return null;
    return {
      id: row.id,
      appId: row.app_id,
      instanceId: row.instance_id,
      externalConversationId: row.external_conversation_id,
      externalUserId: row.external_user_id,
      externalEventId: row.external_event_id,
      source: row.source,
      hop: Number(row.hop) || 0,
      sessionId: row.session_id || null,
      status: row.status,
      replyMode: row.reply_mode,
      policy: parseJson(row.policy_json, {}),
      input: parseJson(row.input_json, {}),
      resultText: row.result_text || '',
      reviewedText: row.reviewed_text || '',
      error: row.error || null,
      deliveredAt: row.delivered_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function normalizeObservation(row) {
    if (!row) return null;
    return {
      id: row.id,
      appId: row.app_id,
      instanceId: row.instance_id,
      externalConversationId: row.external_conversation_id,
      externalUserId: row.external_user_id,
      externalEventId: row.external_event_id,
      text: row.text,
      createdAt: row.created_at,
      consumedAt: row.consumed_at || null,
    };
  }

  function scope(input) {
    return {
      appId: text(input.appId, 'appId', { maxLength: 80 }),
      instanceId: text(input.instanceId, 'instanceId', { maxLength: 160 }),
      externalConversationId: text(input.externalConversationId, 'externalConversationId'),
      externalMemberId: text(input.externalMemberId, 'externalMemberId', { optional: true }),
      defaultConversationId: text(
        input.defaultConversationId,
        'defaultConversationId',
        { optional: true },
      ) || '*',
    };
  }

  function getBinding(input) {
    const key = scope(input);
    return normalizeBinding(selectBinding.get(
      key.appId,
      key.instanceId,
      key.externalConversationId,
      key.externalMemberId,
    ));
  }

  function resolveBinding(input, defaults = DEFAULT_AGENT_CHANNEL_POLICY) {
    const key = scope(input);
    const instanceDefault = key.externalConversationId === key.defaultConversationId
      ? null
      : normalizeBinding(selectBinding.get(
          key.appId,
          key.instanceId,
          key.defaultConversationId,
          '',
        ));
    const conversation = normalizeBinding(selectBinding.get(
      key.appId,
      key.instanceId,
      key.externalConversationId,
      '',
    ));
    const instanceMember = key.externalMemberId && key.externalConversationId !== key.defaultConversationId
      ? normalizeBinding(selectBinding.get(
          key.appId,
          key.instanceId,
          key.defaultConversationId,
          key.externalMemberId,
        ))
      : null;
    const member = key.externalMemberId
      ? normalizeBinding(selectBinding.get(
          key.appId,
          key.instanceId,
          key.externalConversationId,
          key.externalMemberId,
        ))
      : null;
    const inheritsDefault = conversation?.policy?.inheritDefault !== false;
    let policy = mergePolicy(defaults, inheritsDefault ? instanceDefault?.policy : null, null);
    policy = mergePolicy(policy, conversation?.policy, null);
    policy = mergePolicy(policy, null, instanceMember?.policy);
    policy = mergePolicy(policy, null, member?.policy);
    return {
      appId: key.appId,
      instanceId: key.instanceId,
      externalConversationId: key.externalConversationId,
      externalMemberId: key.externalMemberId,
      ...policy,
      inheritDefault: inheritsDefault,
      revision: member?.revision || conversation?.revision || 0,
      sourceRevisions: {
        instance: instanceDefault?.revision || 0,
        conversation: conversation?.revision || 0,
        instanceMember: instanceMember?.revision || 0,
        member: member?.revision || 0,
      },
      inherited: Boolean(key.externalMemberId && !member),
    };
  }

  return {
    getBinding,

    listBindings(input) {
      const key = scope(input);
      return listBindings.all(key.appId, key.instanceId, key.externalConversationId)
        .map(normalizeBinding);
    },

    resolveBinding,

    updateBinding(input) {
      const key = scope(input);
      const current = getBinding(key);
      const expectedRevision = input.expectedRevision;
      if (expectedRevision !== undefined && expectedRevision !== (current?.revision || 0)) {
        throw new AppServiceError(
          APP_ERROR_CODES.staleGeneration,
          'Agent Channel binding was changed by another operation.',
          { expectedRevision, actualRevision: current?.revision || 0 },
        );
      }
      const normalizedPatch = normalizeBindingPatch(input.patch, { member: Boolean(key.externalMemberId) });
      const nextPolicy = {
        ...(current?.policy || {}),
        ...normalizedPatch,
        ...(Object.hasOwn(normalizedPatch, 'resources')
          ? { resources: normalizedPatch.resources === null ? null : {
              ...(isRecord(current?.policy?.resources) ? current.policy.resources : {}),
              ...normalizedPatch.resources,
            } }
          : {}),
        ...(Object.hasOwn(normalizedPatch, 'session')
          ? { session: normalizedPatch.session === null ? null : {
              ...(isRecord(current?.policy?.session) ? current.policy.session : {}),
              ...normalizedPatch.session,
            } }
          : {}),
        ...(Object.hasOwn(normalizedPatch, 'proactive')
          ? { proactive: normalizedPatch.proactive === null ? null : {
              ...(isRecord(current?.policy?.proactive) ? current.policy.proactive : {}),
              ...normalizedPatch.proactive,
            } }
          : {}),
      };
      const timestamp = now();
      if (!current) {
        insertBinding.run(
          randomUUID(), key.appId, key.instanceId, key.externalConversationId,
          key.externalMemberId, JSON.stringify(nextPolicy), timestamp, timestamp,
        );
      } else {
        const result = updateBinding.run(JSON.stringify(nextPolicy), timestamp, current.id, current.revision);
        if (result.changes !== 1) {
          throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'Agent Channel binding update conflicted.');
        }
      }
      const binding = getBinding(key);
      return {
        binding,
        effective: resolveBinding({ ...key, defaultConversationId: input.defaultConversationId }, input.defaults),
      };
    },

    resetBinding(input) {
      const key = scope(input);
      const current = getBinding(key);
      const expectedRevision = input.expectedRevision;
      if (expectedRevision !== undefined && expectedRevision !== (current?.revision || 0)) {
        throw new AppServiceError(
          APP_ERROR_CODES.staleGeneration,
          'Agent Channel binding was changed by another operation.',
          { expectedRevision, actualRevision: current?.revision || 0 },
        );
      }
      if (current) deleteBinding.run(
        key.appId,
        key.instanceId,
        key.externalConversationId,
        key.externalMemberId,
      );
      return {
        reset: Boolean(current),
        binding: null,
        effective: resolveBinding({ ...key, defaultConversationId: input.defaultConversationId }, input.defaults),
      };
    },

    observeMessage(input) {
      const key = scope(input);
      const externalUserId = text(input.externalUserId, 'externalUserId');
      const externalEventId = text(input.externalEventId, 'externalEventId');
      const body = text(input.text, 'observation text', { maxLength: 100_000 });
      const existing = normalizeObservation(selectObservationByEvent.get(
        key.appId,
        key.instanceId,
        externalEventId,
      ));
      if (existing) {
        if (
          existing.externalConversationId !== key.externalConversationId
          || existing.externalUserId !== externalUserId
          || existing.text !== body
        ) {
          throw new AppServiceError(
            APP_ERROR_CODES.hostProtocol,
            'Agent Channel observation id was reused with different content.',
          );
        }
        return { observed: false, duplicate: true, observation: existing };
      }
      const timestamp = now();
      insertObservation.run(
        randomUUID(),
        key.appId,
        key.instanceId,
        key.externalConversationId,
        externalUserId,
        externalEventId,
        body,
        timestamp,
      );
      pruneObservations.run(
        key.appId,
        key.instanceId,
        key.externalConversationId,
        key.appId,
        key.instanceId,
        key.externalConversationId,
      );
      return {
        observed: true,
        duplicate: false,
        observation: normalizeObservation(selectObservationByEvent.get(
          key.appId,
          key.instanceId,
          externalEventId,
        )),
      };
    },

    listPendingObservations(input) {
      const key = scope(input);
      const limit = Math.min(100, Math.max(1, Number(input.limit) || 50));
      return listPendingObservations.all(
        key.appId,
        key.instanceId,
        key.externalConversationId,
        limit,
      ).map(normalizeObservation);
    },

    consumeObservations(ids) {
      const timestamp = now();
      let consumed = 0;
      for (const id of [...new Set(Array.isArray(ids) ? ids : [])]) {
        consumed += consumeObservation.run(timestamp, text(id, 'observation id')).changes;
      }
      return consumed;
    },

    getOrCreateConversation(input) {
      const key = scope(input);
      const timestamp = now();
      insertConversation.run(
        randomUUID(), key.appId, key.instanceId, key.externalConversationId, timestamp, timestamp,
      );
      return normalizeConversation(selectConversation.get(
        key.appId, key.instanceId, key.externalConversationId,
      ));
    },

    getConversation(id) {
      return normalizeConversation(selectConversationById.get(text(id, 'conversation id')));
    },

    findConversation(input) {
      const key = scope(input);
      return normalizeConversation(selectConversation.get(
        key.appId, key.instanceId, key.externalConversationId,
      ));
    },

    setConversationSession(conversationId, sessionId, {
      rotated = false,
      continuitySummary = '',
      resetTurnCount = false,
    } = {}) {
      const id = text(conversationId, 'conversation id');
      const result = updateConversationSession.run(
        sessionId ? text(sessionId, 'session id') : null,
        rotated ? 1 : 0,
        String(continuitySummary || '').slice(0, 100_000) || null,
        resetTurnCount ? 0 : (normalizeConversation(selectConversationById.get(id))?.turnCount || 0),
        now(),
        id,
      );
      if (result.changes !== 1) throw new Error('Agent Channel conversation not found.');
      return normalizeConversation(selectConversationById.get(id));
    },

    recordConversationReply(conversationId) {
      const timestamp = now();
      recordConversationReply.run(timestamp, timestamp, text(conversationId, 'conversation id'));
      return normalizeConversation(selectConversationById.get(conversationId));
    },

    claimTurn(input) {
      const key = scope(input);
      const externalUserId = text(input.externalUserId, 'externalUserId');
      const externalEventId = text(input.externalEventId, 'externalEventId');
      const source = ['human', 'agent', 'system'].includes(input.source) ? input.source : 'human';
      const hop = Number.isInteger(input.hop) ? input.hop : 0;
      const turnFingerprint = fingerprint({
        externalConversationId: key.externalConversationId,
        externalUserId,
        source,
        hop,
        input: input.input || {},
      });
      const timestamp = now();
      const id = randomUUID();
      const result = insertTurn.run(
        id,
        key.appId,
        key.instanceId,
        key.externalConversationId,
        externalUserId,
        externalEventId,
        source,
        hop,
        turnFingerprint,
        input.sessionId || null,
        input.replyMode || DEFAULT_AGENT_CHANNEL_POLICY.replyMode,
        JSON.stringify(input.policy || {}),
        JSON.stringify(input.input || {}),
        timestamp,
        timestamp,
      );
      const turn = normalizeTurn(selectTurnByEvent.get(key.appId, key.instanceId, externalEventId));
      if (result.changes !== 1 && selectTurnByEvent.get(key.appId, key.instanceId, externalEventId)?.fingerprint !== turnFingerprint) {
        throw new AppServiceError(
          APP_ERROR_CODES.hostProtocol,
          `Agent Channel event id was reused with different content: ${externalEventId}`,
        );
      }
      return { claimed: result.changes === 1, turn };
    },

    getTurn(turnId, scopeInput = null) {
      const turn = normalizeTurn(selectTurn.get(text(turnId, 'turnId')));
      if (!turn || !scopeInput) return turn;
      const appId = text(scopeInput.appId, 'appId', { maxLength: 80 });
      const instanceId = text(scopeInput.instanceId, 'instanceId', { maxLength: 160 });
      return turn.appId === appId && turn.instanceId === instanceId ? turn : null;
    },

    updateTurn(turnId, patch) {
      const current = normalizeTurn(selectTurn.get(text(turnId, 'turnId')));
      if (!current) throw new Error('Agent Channel turn not found.');
      const patchFields = Object.keys(isRecord(patch) ? patch : {});
      if (TURN_TRANSITIONS[current.status]?.size === 0
        || (current.status === 'completed' && patch.status !== 'cancelled')) {
        if (patchFields.some((field) => field !== 'delivered')) {
          throw new AppServiceError(
            APP_ERROR_CODES.hostProtocol,
            `Agent Channel turn is already terminal: ${current.status}`,
          );
        }
        if (!patchFields.length) return current;
      }
      const nextStatus = patch.status || current.status;
      if (nextStatus !== current.status && !TURN_TRANSITIONS[current.status]?.has(nextStatus)) {
        throw new AppServiceError(
          APP_ERROR_CODES.hostProtocol,
          `Invalid Agent Channel turn transition: ${current.status} -> ${nextStatus}`,
        );
      }
      const timestamp = now();
      const createsDelivery = nextStatus !== current.status
        && ['awaiting_review', 'completed', 'failed'].includes(nextStatus);
      const deliveredAt = patch.delivered === true
        ? timestamp
        : patch.delivered === false || createsDelivery
          ? null
          : current.deliveredAt;
      updateTurn.run(
        patch.sessionId || null,
        nextStatus,
        Object.hasOwn(patch, 'resultText') ? String(patch.resultText || '') : current.resultText || null,
        Object.hasOwn(patch, 'reviewedText') ? String(patch.reviewedText || '') : current.reviewedText || null,
        Object.hasOwn(patch, 'error') ? (patch.error ? String(patch.error) : null) : current.error,
        JSON.stringify(Object.hasOwn(patch, 'input') ? patch.input || {} : current.input || {}),
        deliveredAt,
        timestamp,
        current.id,
      );
      return normalizeTurn(selectTurn.get(current.id));
    },

    listQueuedTurns(scopeInput = null) {
      const turns = listQueuedTurns.all().map(normalizeTurn);
      if (!scopeInput) return turns;
      const appId = text(scopeInput.appId, 'appId', { maxLength: 80 });
      const instanceId = text(scopeInput.instanceId, 'instanceId', { maxLength: 160 });
      const externalConversationId = text(
        scopeInput.externalConversationId,
        'externalConversationId',
        { optional: true },
      );
      return turns.filter((turn) => turn.appId === appId
        && turn.instanceId === instanceId
        && (!externalConversationId || turn.externalConversationId === externalConversationId));
    },

    listPendingTurnDeliveries(scopeInput = null) {
      const turns = listPendingTurnDeliveries.all().map(normalizeTurn);
      if (!scopeInput) return turns;
      const appId = text(scopeInput.appId, 'appId', { maxLength: 80 });
      const instanceId = text(scopeInput.instanceId, 'instanceId', { maxLength: 160 });
      return turns.filter((turn) => turn.appId === appId && turn.instanceId === instanceId);
    },

    listTurns(input) {
      const appId = text(input.appId, 'appId', { maxLength: 80 });
      const instanceId = text(input.instanceId, 'instanceId', { maxLength: 160 });
      const externalConversationId = text(
        input.externalConversationId,
        'externalConversationId',
        { optional: true },
      );
      const statuses = Array.isArray(input.statuses) ? new Set(input.statuses) : null;
      const limit = Math.min(200, Math.max(1, Number(input.limit) || 50));
      return listTurnsByScope.all(appId, instanceId)
        .map(normalizeTurn)
        .filter((turn) => !externalConversationId
          || turn.externalConversationId === externalConversationId)
        .filter((turn) => !statuses || statuses.has(turn.status))
        .slice(0, limit);
    },

    cancelQueuedTurns(sessionId, message = 'Turn cancelled by user.') {
      return cancelQueuedTurns.run(
        String(message || 'Turn cancelled by user.'),
        now(),
        text(sessionId, 'session id'),
      ).changes;
    },
  };
}

export { mergePolicy as resolveAgentChannelPolicy, normalizeBindingPatch };
