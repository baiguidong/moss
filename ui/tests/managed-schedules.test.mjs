import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createManagedSchedules } from '../src/host/managed-schedules.mjs';
import { readCronTaskStore, updateCronTaskStore } from '../../shared/cron-task-store.mjs';

test('enterprise schedules reconcile without replay and wait for active work before removal', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-managed-cron-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  let owners = 0;
  const apply = createManagedSchedules({ home, createOwner: () => `owner-${++owners}`, ownerExists: () => true });
  const item = { id: 'daily', revision: 1, config: { name: 'Daily', cron: '0 9 * * *', prompt: 'Review', enabled: true } };
  await apply([item], 'alice');
  const file = path.join(home, 'cron_tasks.json');
  await updateCronTaskStore(file, tasks => { tasks[0].nextRunAt = 123; tasks[0].runId = 'active-run'; });
  assert.deepEqual(await apply([item], 'alice'), [{ id: 'daily', revision: 1 }]);
  assert.equal(owners, 1);
  assert.equal((await readCronTaskStore(file))[0].nextRunAt, 123);
  assert.match((await apply([{ ...item, revision: 2, deleted: true }], 'alice'))[0].error, /等待/);
  assert.match((await apply([item], 'bob'))[0].error, /归属/);
  await updateCronTaskStore(file, tasks => { delete tasks[0].runId; });
  assert.deepEqual(await apply([{ ...item, revision: 2, deleted: true }], 'alice'), [{ id: 'daily', revision: 2 }]);
  assert.deepEqual(await readCronTaskStore(file), []);
  await apply([{ ...item, revision: 2, deleted: true }], 'alice');
  assert.equal(owners, 1);
});
