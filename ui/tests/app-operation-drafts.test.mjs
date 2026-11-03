import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppOperationDraftHandlers } from '../src/apps/app-operation-drafts.mjs';
import { createOperationDraftService } from '../src/operation-drafts.mjs';
import { contracts } from '../../packages/host-contracts/src/index.mjs';

test('App proposal binds actual caller and isolates App/instance/owner; confirm is not exposed', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-drafts-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const service = createOperationDraftService({ filePath: path.join(root, 'drafts.json') });
  const handlers = createAppOperationDraftHandlers(service);
  const caller = { appId: 'sample', instanceId: 'one', owner: { scope: 'user', userId: 'alice' } };
  const draft = await handlers['draft.create']({ appId: 'forged', instanceId: 'forged', owner: { userId: 'bob' }, content: 'proposal', actionRefs: { execute: 'sample/send' } }, caller);
  assert.equal(draft.appId, 'sample');
  assert.equal(draft.instanceId, 'one');
  assert.equal(draft.owner.userId, 'alice');
  assert.equal((await handlers['draft.list']({}, caller)).drafts.length, 1);
  for (const patch of [{ appId: 'other' }, { instanceId: 'two' }, { owner: { userId: 'bob' } }]) {
    assert.equal((await handlers['draft.list']({}, { ...caller, ...patch })).drafts.length, 0);
    assert.equal(await handlers['draft.get']({ draftId: draft.id }, { ...caller, ...patch }), null);
  }
  assert.deepEqual(Object.keys(handlers), ['draft.create', 'draft.list', 'draft.get']);
  assert.deepEqual(Object.keys(contracts['moss.operations/v1'].methods), Object.keys(handlers));
  await assert.rejects(handlers['draft.create']({ content: 'late' }, { ...caller, assertCurrent() { throw new Error('revoked'); } }), /revoked/);
});
