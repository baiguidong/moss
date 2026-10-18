import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createDesktopStateStore } from '../src/desktop-state-store.mjs';
import { createAppNotificationBroker } from '../src/app-notification-broker.mjs';
import { createDecisionBroker } from '../src/decision-broker.mjs';
import { createHostConfirmations } from '../src/host/confirmations.mjs';
import { createRequestRegistry } from '../src/host/request-registry.mjs';

const caller = { transport: 'web', principal: { userId: 'owner' }, viewId: 'tab-one' };
function fixture(t, options = {}) {
  const db = new DatabaseSync(':memory:');
  const store = createDesktopStateStore(db);
  const notifications = createAppNotificationBroker(db);
  const broker = createDecisionBroker({ store, notificationBroker: notifications, getSigningSecret: () => 'secret' });
  const service = createHostConfirmations({ broker, mode: 'web', ...options });
  const registry = createRequestRegistry(); service.register(registry);
  registry.handle('request', () => service.request({ title: '安装', message: '安装示例 App', detail: 'read\nwrite' }));
  t.after(async () => { await service.close(); db.close(); });
  return { service, broker, notifications, registry, store };
}

test('requires full reviewed content and owner; concurrent tabs settle only once', async t => {
  const f = fixture(t);
  const result = f.registry.invoke('request', caller);
  const item = f.service.list(caller).requests[0];
  assert.equal(item.originViewId, 'tab-one');
  await assert.rejects(f.broker.respond({ decisionId: item.id, allowed: true, source: 'desktop' }), /完整内容/);
  await assert.rejects(f.service.respond({ ...caller, principal: { userId: 'other' } }, { ...item, allowed: true }), /当前用户/);
  await assert.rejects(f.service.respond(caller, { ...item, revision: 'stale', allowed: true }), /完整内容/);
  await assert.rejects(f.service.respond(caller, { ...item, allowed: 'false' }), /必须/);
  assert.equal(f.service.list(caller).requests.length, 1);
  assert.equal(f.notifications.listMobilePayloads().length, 0);
  const outcomes = await Promise.allSettled([
    f.service.respond(caller, { ...item, allowed: true }),
    f.service.respond({ ...caller, viewId: 'tab-two' }, { ...item, allowed: false }),
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(await result, true);
  assert.equal(f.service.list(caller).requests.length, 0);
  assert.equal(f.notifications.list()[0].decisionRequestId, undefined);
});

test('cancellation, abort and timeout never grant an operation', async t => {
  const f = fixture(t, { timeoutMs: 25 });
  const canceled = f.service.request({ title: 'Cancel' });
  await f.service.respond(caller, { ...f.service.list(caller).requests[0], allowed: false });
  assert.equal(await canceled, false);
  const controller = new AbortController();
  const aborted = f.service.request({ title: 'Abort' }, { signal: controller.signal });
  controller.abort(); assert.equal(await aborted, false);
  const expired = f.service.request({ title: 'Expire' });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(await expired, false);
  assert.deepEqual(f.service.list(caller).requests, []);
});

test('full disclosure is retained outside the truncated notification, and closure invalidates it', async t => {
  const f = fixture(t);
  const detail = '权限说明\n'.repeat(6000);
  const result = f.service.request({ title: 'Large disclosure', detail });
  const item = f.service.list(caller).requests[0];
  assert.equal(item.detail, detail);
  await f.service.close(); assert.equal(await result, false);
  await assert.rejects(f.service.respond(caller, { ...item, allowed: true }), /过期/);
});

test('Desktop uses the same decision with cancellation focused by default', async t => {
  let dialog;
  const f = fixture(t, { mode: 'desktop', showNative: async options => { dialog = options; return { response: 1 }; } });
  assert.equal(await f.service.request({ title: 'Native', confirmLabel: '安装' }), true);
  assert.equal(dialog.defaultId, 0);
  assert.deepEqual(dialog.buttons, ['取消', '安装']);
  assert.equal(f.service.snapshot().requests.length, 0);
});
