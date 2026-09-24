import { expect, test } from 'bun:test';
import { registerRemoteCronIpc } from '../src/remote-cron-ipc.mjs';

test('cloud cron routes actions to server and translates session navigation IDs', async () => {
  const handlers = new Map<string, any>();
  const calls: any[] = [];
  let synced = false;
  registerRemoteCronIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    request: async (operation, payload) => {
      calls.push([operation, payload]);
      return operation === 'list' ? { tasks: [{ id:'job', ownerSessionId:'server-source', executionSessionId:'server-execution' }] } : { ok:true, accepted:operation === 'run' };
    },
    syncSessions: async () => { synced=true; },
    findSession: id => synced ? { id:`desktop-${id}` } : null,
  });
  const result = await handlers.get('agent:cloud-cron-list')();
  expect(result.tasks[0]).toMatchObject({ ownerSessionId:'desktop-server-source',executionSessionId:'desktop-server-execution' });
  expect(await handlers.get('agent:cloud-cron-run-now')(null,{taskId:'job'})).toEqual({ok:true,accepted:true});
  await handlers.get('agent:cloud-cron-toggle')(null,{taskId:'job',enabled:false});
  await handlers.get('agent:cloud-cron-remove')(null,{taskId:'job'});
  expect(calls.slice(1)).toEqual([['run',{taskId:'job'}],['enabled',{taskId:'job',enabled:false}],['delete',{taskId:'job'}]]);
  expect(handlers.has('agent:cron-list')).toBe(false);
});
