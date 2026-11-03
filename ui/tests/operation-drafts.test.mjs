import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOperationDraftService } from '../src/operation-drafts.mjs';

const input = () => ({ appId: 'demo', channel: 'mail', accountId: 'work-account', target: { id: 'person-1', email: 'a@example.com' }, content: 'hello', actionRefs: { execute: 'demo/execute', validateDraft: 'demo/validate', queryResult: 'demo/query' } });
async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-operation-draft-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const runtime = { async invokeCommandContribution(id, payload, options) {
    calls.push({ id, input: payload, options });
    if (overrides[id]) return overrides[id](payload);
    if (id === 'demo/validate') return { valid: true };
    return { status: 'succeeded', result: { externalId: 'msg-1' } };
  } };
  const options = { filePath: path.join(directory, 'drafts.json'), getRuntime: () => runtime };
  return { runtime, calls, options, service: createOperationDraftService(options) };
}
const payload = draft => ({ draftId: draft.id, expectedRevision: draft.revision });

test('requires current revisions, clears receipts and renews key for edited payload', async t => {
  const { service } = await fixture(t);
  const draft = await service.create(input());
  await assert.rejects(service.update({ draftId: draft.id, patch: { content: 'stale' } }), /revision/);
  const updated = await service.update({ ...payload(draft), patch: { content: 'updated' } });
  assert.equal(updated.revision, 2);
  assert.notEqual(updated.idempotencyKey, draft.idempotencyKey);
  await assert.rejects(service.confirm(payload(draft)), /revision/);
  await assert.rejects(service.cancel(payload(draft)), /revision/);
});

test('validates before execution and never repeats a successful side effect', async t => {
  const { service, calls } = await fixture(t);
  const draft = await service.create(input());
  const result = await service.confirm(payload(draft));
  assert.equal(result.status, 'succeeded');
  assert.equal(result.resultRef.externalId, 'msg-1');
  assert.equal(calls[0].id, 'demo/validate');
  assert.equal(calls[1].input.idempotencyKey, draft.idempotencyKey);
  assert.equal((await service.confirm(payload(result))).status, 'succeeded');
  await assert.rejects(service.cancel(payload(result)));
  await assert.rejects(service.update({ ...payload(result), patch: { content: 'changed' } }));
  assert.equal(calls.length, 2);
});

test('execution transport failure stays unknown and cannot be edited, cancelled or retried', async t => {
  const { service, calls } = await fixture(t, { 'demo/execute': () => { throw new Error('response timed out'); } });
  const draft = await service.create(input());
  await assert.rejects(service.confirm(payload(draft)), /timed out/);
  const unknown = await service.get(payload(draft));
  assert.equal(unknown.status, 'unknown');
  await assert.rejects(service.confirm(payload(unknown)), /结果未知/);
  await assert.rejects(service.update({ ...payload(unknown), patch: { content: 'again' } }));
  await assert.rejects(service.cancel(payload(unknown)));
  const result = await service.queryResult(payload(unknown));
  assert.equal(result.status, 'succeeded');
  assert.equal(calls.filter(c => c.id === 'demo/execute').length, 1);
});

test('requires explicit validation and preserves version conflicts without dispatch', async t => {
  const { service, calls } = await fixture(t, { 'demo/validate': ({ draft }) => ({ valid: false, error: `Version conflict: ${draft.baseVersion}` }) });
  const draft = await service.create({ ...input(), baseVersion: 'v1' });
  await assert.rejects(service.confirm(payload(draft)), /Version conflict: v1/);
  assert.equal((await service.get(payload(draft))).status, 'failed');
  assert.equal(calls.length, 1);
});

test('missing validation response never counts as authorization to execute', async t => {
  const { service, calls } = await fixture(t, { 'demo/validate': () => null });
  const draft = await service.create(input());
  await assert.rejects(service.confirm(payload(draft)), /校验未通过/);
  assert.equal(calls.length, 1);
});

test('missing or malformed receipts remain unknown including result lookups', async t => {
  const { service } = await fixture(t, { 'demo/execute': () => undefined, 'demo/query': () => ({ ok: true }) });
  const draft = await service.create(input());
  assert.equal((await service.confirm(payload(draft))).status, 'unknown');
  assert.equal((await service.queryResult(payload(draft))).status, 'unknown');
});

test('concurrent confirmations dispatch only once and queries cannot race an execution', async t => {
  let release, started;
  const wait = new Promise(r => { release = r; });
  const executing = new Promise(r => { started = r; });
  const { service, calls } = await fixture(t, { 'demo/execute': async () => { started(); await wait; return { status: 'succeeded' }; } });
  const draft = await service.create(input());
  const first = service.confirm(payload(draft));
  await executing;
  await assert.rejects(service.confirm(payload(draft)), /正在执行/);
  assert.equal((await service.queryResult(payload(draft))).status, 'executing');
  release(); await first;
  assert.equal(calls.filter(c => c.id === 'demo/execute').length, 1);
  assert.equal(calls.filter(c => c.id === 'demo/query').length, 0);
});

test('restart recovers in-flight execution as unknown and expires only editable drafts', async t => {
  const { service, options } = await fixture(t);
  const draft = await service.create(input());
  await fs.writeFile(options.filePath, JSON.stringify([{ ...draft, status: 'executing', expiresAt: 1 }, { ...draft, id: 'expired', draftId: 'expired', expiresAt: 1 }]));
  const restarted = createOperationDraftService(options);
  const recovered = await restarted.get(payload(draft));
  assert.equal(recovered.status, 'unknown');
  assert.equal((await restarted.get({ draftId: 'expired' })).status, 'expired');
  await assert.rejects(restarted.confirm(payload(recovered)), /结果未知/);
});

test('cancelled and expired drafts cannot be reopened for execution', async t => {
  const { service, calls } = await fixture(t);
  const draft = await service.create(input());
  const cancelled = await service.cancel(payload(draft));
  await assert.rejects(service.confirm(payload(cancelled)), /取消或过期/);
  await assert.rejects(service.update({ ...payload(cancelled), patch: { content: 'again' } }));
  assert.equal(calls.length, 0);
});

test('rejects cross-App references and missing account/target binding', async t => {
  const { service, calls } = await fixture(t);
  await assert.rejects(service.create({ ...input(), actionRefs: { execute: 'other/send' } }), /绑定的 App/);
  const draft = await service.create({ ...input(), accountId: null });
  await assert.rejects(service.confirm(payload(draft)), /确认账号/);
  assert.equal(calls.length, 0);
});

test('storage retention never evicts unresolved work', async t => {
  const { service, options } = await fixture(t);
  const draft = await service.create(input());
  const rows = Array.from({ length: 200 }, (_, i) => ({ ...draft, id: `id-${i}`, draftId: `id-${i}` }));
  await fs.writeFile(options.filePath, JSON.stringify(rows));
  await assert.rejects(service.create(input()), /上限/);
  assert.equal((await service.list()).length, 200);
  rows[12].status = 'succeeded';
  await fs.writeFile(options.filePath, JSON.stringify(rows));
  const next = await service.create(input());
  assert.ok(await service.get(payload(next)));
  assert.ok(await service.get({ draftId: 'id-0' }));
  assert.equal(await service.get({ draftId: 'id-12' }), null);
});


test('App version changes require a fresh proposal before confirmation', async t => {
  const { service, runtime, calls } = await fixture(t);
  runtime.getActivePackage = async () => ({ manifest: { version: '1.0.0' } });
  runtime.installations = { get: () => ({ activeVersion: '2.0.0' }) };
  const draft = await service.create(input());
  assert.equal(draft.appVersion, '1.0.0');
  await assert.rejects(service.confirm(payload(draft)), /App 版本已更新/);
  assert.equal(calls.length, 0);
});
