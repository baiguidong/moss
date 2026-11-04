import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createToolCallDraftService } from '../src/tool-call-drafts.mjs';
import { AppToolCallPolicyStore } from '../../packages/app-runtime/src/tool-call-policy/index.mjs';
import { createAppToolCallReviewer } from '../src/apps/app-tool-call-review.mjs';

const schema = { type: 'object', properties: { recipient: { type: 'string', minLength: 1 }, count: { type: 'integer', minimum: 1 } }, required: ['recipient'], additionalProperties: false };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-call-drafts-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'drafts.json'); let owner = 'alice', created;
  const next = () => new Promise(resolve => { created = resolve; });
  const options = { filePath, currentOwner: () => owner, onChanged: event => { if (event.draft.status === 'draft') created?.(event.draft); } };
  const service = createToolCallDraftService(options); await service.list();
  const controller = new AbortController(); t.after(() => controller.abort());
  const calls = [];
  const input = { appId: 'example.mail', appVersion: '1', identity: { kind: 'app', contributionId: 'example.mail/send' }, title: 'send',
    sessionId: 'chat-1', toolUseId: 'call-1', schema, args: { recipient: 'first' }, signal: controller.signal,
    validateCurrent: async () => {}, execute: async (args, reviewed, dispatch) => { await dispatch?.(); calls.push(args); return { data: { confirmation_token: 'token', status: 'needs_confirmation' } }; } };
  async function start(overrides = {}) { const pending = next(); const result = service.intercept({ ...input, ...overrides }); result.catch(() => {}); return { draft: await pending, result }; }
  return { root, filePath, options, service, input, start, calls, controller, owner: value => { owner = value; } };
}

test('user policies persist outside packages and separate owner, App, MCP instance/server identities', async t => {
  const f = await fixture(t), file = path.join(f.root, 'policies.json'), native = f.input.identity;
  const store = new AppToolCallPolicyStore(file);
  store.set('alice/app', native, 'draft');
  const restored = new AppToolCallPolicyStore(file);
  assert.equal(restored.get('alice/app', native), 'draft'); assert.equal(restored.get('bob/app', native), 'normal');
  const mcp = { kind: 'mcp', instanceId: 'one', server: 'mail', serviceId: 'mcp/one/mail-id', toolName: 'send' };
  restored.set('alice/app', mcp, 'draft'); assert.equal(restored.get('alice/app', { ...mcp, instanceId: 'two' }), 'normal');
  const stable = { ...mcp, serviceId: 'mcp/one/stable-id' };
  restored.set('alice/app', stable, 'draft'); assert.equal(restored.get('alice/app', { ...stable, server: 'renamed' }), 'draft');
  assert.equal(restored.get('alice/app', { ...stable, serviceId: 'mcp/one/recreated-id' }), 'normal');
  assert.throws(() => restored.set('alice/app', mcp, 'allow'));
  assert.throws(() => restored.get('alice/app', { ...mcp, serviceId: '' }));
  restored.set('alice/app', native, 'normal'); assert.equal(new AppToolCallPolicyStore(file).get('alice/app', native), 'normal');
});

test('edit validates schema; stale and concurrent confirmations cannot dispatch; token response is only returned', async t => {
  const f = await fixture(t), { draft, result } = await f.start();
  assert.deepEqual(f.calls, []);
  await assert.rejects(f.service.update({ draftId: draft.id, expectedRevision: 1, patch: { arguments: { recipient: 'second', count: 'wrong' } } }), /参数/);
  const updated = await f.service.update({ draftId: draft.id, expectedRevision: 1, patch: { arguments: { recipient: 'second', count: 2 } } });
  await assert.rejects(f.service.confirm({ draftId: draft.id, expectedRevision: 1 }), /更新/);
  const attempts = await Promise.allSettled([1, 2].map(() => f.service.confirm({ draftId: draft.id, expectedRevision: updated.revision })));
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  assert.deepEqual(f.calls, [{ recipient: 'second', count: 2 }]); assert.equal((await result).data.status, 'needs_confirmation');
  const saved = await f.service.get({ draftId: draft.id }); assert.equal(saved.status, 'returned');
  await assert.rejects(f.service.confirm({ draftId: draft.id, expectedRevision: saved.revision }), /重复/);
});

test('cancellation and stopped conversation resolve original call with an error and zero executions', async t => {
  const f = await fixture(t), first = await f.start();
  await f.service.cancel({ draftId: first.draft.id, expectedRevision: 1 }); await assert.rejects(first.result, /取消/);
  const second = await f.start(); f.controller.abort(); await assert.rejects(second.result, /停止/);
  assert.deepEqual(f.calls, []);
});

test('scope/permission rejection before dispatch is failed; dispatch failure is unknown and cannot retry', async t => {
  const f = await fixture(t);
  const first = await f.start({ validateCurrent: async () => { throw new Error('App removed'); } });
  assert.equal((await f.service.confirm({ draftId: first.draft.id, expectedRevision: 1 })).status, 'failed');
  await assert.rejects(first.result, /removed/); assert.deepEqual(f.calls, []);
  const second = await f.start({ execute: async (_args, _reviewed, dispatch) => { await dispatch(); throw new Error('timeout'); } });
  const uncertain = await f.service.confirm({ draftId: second.draft.id, expectedRevision: 1 }); assert.equal(uncertain.status, 'unknown');
  await assert.rejects(second.result, /不要自动重试/);
  await assert.rejects(f.service.confirm({ draftId: uncertain.id, expectedRevision: uncertain.revision }), /重复/);
  await assert.rejects(f.service.update({ draftId: uncertain.id, expectedRevision: uncertain.revision, patch: { arguments: {} } }));
});

test('owner isolation and restart expire waiting work while preserving uncertain dispatches', async t => {
  const f = await fixture(t), { draft, result } = await f.start();
  f.owner('bob'); assert.deepEqual(await f.service.list(), []);
  await assert.rejects(f.service.confirm({ draftId: draft.id, expectedRevision: 1 }), /账号/);
  f.owner('alice');
  const restartFile = path.join(f.root, 'restart.json');
  await fs.writeFile(restartFile, JSON.stringify([draft, { ...draft, id: 'executing', status: 'executing' }]));
  const restarted = createToolCallDraftService({ ...f.options, filePath: restartFile });
  const recovered = await restarted.list();
  assert.equal(recovered.find(d => d.id === draft.id).status, 'expired'); assert.equal(recovered.find(d => d.id === 'executing').status, 'unknown');
  f.controller.abort(); await assert.rejects(result);
});

test('reviewer uses raw native identity and preserves explicit draft rule when normal mode is restored', async t => {
  const f = await fixture(t), policies = new AppToolCallPolicyStore(path.join(f.root, 'policy.json'));
  let version = '1', credential = 'original-account';
  const contribution = { id: f.input.identity.contributionId, appId: f.input.appId, title: 'Send', inputSchemaDocument: schema, toolScope: 'session' };
  const runtime = { toolCallPolicies: policies, currentOwner: () => ({ key: 'alice' }), storageAppId: id => id,
    instances: { list: () => [{ id: 'instance', enabled: true }] }, credentials: { get: async () => ({ credential }) },
    getInstallation: () => ({ enabled: true, activeVersion: version, grants: [] }), requireContribution: async () => contribution };
  const review = createAppToolCallReviewer({ getRuntime: () => runtime, getMcpHost: () => null, drafts: f.service });
  const session = { id: 'chat-1', appIds: [f.input.appId], runtimeAppToolIds: new Set([contribution.id]) };
  const event = { input: { kind: 'app', appId: f.input.appId, contributionId: contribution.id, toolName: 'display_alias', arguments: f.input.args, schema, toolUseId: '1' }, signal: f.controller.signal, execute: f.input.execute };
  await review(event, session); assert.equal(f.calls.length, 1);
  policies.set(f.input.appId, f.input.identity, 'draft');
  const pending = review(event, session); pending.catch(() => {});
  let draft;
  for (let i = 0; i < 20; i++) { draft = (await f.service.list()).find(d => d.status === 'draft'); if (draft) break; await new Promise(r => setTimeout(r, 1)); }
  assert.ok(draft); assert.equal(f.calls.length, 1);
  policies.set(f.input.appId, f.input.identity, 'normal'); version = '2';
  assert.equal((await f.service.confirm({ draftId: draft.id, expectedRevision: 1 })).status, 'failed');
  await assert.rejects(pending, /变化/); assert.equal(f.calls.length, 1);
  policies.set(f.input.appId, f.input.identity, 'draft');
  const changedAccount = review(event, session); changedAccount.catch(() => {});
  let second;
  for (let i = 0; i < 20; i++) { second = (await f.service.list()).find(d => d.status === 'draft'); if (second) break; await new Promise(r => setTimeout(r, 1)); }
  assert.ok(second); assert.doesNotMatch(JSON.stringify(second), /original-account/); credential = 'different-account';
  assert.equal((await f.service.confirm({ draftId: second.id, expectedRevision: 1 })).status, 'failed');
  await assert.rejects(changedAccount, /变化/); assert.equal(f.calls.length, 1);
});

test('reviewer bypasses configured draft rules while the global draft box is disabled', async t => {
  const f = await fixture(t), policies = new AppToolCallPolicyStore(path.join(f.root, 'disabled-policy.json'));
  policies.set(f.input.appId, f.input.identity, 'draft');
  let enabled = false;
  const contribution = { id: f.input.identity.contributionId, appId: f.input.appId, title: 'Send', inputSchemaDocument: schema, toolScope: 'session' };
  const runtime = { toolCallPolicies: policies, currentOwner: () => ({ key: 'alice' }), storageAppId: id => id,
    instances: { list: () => [] }, credentials: { get: async () => ({}) },
    getInstallation: () => ({ enabled: true, activeVersion: '1', grants: [] }), requireContribution: async () => contribution };
  const review = createAppToolCallReviewer({ getRuntime: () => runtime, getMcpHost: () => null, drafts: f.service, isEnabled: () => enabled });
  const session = { id: 'chat-1', appIds: [f.input.appId], runtimeAppToolIds: new Set([contribution.id]) };
  const event = { input: { kind: 'app', appId: f.input.appId, contributionId: contribution.id, toolName: 'send', arguments: f.input.args, schema, toolUseId: 'disabled-1' }, signal: f.controller.signal, execute: f.input.execute };
  await review(event, session);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.service.list()).length, 0);
});
