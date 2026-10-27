import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerAppUiRequests, createAppUiRequestScope } from '../src/apps/app-ui-requests.mjs';

function fixture(mode, { beginRequest = () => () => {}, delayFirst = false } = {}) {
  const registrations = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const runtime = {
    async subscribeHostEvent(_appId, _instanceId, _protocol, _name, listener, options) {
      const registration = { listener, ...options, unsubscribed: 0 };
      registrations.push(registration);
      if (delayFirst && registrations.length === 1) await gate;
      return () => { registration.unsubscribed++; };
    },
  };
  const sender = Object.assign(new EventEmitter(), { id: 1, send: () => { throw new Error('Renderer is gone'); }, isDestroyed: () => false });
  let call;
  if (mode === 'desktop') {
    const handlers = new Map();
    registerAppUiRequests({ ipc: { handle: (name, fn) => handlers.set(name, fn) }, getState: () => ({ id: 'test.app', runtime }), beginRequest });
    call = (method, input) => handlers.get('app-ui:host:' + method)({ sender }, input);
  } else {
    const scope = createAppUiRequestScope({ getState: () => ({ id: 'test.app', runtime }), sourceId: 'page', send: sender.send });
    call = (method, input) => scope.request('app-ui:host:' + method, input);
  }
  return { registrations, release, call,
    subscribe: () => call('subscribe', { subscriptionId: 'same-id', protocol: 'test/v1', name: 'changed' }),
    unsubscribe: () => call('unsubscribe', { subscriptionId: 'same-id' }),
  };
}

for (const mode of ['desktop', 'web']) {
  test(`${mode} subscription is cleaned up even when its close notification fails`, async () => {
    const f = fixture(mode);
    assert.equal((await f.subscribe()).ok, true);
    const registration = f.registrations[0];
    assert.throws(() => registration.onClosed(new Error('Host shut down')), /Renderer is gone/);
    assert.equal(registration.signal.aborted, true);
    assert.equal(registration.unsubscribed, 1);
    assert.equal((await f.subscribe()).ok, true, 'A closed subscription must release its ID');
    await f.unsubscribe();
  });

  test(`${mode} late canceled subscription cannot remove a replacement with the same ID`, async () => {
    const f = fixture(mode, { delayFirst: true });
    const first = f.subscribe();
    await f.unsubscribe();
    assert.equal((await f.subscribe()).ok, true);
    f.release();
    assert.equal((await first).ok, false);
    assert.equal(f.registrations[0].unsubscribed, 1);
    await f.unsubscribe();
    assert.equal(f.registrations[1].signal.aborted, true, 'Replacement must remain reachable for cancellation');
    assert.equal(f.registrations[1].unsubscribed, 1);
  });
}

test('desktop subscriptions respect the shutdown guard before registering', async () => {
  const f = fixture('desktop', { beginRequest: () => { throw new Error('Moss 正在退出'); } });
  const result = await f.subscribe();
  assert.equal(result.ok, false);
  assert.match(result.error.message, /退出/);
  assert.equal(f.registrations.length, 0);
});
