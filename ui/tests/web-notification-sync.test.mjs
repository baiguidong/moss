import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subscribeNotificationState } from '../src/client/notification-sync.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const requests = [], states = [];
  const target = new EventTarget();
  let changed;
  const dispose = subscribeNotificationState({
    api: {
      list: () => new Promise(resolve => requests.push(resolve)),
      onChanged: callback => { changed = callback; return () => { changed = null; }; },
    },
    onChanged: state => states.push(state), reconnectTarget: target,
  });
  return { requests, states, dispose, emit: notifications => changed?.({ notifications }),
    reconnect: () => target.dispatchEvent(new Event('moss:reconnected')) };
}

test('reconnect replaces stale approvals and discovers new ones without event replay', async () => {
  const f = fixture();
  f.requests[0]([{ decisionRequestId: 'old' }]); await tick();
  f.reconnect();
  f.requests[1]([{ decisionRequestId: 'new' }]); await tick();
  assert.deepEqual(f.states, [[{ decisionRequestId: 'old' }], [{ decisionRequestId: 'new' }]]);
  f.dispose();
});

test('an older list response cannot resurrect a decision resolved by another tab', async () => {
  const f = fixture();
  f.reconnect();
  f.emit([]);
  f.requests[1]([{ decisionRequestId: 'resolved' }]);
  f.requests[0]([{ decisionRequestId: 'even-older' }]); await tick();
  assert.deepEqual(f.states, [[]]);
  f.dispose();
});

test('a later reconnect wins over an earlier refresh and cleanup ignores late I/O', async () => {
  const f = fixture();
  f.reconnect();
  f.requests[1](['current']); await tick();
  f.requests[0](['stale']); await tick();
  f.reconnect(); f.dispose();
  f.requests[2](['after-unmount']); await tick();
  f.reconnect(); f.emit(['ignored']);
  assert.equal(f.requests.length, 3);
  assert.deepEqual(f.states, [['current']]);
});
