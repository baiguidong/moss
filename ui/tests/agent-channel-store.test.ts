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
