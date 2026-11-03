import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOperationDraftService } from '../src/operation-drafts.mjs';

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-operation-draft-'));
  const calls = [];
  const runtime = {
    async invokeCommandContribution(id, input) {
      calls.push({ id, input });
      if (id === 'demo/validate') return { valid: true };
      if (id === 'demo/execute') return { status: 'succeeded', result: { externalId: 'msg-1' } };
      if (id === 'demo/query') return { status: 'succeeded', result: { externalId: 'msg-1' } };
      throw new Error(`unknown action ${id}`);
    },
  };
  return { directory, calls, service: createOperationDraftService({ filePath: path.join(directory, 'drafts.json'), getRuntime: () => runtime }) };
}

test('operation drafts persist revisions and require the current revision', async () => {
  const { service } = await fixture();
  const draft = await service.create({ appId: 'demo', channel: 'mail', accountId: 'account-1', target: { email: 'a@example.com' }, content: 'hello', actionRefs: { execute: 'demo/execute', validateDraft: 'demo/validate' } });
  assert.equal(draft.revision, 1);
  const updated = await service.update({ draftId: draft.id, expectedRevision: 1, patch: { content: 'updated' } });
  assert.equal(updated.revision, 2);
  await assert.rejects(() => service.update({ draftId: draft.id, expectedRevision: 1, patch: { content: 'stale' } }), /revision/);
});

test('confirm validates, executes with idempotency key, and stores result', async () => {
  const { service, calls } = await fixture();
  const draft = await service.create({ appId: 'demo', channel: 'slack', target: { channel: '#moss' }, content: 'hello', actionRefs: { execute: 'demo/execute', validateDraft: 'demo/validate' } });
  const result = await service.confirm({ draftId: draft.id, expectedRevision: 1 });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.resultRef.externalId, 'msg-1');
  assert.equal(calls[0].id, 'demo/validate');
  assert.equal(calls[1].id, 'demo/execute');
  assert.equal(calls[1].input.idempotencyKey, draft.idempotencyKey);
  assert.equal((await service.confirm({ draftId: draft.id, expectedRevision: result.revision })).status, 'succeeded');
});

test('execution failures remain visible as failed drafts', async () => {
  const { service } = await fixture();
  const draft = await service.create({ appId: 'demo', channel: 'mail', target: {}, content: 'hello', actionRefs: { execute: 'demo/missing' } });
  await assert.rejects(() => service.confirm({ draftId: draft.id }), /unknown action/);
  const stored = await service.get({ draftId: draft.id });
  assert.equal(stored.status, 'failed');
  assert.match(stored.error, /unknown action/);
});

