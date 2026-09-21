import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  resolveAgentChannelConnectorIds,
  resolveAgentChannelToolSelectors,
  toPublicAgentChannelTurn,
  validateAgentChannelConnectorTool,
  validateAgentChannelDelegation,
} from '../src/agent-channel-controller.mjs'

const storeUrl = new URL('../src/agent-channel-store.mjs', import.meta.url).href
const controllerUrl = new URL('../src/agent-channel-controller.mjs', import.meta.url).href

function runControllerScenario(source: string) {
  const script = `
    import { DatabaseSync } from 'node:sqlite';
    import { createAgentChannelStore } from ${JSON.stringify(storeUrl)};
    import { createAgentChannelController } from ${JSON.stringify(controllerUrl)};
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 1000;
      while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 1)); }
    };
    const setup = (defaultReplyMode = 'human_only', overrides = {}) => {
      const db = new DatabaseSync(':memory:');
      const store = createAgentChannelStore(db);
      const sessions = new Map();
      const events = [];
      const prompts = [];
      let created = 0;
      const controller = createAgentChannelController({
        store,
        catalog: async () => ({ agents: [{ id: 'support' }], tools: [{ id: 'Read' }] }),
        defaultsFor: () => ({ replyMode: defaultReplyMode }),
        defaultBindingIdFor: overrides.defaultBindingIdFor,
        listWritableSessions: () => [...sessions.values()],
        getWritableSession: (id) => sessions.get(id) || null,
        createSession: async () => { created += 1; const session = { id: \`session-\${created}\`, title: 'Channel', updatedAt: Date.now(), busy: false, messageCount: 0 }; sessions.set(session.id, session); return session; },
        sendPrompt: overrides.sendPrompt || (async (_sessionId, prompt) => { prompts.push(prompt); return { assistantText: prompt.includes('hello') ? 'draft answer' : 'answer' }; }),
        abortSession: async () => {},
        publishEvent: async (event) => { events.push(event); return { ok: true }; },
      });
      return { db, store, sessions, events, prompts, controller, context: { appId: 'moss.openim', instanceId: 'moss.openim--default' }, get created() { return created; } };
    };
    ${source}
  `
  const result = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim())
}

describe('Agent Channel controller', () => {
  it('narrows runtime connectors without mutating the session connector selection', () => {
    const base = ['crm', 'mail']
    expect(resolveAgentChannelConnectorIds({ resources: { connectors: ['crm', 'crm'] } }, base))
      .toEqual(['crm'])
    expect(base).toEqual(['crm', 'mail'])
    expect(resolveAgentChannelConnectorIds({ resources: { connectors: null } }, base))
      .toEqual(['crm', 'mail'])
  })

  it('keeps unrestricted skills and connectors available when an Agent narrows base tools', () => {
    expect(resolveAgentChannelToolSelectors({
      agentId: 'support',
      resources: { tools: ['Read'], skills: null, connectors: null },
    }, ['crm-server'])).toEqual([
      'Read', 'Agent', 'TaskOutput', 'TaskStop', 'Skill', 'mcp__crm_server__*',
    ])
    expect(resolveAgentChannelToolSelectors({
      resources: { tools: null, skills: [], connectors: [] },
    }, [])).toBeNull()
  })

  it('prevents connector setup and authentication outside the binding policy', () => {
    const policy = { resources: { connectors: ['crm'] } }
    const resolveServer = (name: string) => name === 'crm-server' ? 'crm' : 'mail'
    expect(validateAgentChannelConnectorTool(
      policy,
      'connector_cli_setup',
      { connector_id: 'crm' },
      resolveServer,
    )).toBeNull()
    expect(validateAgentChannelConnectorTool(
      policy,
      'connector_cli_setup',
      { connector_id: 'mail' },
      resolveServer,
    )).toMatch(/Connector mail is not enabled/)
    expect(validateAgentChannelConnectorTool(
      policy,
      'connector_mcp_authenticate',
      { server_name: 'mail-server' },
      resolveServer,
    )).toMatch(/Connector mail is not enabled/)
  })

  it('only lets a selected Agent binding delegate to that Agent type', () => {
    const policy = {
      agentId: 'support',
      resources: { connectors: ['crm'], skills: ['summarize'] },
    }
    expect(validateAgentChannelDelegation(policy, 'Agent', {
      subagent_type: 'support', connector_ids: ['crm'], skill_ids: ['summarize'],
    })).toBeNull()
    expect(validateAgentChannelDelegation(policy, 'Agent', { subagent_type: 'general-purpose' }))
      .toMatch(/not enabled/)
    expect(validateAgentChannelDelegation(policy, 'Agent', {
      subagent_type: 'support', connector_ids: ['mail'],
    })).toMatch(/Connector mail is not enabled/)
    expect(validateAgentChannelDelegation(policy, 'Agent', {
      subagent_type: 'support', skill_ids: ['publish'],
    })).toMatch(/Skill publish is not enabled/)
    expect(validateAgentChannelDelegation(policy, 'Read', {})).toBeNull()
  })

  it('does not expose policy snapshots, continuity summaries, paths, or raw errors to Apps', () => {
    const result = toPublicAgentChannelTurn({
      id: 'turn-1', externalConversationId: 'chat-1', externalUserId: 'user-1',
      externalEventId: 'event-1', source: 'human', hop: 0, sessionId: 'session-1',
      status: 'failed', replyMode: 'ai_auto', policy: { resources: { tools: ['Read'] } },
      input: {
        continuitySummary: 'private history', conversationId: 'internal-id',
        message: { text: 'hello', attachments: [{ type: 'file', name: 'a.txt', path: '/private/a.txt', data: 'secret' }] },
      },
      resultText: '', reviewedText: '', error: '/private/path: provider secret',
      deliveredAt: null, createdAt: 1, updatedAt: 2,
    } as any)
    expect(result).not.toHaveProperty('policy')
    expect(result?.input).not.toHaveProperty('continuitySummary')
    expect(result?.input.message.attachments[0]).toEqual({ type: 'file', name: 'a.txt', mimeType: '' })
    expect(result?.error).not.toContain('/private/path')
  })

  it('does not allow request input to override the Runtime App and instance scope', () => {
    const result = runControllerScenario(`
      const fixture = setup();
      const foreignScope = { appId: 'foreign.app', instanceId: 'foreign--default', externalConversationId: 'chat-1' };
      fixture.store.updateBinding({ ...foreignScope, patch: { replyMode: 'ai_auto' } });
      const read = await fixture.controller.handleAgentRequest('binding.get', {
        ...foreignScope,
      }, fixture.context);
      const updated = await fixture.controller.handleAgentRequest('binding.update', {
        ...foreignScope,
        patch: { replyMode: 'mention_only' },
      }, fixture.context);
      console.log(JSON.stringify({
        read,
        updated,
        foreign: fixture.store.getBinding(foreignScope),
        own: fixture.store.getBinding({ ...fixture.context, externalConversationId: 'chat-1' }),
      }));
      fixture.db.close();
    `)
    expect(result.read.binding).toBeNull()
    expect(result.read.effective.replyMode).toBe('human_only')
    expect(result.foreign.policy.replyMode).toBe('ai_auto')
    expect(result.own.policy.replyMode).toBe('mention_only')
    expect(result.updated.binding).toMatchObject({
      appId: 'moss.openim', instanceId: 'moss.openim--default',
    })
  })

  it('derives member policy from the sender and persists only safe message fields', () => {
    const result = runControllerScenario(`
      const fixture = setup();
      fixture.store.updateBinding({
        ...fixture.context, externalConversationId: 'chat-1', externalMemberId: 'user-1',
        patch: { replyMode: 'ai_auto', session: { mode: 'fixed' } },
      });
      const accepted = await fixture.controller.startTurn({
        externalUserId: 'user-1', externalMemberId: 'different-user',
        externalConversationId: 'chat-1', externalEventId: 'event-safe', text: 'hello',
        unknown: 'discard me',
        attachments: [{ type: 'file', name: 'a.txt', mimeType: 'text/plain', path: '/private/a.txt', data: 'secret' }],
      }, fixture.context, 'moss.agent/v1');
      await waitFor(() => fixture.store.getTurn(accepted.turnId)?.status === 'completed');
      console.log(JSON.stringify({ accepted, stored: fixture.store.getTurn(accepted.turnId).input.message }));
      fixture.db.close();
    `)
    expect(result.accepted).toMatchObject({ accepted: true, routing: 'ai_auto' })
    expect(result.stored).toEqual({
      externalUserId: 'user-1',
      externalConversationId: 'chat-1',
      externalEventId: 'event-safe',
      text: 'hello',
      attachments: [{ type: 'file', name: 'a.txt', mimeType: 'text/plain' }],
      mentioned: false,
      source: 'human',
      hop: 0,
    })
  })

  it('routes human-only messages without invoking the model', () => {
    const result = runControllerScenario(`
      const fixture = setup();
      const turn = await fixture.controller.handleChannelRequest('message.receive', { externalUserId: 'user-1', externalConversationId: 'chat-1', externalEventId: 'event-1', text: 'hello' }, fixture.context);
      console.log(JSON.stringify({ turn, created: fixture.created }));
      fixture.db.close();
    `)
    expect(result.turn).toMatchObject({ accepted: false, routing: 'human', status: 'human' })
    expect(result.created).toBe(0)
  })

  it('adds locally sent replies to the next Agent turn without starting a turn itself', () => {
    const result = runControllerScenario(`
      const fixture = setup('ai_auto');
      const observed = await fixture.controller.handleAgentRequest('context.observe', {
        externalUserId: 'user-1', externalConversationId: 'chat-1',
        externalEventId: 'outgoing-1', text: 'I already sent this manually',
      }, fixture.context);
      const accepted = await fixture.controller.handleAgentRequest('turn.start', {
        externalUserId: 'user-1', externalConversationId: 'chat-1',
        externalEventId: 'incoming-1', text: 'hello',
      }, fixture.context);
      await waitFor(() => fixture.store.getTurn(accepted.turnId)?.status === 'completed');
      console.log(JSON.stringify({
        observed,
        prompts: fixture.prompts,
        pending: fixture.store.listPendingObservations({ ...fixture.context, externalConversationId: 'chat-1' }),
      }));
      fixture.db.close();
    `)
    expect(result.observed).toEqual({ observed: true, duplicate: false })
    expect(result.prompts).toHaveLength(1)
    expect(result.prompts[0]).toContain('"source":"local-user","text":"I already sent this manually"')
    expect(result.pending).toEqual([])
  })

  it('resolves an account-scoped OpenIM default without affecting another account', () => {
    const result = runControllerScenario(`
      const fixture = setup('human_only', {
        defaultBindingIdFor: (conversationId) => conversationId.replace(/\\/(?:direct:[^/]+|\\*)$/, '/*'),
      });
      await fixture.controller.handleAgentRequest('binding.update', {
        externalConversationId: 'openim-user:alice/*',
        patch: { replyMode: 'ai_auto' },
      }, fixture.context);
      const alice = await fixture.controller.handleAgentRequest('turn.start', {
        externalUserId: 'leader', externalConversationId: 'openim-user:alice/direct:leader',
        externalEventId: 'alice-event', text: 'hello',
      }, fixture.context);
      const bob = await fixture.controller.handleAgentRequest('turn.start', {
        externalUserId: 'leader', externalConversationId: 'openim-user:bob/direct:leader',
        externalEventId: 'bob-event', text: 'hello',
      }, fixture.context);
      await waitFor(() => fixture.store.getTurn(alice.turnId)?.status === 'completed');
      console.log(JSON.stringify({ alice, bob }));
      fixture.db.close();
    `)
    expect(result.alice).toMatchObject({ routing: 'ai_auto' })
    expect(result.bob).toMatchObject({ routing: 'human', status: 'human' })
  })

  it('creates reviewable drafts and only emits a send event after approval', () => {
    const result = runControllerScenario(`
      const fixture = setup();
      fixture.store.updateBinding({ ...fixture.context, externalConversationId: 'chat-1', patch: { replyMode: 'ai_draft_review', session: { mode: 'fixed' } } });
      const accepted = await fixture.controller.handleAgentRequest('turn.start', { externalUserId: 'user-1', externalConversationId: 'chat-1', externalEventId: 'event-1', text: 'hello' }, fixture.context);
      await waitFor(() => fixture.store.getTurn(accepted.turnId)?.status === 'awaiting_review');
      const beforeReview = fixture.events.map(event => ({ protocol: event.protocol, name: event.name }));
      const reviewed = await fixture.controller.handleAgentRequest('turn.review', { turnId: accepted.turnId, action: 'approve', text: 'edited answer' }, fixture.context);
      console.log(JSON.stringify({ beforeReview, reviewed, lastEvent: fixture.events.at(-1) }));
      fixture.db.close();
    `)
    expect(result.beforeReview).toContainEqual({ protocol: 'moss.agent/v1', name: 'turn.review_requested' })
    expect(result.beforeReview.some((event: any) => event.name === 'turn.completed')).toBe(false)
    expect(result.reviewed.turn).toMatchObject({ status: 'completed', resultText: 'edited answer' })
    expect(result.lastEvent).toMatchObject({ name: 'turn.completed', data: { text: 'edited answer', approved: true, deliveryMode: 'send' } })
  })

  it('supports mention-only and prevents non-human reply loops by default', () => {
    const result = runControllerScenario(`
      const fixture = setup('mention_only');
      const unmentioned = await fixture.controller.handleChannelRequest('message.receive', { externalUserId: 'user-1', externalConversationId: 'chat-1', externalEventId: 'event-1', text: 'hello' }, fixture.context);
      const mentioned = await fixture.controller.handleChannelRequest('message.receive', { externalUserId: 'user-1', externalConversationId: 'chat-1', externalEventId: 'event-2', text: 'hello', mentioned: true }, fixture.context);
      await waitFor(() => fixture.store.getTurn(mentioned.turnId)?.status === 'completed');
      const loop = await fixture.controller.handleChannelRequest('message.receive', { externalUserId: 'bot-2', externalConversationId: 'chat-1', externalEventId: 'event-3', text: 'loop', source: 'agent', mentioned: true, hop: 1 }, fixture.context);
      console.log(JSON.stringify({ unmentioned, loop, events: fixture.events.map(event => ({ protocol: event.protocol, name: event.name })) }));
      fixture.db.close();
    `)
    expect(result.unmentioned.status).toBe('human')
    expect(result.events).toContainEqual({ protocol: 'moss.channel/v1', name: 'turn.completed' })
    expect(result.loop).toMatchObject({ status: 'human', reason: 'proactive_policy' })
  })

  it('supports sending or dismissing messages routed to a human', () => {
    const result = runControllerScenario(`
      const fixture = setup();
      const first = await fixture.controller.handleChannelRequest('message.receive', {
        externalUserId: 'user-1', externalConversationId: 'chat-1', externalEventId: 'event-1', text: 'hello',
      }, fixture.context);
      const replied = await fixture.controller.handleAgentRequest('turn.reply', {
        turnId: first.turnId, action: 'send', text: 'human answer',
      }, fixture.context);
      const second = await fixture.controller.handleChannelRequest('message.receive', {
        externalUserId: 'user-1', externalConversationId: 'chat-1', externalEventId: 'event-2', text: 'ignore me',
      }, fixture.context);
      const dismissed = await fixture.controller.handleAgentRequest('turn.reply', {
        turnId: second.turnId, action: 'dismiss',
      }, fixture.context);
      console.log(JSON.stringify({ replied, dismissed, events: fixture.events }));
      fixture.db.close();
    `)
    expect(result.replied.turn).toMatchObject({ status: 'completed', resultText: 'human answer' })
    expect(result.dismissed.turn).toMatchObject({ status: 'rejected' })
    expect(result.events.filter((event: any) => event.name === 'turn.completed')).toHaveLength(1)
    expect(result.events.at(-1)).toMatchObject({
      name: 'turn.completed',
      data: { text: 'human answer', generatedBy: 'human', deliveryMode: 'send' },
    })
  })

  it('serializes concurrent messages so a fixed conversation creates one session', () => {
    const result = runControllerScenario(`
      const fixture = setup('ai_auto');
      fixture.store.updateBinding({ ...fixture.context, externalConversationId: 'chat-1', patch: {
        replyMode: 'ai_auto', session: { mode: 'fixed' },
      }});
      const [first, second] = await Promise.all([
        fixture.controller.handleChannelRequest('message.receive', {
          externalUserId: 'user-1', externalConversationId: 'chat-1', externalEventId: 'event-1', text: 'first',
        }, fixture.context),
        fixture.controller.handleChannelRequest('message.receive', {
          externalUserId: 'user-1', externalConversationId: 'chat-1', externalEventId: 'event-2', text: 'second',
        }, fixture.context),
      ]);
      await waitFor(() => fixture.store.getTurn(first.turnId)?.status === 'completed'
        && fixture.store.getTurn(second.turnId)?.status === 'completed');
      console.log(JSON.stringify({ first, second, created: fixture.created }));
      fixture.db.close();
    `)
    expect(result.created).toBe(1)
    expect(result.first.sessionId).toBe(result.second.sessionId)
  })

  it('serializes a conversation even when every turn creates a new session', () => {
    const result = runControllerScenario(`
      let active = 0;
      let maxActive = 0;
      const order = [];
      const releases = [];
      const fixture = setup('ai_auto', {
        sendPrompt: (sessionId, prompt) => new Promise((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          order.push(prompt.includes('first') ? 'first' : 'second');
          releases.push(() => { active -= 1; resolve({ assistantText: sessionId }); });
        }),
      });
      fixture.store.updateBinding({ ...fixture.context, externalConversationId: 'chat-1', patch: {
        replyMode: 'ai_auto', session: { mode: 'new_each_turn' },
      }});
      const first = await fixture.controller.handleAgentRequest('turn.start', {
        externalUserId: 'user-1', externalConversationId: 'chat-1', externalEventId: 'event-1', text: 'first',
      }, fixture.context);
      const second = await fixture.controller.handleAgentRequest('turn.start', {
        externalUserId: 'user-1', externalConversationId: 'chat-1', externalEventId: 'event-2', text: 'second',
      }, fixture.context);
      await waitFor(() => releases.length === 1);
      releases.shift()();
      await waitFor(() => releases.length === 1 && fixture.store.getTurn(first.turnId)?.status === 'completed');
      releases.shift()();
      await waitFor(() => fixture.store.getTurn(second.turnId)?.status === 'completed');
      console.log(JSON.stringify({ maxActive, order, created: fixture.created }));
      fixture.db.close();
    `)
    expect(result).toEqual({ maxActive: 1, order: ['first', 'second'], created: 2 })
  })

  it('never sends an unapproved draft and replays pending delivery after restart', () => {
    const result = runControllerScenario(`
      const fixture = setup();
      fixture.store.updateBinding({ ...fixture.context, externalConversationId: 'chat-1', patch: {
        replyMode: 'ai_draft_review', session: { mode: 'fixed' },
      }});
      const accepted = await fixture.controller.handleAgentRequest('turn.start', {
        externalUserId: 'user-1', externalConversationId: 'chat-1', externalEventId: 'event-1', text: 'hello',
      }, fixture.context);
      await waitFor(() => fixture.store.getTurn(accepted.turnId)?.status === 'awaiting_review');
      const beforeRestart = fixture.events.map(event => event.name);
      fixture.controller.onReady(fixture.context);
      await waitFor(() => fixture.events.filter(event => event.name === 'turn.review_requested').length === 2);
      const afterRestart = fixture.events.map(event => event.name);
      await fixture.controller.handleChannelRequest('delivery.ack', {
        kind: 'turn', deliveryId: accepted.turnId, externalConversationId: 'chat-1', ok: true,
      }, fixture.context);
      await fixture.controller.handleAgentRequest('turn.review', {
        turnId: accepted.turnId, action: 'approve', text: 'approved answer',
      }, fixture.context);
      const afterApproval = fixture.store.getTurn(accepted.turnId);
      fixture.controller.onReady(fixture.context);
      await waitFor(() => fixture.events.filter(event => event.name === 'turn.completed').length === 2);
      console.log(JSON.stringify({ beforeRestart, afterRestart, afterApproval, events: fixture.events.map(event => event.name) }));
      fixture.db.close();
    `)
    expect(result.beforeRestart).not.toContain('turn.completed')
    expect(result.afterRestart.filter((name: string) => name === 'turn.review_requested')).toHaveLength(2)
    expect(result.afterApproval).toMatchObject({ status: 'completed', deliveredAt: null })
    expect(result.events.filter((name: string) => name === 'turn.completed')).toHaveLength(2)
  })

  it('recovers queued work and pending delivery only for the active external account', () => {
    const result = runControllerScenario(`
      const fixture = setup('ai_draft_review');
      const first = await fixture.controller.handleAgentRequest('turn.start', {
        externalUserId: 'peer-1', externalConversationId: 'openim-user:account-a/direct:peer-1', externalEventId: 'event-a', text: 'hello',
      }, fixture.context);
      const second = await fixture.controller.handleAgentRequest('turn.start', {
        externalUserId: 'peer-2', externalConversationId: 'openim-user:account-b/direct:peer-2', externalEventId: 'event-b', text: 'hello',
      }, fixture.context);
      await waitFor(() => fixture.store.getTurn(first.turnId)?.status === 'awaiting_review' && fixture.store.getTurn(second.turnId)?.status === 'awaiting_review');
      fixture.events.length = 0;
      fixture.controller.onReady({ ...fixture.context, externalConversationPrefix: 'openim-user:account-b/' });
      await waitFor(() => fixture.events.length === 1);
      console.log(JSON.stringify(fixture.events.map(event => ({ name: event.name, conversationId: event.data.externalConversationId }))));
      fixture.db.close();
    `)
    expect(result).toEqual([{
      name: 'turn.review_requested',
      conversationId: 'openim-user:account-b/direct:peer-2',
    }])
  })

  it('lets manual takeover discard a draft through turn.abort', () => {
    const result = runControllerScenario(`
      const fixture = setup();
      fixture.store.updateBinding({ ...fixture.context, externalConversationId: 'chat-1', patch: {
        replyMode: 'ai_draft_review', session: { mode: 'fixed' },
      }});
      const accepted = await fixture.controller.handleAgentRequest('turn.start', {
        externalUserId: 'user-1', externalConversationId: 'chat-1', externalEventId: 'event-1', text: 'hello',
      }, fixture.context);
      await waitFor(() => fixture.store.getTurn(accepted.turnId)?.status === 'awaiting_review');
      const aborted = await fixture.controller.handleAgentRequest('turn.abort', {
        turnId: accepted.turnId,
      }, fixture.context);
      console.log(JSON.stringify(aborted));
      fixture.db.close();
    `)
    expect(result).toMatchObject({ aborted: true, turn: { status: 'rejected' } })
  })

  it('lets manual takeover suppress a completed reply before delivery', () => {
    const result = runControllerScenario(`
      const fixture = setup('ai_auto');
      const accepted = await fixture.controller.handleAgentRequest('turn.start', {
        externalUserId: 'user-1', externalConversationId: 'chat-1', externalEventId: 'event-1', text: 'hello',
      }, fixture.context);
      await waitFor(() => fixture.store.getTurn(accepted.turnId)?.status === 'completed');
      const aborted = await fixture.controller.handleAgentRequest('turn.abort', {
        turnId: accepted.turnId,
      }, fixture.context);
      console.log(JSON.stringify(aborted));
      fixture.db.close();
    `)
    expect(result).toMatchObject({ aborted: true, turn: { status: 'cancelled', deliveredAt: null } })
  })

  it('acknowledges App-managed delivery without crossing the conversation scope', () => {
    const result = runControllerScenario(`
      const fixture = setup('ai_auto');
      const accepted = await fixture.controller.handleAgentRequest('turn.start', {
        externalUserId: 'user-1', externalConversationId: 'chat-1', externalEventId: 'event-1', text: 'hello',
      }, fixture.context);
      await waitFor(() => fixture.store.getTurn(accepted.turnId)?.status === 'completed');
      let mismatched = false;
      try {
        await fixture.controller.handleAgentRequest('turn.delivery.ack', {
          turnId: accepted.turnId, externalConversationId: 'chat-2', ok: true,
        }, fixture.context);
      } catch (error) { mismatched = /does not match/.test(error.message); }
      const acknowledged = await fixture.controller.handleAgentRequest('turn.delivery.ack', {
        turnId: accepted.turnId, externalConversationId: 'chat-1', ok: true,
      }, fixture.context);
      console.log(JSON.stringify({ mismatched, acknowledged, turn: fixture.store.getTurn(accepted.turnId) }));
      fixture.db.close();
    `)
    expect(result.mismatched).toBe(true)
    expect(result.acknowledged).toMatchObject({ acknowledged: true, status: 'completed' })
    expect(result.turn.deliveredAt).toBeNumber()
  })
})
