import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'

const storeUrl = new URL('../src/agent-channel-store.mjs', import.meta.url).href

function runStoreScenario(source: string) {
  const script = `
    import { DatabaseSync } from 'node:sqlite';
    import { createAgentChannelStore, DEFAULT_AGENT_CHANNEL_POLICY } from ${JSON.stringify(storeUrl)};
    const db = new DatabaseSync(':memory:');
    try { ${source} } finally { db.close(); }
  `
  const result = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim())
}

describe('Agent Channel store', () => {
  it('resolves conversation defaults and member overrides without widening unrelated fields', () => {
    const result = runStoreScenario(`
      const store = createAgentChannelStore(db, { now: () => 100 });
      const scope = { appId: 'moss.openim', instanceId: 'moss.openim--default', externalConversationId: 'group-1' };
      const conversation = store.updateBinding({ ...scope, expectedRevision: 0, patch: {
        replyMode: 'mention_only', permissionMode: 'dontAsk',
        resources: { tools: ['Read'], skills: ['summarize'], connectors: ['crm'] },
        session: { mode: 'rotating', rotateAfterTurns: 12 },
      }});
      store.updateBinding({ ...scope, externalMemberId: 'member-1', expectedRevision: 0, patch: {
        replyMode: 'ai_draft_review', resources: { skills: [] },
      }});
      console.log(JSON.stringify({
        revision: conversation.binding.revision,
        effective: store.resolveBinding({ ...scope, externalMemberId: 'member-1' }),
        defaultReplyMode: DEFAULT_AGENT_CHANNEL_POLICY.replyMode,
      }));
    `)
    expect(result.revision).toBe(1)
    expect(result.effective).toMatchObject({
      replyMode: 'ai_draft_review', permissionMode: 'dontAsk',
      resources: { tools: ['Read'], skills: [], connectors: ['crm'] },
      session: { mode: 'rotating', rotateAfterTurns: 12 },
    })
    expect(result.defaultReplyMode).toBe('human_only')
  })

  it('uses optimistic revisions and scopes bindings by App instance', () => {
    const result = runStoreScenario(`
      const store = createAgentChannelStore(db);
      const input = { appId: 'moss.openim', instanceId: 'one', externalConversationId: 'chat-1', expectedRevision: 0, patch: { replyMode: 'ai_auto' } };
      store.updateBinding(input);
      let conflict = null;
      try { store.updateBinding({ ...input, patch: { replyMode: 'human_only' } }); } catch (error) { conflict = error.code; }
      console.log(JSON.stringify({ conflict, other: store.resolveBinding({ ...input, instanceId: 'two' }).replyMode }));
    `)
    expect(result.conflict).toBe('APP_STALE_GENERATION')
    expect(result.other).toBe('human_only')
  })

  it('preserves an unrestricted resource selection on a conversation policy', () => {
    const result = runStoreScenario(`
      const store = createAgentChannelStore(db);
      const scope = { appId: 'example.channel', instanceId: 'default' };
      store.updateBinding({ ...scope, externalConversationId: 'account-1/*', patch: {
        resources: { tools: null, skills: [], connectors: [] },
      }});
      console.log(JSON.stringify(store.resolveBinding({
        ...scope,
        externalConversationId: 'account-1/chat-1',
        defaultConversationId: 'account-1/*',
      })));
    `)
    expect(result.resources).toEqual({ tools: null, skills: [], connectors: [] })
  })

  it('lets a direct conversation fully replace and then restore its default policy', () => {
    const result = runStoreScenario(`
      const store = createAgentChannelStore(db);
      const scope = { appId: 'moss.openim', instanceId: 'default' };
      store.updateBinding({ ...scope, externalConversationId: '*', patch: {
        replyMode: 'ai_auto', permissionMode: 'acceptEdits',
        resources: { tools: ['Read'], skills: ['summary'], connectors: ['crm'] },
        session: { mode: 'fixed' },
      }});
      const custom = store.updateBinding({ ...scope, externalConversationId: 'direct:leader', patch: {
        inheritDefault: false,
        replyMode: 'ai_draft_review', permissionMode: 'default',
        resources: { tools: [], skills: [], connectors: [] },
        session: { mode: 'new_each_turn' },
      }});
      const reset = store.resetBinding({
        ...scope, externalConversationId: 'direct:leader', expectedRevision: custom.binding.revision,
      });
      console.log(JSON.stringify({ custom: custom.effective, reset }));
    `)
    expect(result.custom).toMatchObject({
      inheritDefault: false,
      replyMode: 'ai_draft_review',
      permissionMode: 'default',
      resources: { tools: [], skills: [], connectors: [] },
      session: { mode: 'new_each_turn' },
    })
    expect(result.reset).toMatchObject({
      reset: true,
      binding: null,
      effective: {
        inheritDefault: true,
        replyMode: 'ai_auto',
        resources: { tools: ['Read'], skills: ['summary'], connectors: ['crm'] },
      },
    })
  })

  it('isolates account-scoped OpenIM defaults and conversations', () => {
    const result = runStoreScenario(`
      const store = createAgentChannelStore(db);
      const scope = { appId: 'moss.openim', instanceId: 'default' };
      store.updateBinding({
        ...scope,
        externalConversationId: 'openim-user:alice/*',
        defaultConversationId: 'openim-user:alice/*',
        patch: { replyMode: 'ai_auto' },
      });
      store.updateBinding({
        ...scope,
        externalConversationId: 'openim-user:bob/*',
        defaultConversationId: 'openim-user:bob/*',
        patch: { replyMode: 'ai_draft_review' },
      });
      console.log(JSON.stringify({
        alice: store.resolveBinding({
          ...scope,
          externalConversationId: 'openim-user:alice/direct:leader',
          defaultConversationId: 'openim-user:alice/*',
        }).replyMode,
        bob: store.resolveBinding({
          ...scope,
          externalConversationId: 'openim-user:bob/direct:leader',
          defaultConversationId: 'openim-user:bob/*',
        }).replyMode,
      }));
    `)
    expect(result).toEqual({ alice: 'ai_auto', bob: 'ai_draft_review' })
  })

  it('applies instance-wide defaults and member overrides before conversation-specific rules', () => {
    const result = runStoreScenario(`
      const store = createAgentChannelStore(db);
      const scope = { appId: 'moss.feishu', instanceId: 'moss.feishu--default' };
      store.updateBinding({ ...scope, externalConversationId: '*', patch: {
        replyMode: 'ai_draft_review', resources: { tools: ['Read'], skills: [], connectors: [] },
      }});
      store.updateBinding({ ...scope, externalConversationId: 'chat-1', patch: {
        session: { mode: 'fixed' },
      }});
      store.updateBinding({ ...scope, externalConversationId: '*', externalMemberId: 'member-1', patch: {
        replyMode: 'human_only',
      }});
      console.log(JSON.stringify({
        member: store.resolveBinding({ ...scope, externalConversationId: 'chat-1', externalMemberId: 'member-1' }),
        other: store.resolveBinding({ ...scope, externalConversationId: 'chat-1', externalMemberId: 'member-2' }),
      }));
    `)
    expect(result.member).toMatchObject({
      replyMode: 'human_only',
      resources: { tools: ['Read'] },
      session: { mode: 'fixed' },
    })
    expect(result.other).toMatchObject({ replyMode: 'ai_draft_review', session: { mode: 'fixed' } })
  })

  it('treats member inherit as inheritance and prevents member policies from widening resources', () => {
    const result = runStoreScenario(`
      const store = createAgentChannelStore(db);
      const scope = { appId: 'moss.feishu', instanceId: 'moss.feishu--default' };
      store.updateBinding({ ...scope, externalConversationId: '*', patch: {
        replyMode: 'ai_auto', permissionMode: 'dontAsk',
        resources: { tools: ['Read'], skills: ['summarize'], connectors: ['crm'] },
        proactive: { enabled: true, maxConsecutiveReplies: 3, cooldownMs: 5000 },
      }});
      store.updateBinding({ ...scope, externalConversationId: '*', externalMemberId: 'member-1', patch: {
        replyMode: 'inherit', permissionMode: 'acceptEdits',
        resources: { tools: ['Read', 'Bash'], skills: ['other'], connectors: ['crm', 'mail'] },
        proactive: { enabled: true, maxConsecutiveReplies: 10, cooldownMs: 0 },
      }});
      console.log(JSON.stringify(store.resolveBinding({
        ...scope, externalConversationId: 'chat-1', externalMemberId: 'member-1',
      })));
    `)
    expect(result).toMatchObject({
      replyMode: 'ai_auto',
      permissionMode: 'dontAsk',
      resources: { tools: ['Read'], skills: [], connectors: ['crm'] },
      proactive: { enabled: true, maxConsecutiveReplies: 3, cooldownMs: 5000 },
    })
  })

  it('deduplicates source events and rejects payload collisions', () => {
    const result = runStoreScenario(`
      const store = createAgentChannelStore(db);
      const input = { appId: 'moss.openim', instanceId: 'default', externalConversationId: 'chat-1', externalUserId: 'member-1', externalEventId: 'message-1', replyMode: 'ai_auto', policy: {}, input: { text: 'hello' } };
      const first = store.claimTurn(input).claimed;
      const duplicate = store.claimTurn(input).claimed;
      let collision = false;
      try { store.claimTurn({ ...input, input: { text: 'changed' } }); } catch (error) { collision = /different content/.test(error.message); }
      console.log(JSON.stringify({ first, duplicate, collision }));
    `)
    expect(result).toEqual({ first: true, duplicate: false, collision: true })
  })

  it('persists manual conversation observations once and consumes them explicitly', () => {
    const result = runStoreScenario(`
      const store = createAgentChannelStore(db);
      const input = {
        appId: 'moss.openim', instanceId: 'default', externalConversationId: 'direct:peer-1',
        externalUserId: 'peer-1', externalEventId: 'outgoing:message-1', text: 'manual reply',
      };
      const first = store.observeMessage(input);
      const duplicate = store.observeMessage(input);
      let collision = false;
      try { store.observeMessage({ ...input, text: 'changed' }); } catch (error) { collision = /different content/.test(error.message); }
      const pending = store.listPendingObservations(input);
      const consumed = store.consumeObservations(pending.map((entry) => entry.id));
      console.log(JSON.stringify({ first, duplicate, collision, pending, consumed, after: store.listPendingObservations(input) }));
    `)
    expect(result.first).toMatchObject({ observed: true, duplicate: false })
    expect(result.duplicate).toMatchObject({ observed: false, duplicate: true })
    expect(result.collision).toBe(true)
    expect(result.pending).toHaveLength(1)
    expect(result.pending[0]).toMatchObject({ text: 'manual reply', consumedAt: null })
    expect(result.consumed).toBe(1)
    expect(result.after).toEqual([])
  })

  it('enforces terminal turn transitions', () => {
    const result = runStoreScenario(`
      const store = createAgentChannelStore(db);
      const claimed = store.claimTurn({ appId: 'moss.openim', instanceId: 'default', externalConversationId: 'chat-1', externalUserId: 'member-1', externalEventId: 'message-1', replyMode: 'human_only', policy: {}, input: {} });
      const human = store.updateTurn(claimed.turn.id, { status: 'human' });
      let rejected = false;
      try { store.updateTurn(human.id, { status: 'queued' }); } catch (error) { rejected = /transition/.test(error.message); }
      console.log(JSON.stringify({ status: human.status, rejected }));
    `)
    expect(result).toEqual({ status: 'human', rejected: true })
  })

  it('keeps terminal turn content immutable while allowing delivery acknowledgement', () => {
    const result = runStoreScenario(`
      let timestamp = 100;
      const store = createAgentChannelStore(db, { now: () => ++timestamp });
      const turn = store.claimTurn({
        appId: 'moss.openim', instanceId: 'default', externalConversationId: 'chat-1',
        externalUserId: 'member-1', externalEventId: 'message-1', replyMode: 'human_only',
        policy: {}, input: {},
      }).turn;
      store.updateTurn(turn.id, { status: 'human' });
      const completed = store.updateTurn(turn.id, { status: 'completed', resultText: 'original' });
      let immutable = false;
      try {
        store.updateTurn(turn.id, { status: 'completed', resultText: 'tampered' });
      } catch (error) {
        immutable = /already terminal/.test(error.message);
      }
      const acknowledged = store.updateTurn(turn.id, { delivered: true });
      console.log(JSON.stringify({ completed, immutable, acknowledged }));
    `)
    expect(result.immutable).toBe(true)
    expect(result.acknowledged).toMatchObject({
      status: 'completed', resultText: 'original', deliveredAt: expect.any(Number),
    })
  })

  it('lists scoped review turns without leaking another App instance', () => {
    const result = runStoreScenario(`
      const store = createAgentChannelStore(db);
      const base = { appId: 'moss.openim', externalConversationId: 'chat-1', externalUserId: 'member-1', replyMode: 'ai_draft_review', policy: {}, input: {} };
      const first = store.claimTurn({ ...base, instanceId: 'one', externalEventId: 'message-1' }).turn;
      store.updateTurn(first.id, { status: 'queued' });
      store.updateTurn(first.id, { status: 'running' });
      store.updateTurn(first.id, { status: 'awaiting_review', resultText: 'draft' });
      store.claimTurn({ ...base, instanceId: 'two', externalEventId: 'message-2' });
      console.log(JSON.stringify(store.listTurns({ appId: 'moss.openim', instanceId: 'one', statuses: ['awaiting_review'] })));
    `)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ status: 'awaiting_review', resultText: 'draft' })
  })

  it('starts a new delivery lifecycle when an acknowledged draft is approved', () => {
    const result = runStoreScenario(`
      let timestamp = 100;
      const store = createAgentChannelStore(db, { now: () => ++timestamp });
      const turn = store.claimTurn({
        appId: 'moss.openim', instanceId: 'default', externalConversationId: 'chat-1',
        externalUserId: 'member-1', externalEventId: 'message-1',
        replyMode: 'ai_draft_review', policy: {}, input: {},
      }).turn;
      store.updateTurn(turn.id, { status: 'queued', sessionId: 'session-1' });
      store.updateTurn(turn.id, { status: 'running' });
      const draft = store.updateTurn(turn.id, { status: 'awaiting_review', resultText: 'draft' });
      const acknowledged = store.updateTurn(turn.id, { delivered: true });
      const completed = store.updateTurn(turn.id, { status: 'completed', resultText: 'approved' });
      console.log(JSON.stringify({ draft, acknowledged, completed }));
    `)
    expect(result.draft.deliveredAt).toBeNull()
    expect(result.acknowledged.deliveredAt).toBeNumber()
    expect(result.completed).toMatchObject({ status: 'completed', deliveredAt: null })
  })
})
