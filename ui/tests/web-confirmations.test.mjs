import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createDesktopStateStore } from '../src/desktop-state-store.mjs';
import { createAppNotificationBroker } from '../src/app-notification-broker.mjs';
import { createDecisionBroker } from '../src/decision-broker.mjs';
import { createHostConfirmations } from '../src/host/confirmations.mjs';
import { createRequestRegistry } from '../src/host/request-registry.mjs';
import { confirmAppInstallation, describeAppInstallation } from '../src/apps/app-tool-disclosure.mjs';

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

test('Desktop installation waits for structured review and binds the full disclosure to its revision', async t => {
  let shown = 0, native = 0;
  const f = fixture(t, { mode: 'desktop', showRenderer: () => shown++, showNative: async () => { native++; return { response: 1 }; } });
  const manifest = {
    id: 'test.video', displayName: '视频工坊', version: '1.0.0', publisher: { name: 'Test' },
    contributes: { tools: [{ id: 'render', title: '生成视频', description: '写入本地视频', effect: 'write', permission: 'local-files:pick', serviceId: 'video' }],
      skills: [{ id: 'video-guide', title: '视频创作', description: '说明创作流程' }] },
    appCapabilities: { requires: [{ protocol: 'test.media/v1', optional: true }],
      provides: [{ protocol: 'test.video/v1', methods: [{ name: 'render', action: 'render.start', permission: 'video:write', resourceReadMethod: 'read' }] }],
      usesTools: [{ appId: 'test.editor', tools: ['open'] }] },
    nativeAdapter: {},
  };
  const installation = confirmAppInstallation(f.service.dialog, manifest, ['local-files:pick'], '升级安装');
  const item = f.service.snapshot().requests[0];
  assert.equal(shown, 1);
  assert.equal(native, 0);
  assert.equal(item.disclosure.tools[0].name, 'render');
  assert.equal(item.disclosure.tools[0].permission, 'local-files:pick');
  assert.equal(item.disclosure.tools[0].serviceId, 'video');
  assert.equal(item.disclosure.permissions[0].label, '选择本机文件');
  assert.equal(item.disclosure.skills[0].title, '视频创作');
  assert.deepEqual(item.disclosure.capabilities, manifest.appCapabilities);
  assert.equal(item.disclosure.notices[0], '升级安装');
  assert.match(item.disclosure.notices[1], /原生控制适配器/);
  await assert.rejects(f.service.respond({}, { ...item, revision: 'stale', allowed: true }), /完整内容/);
  assert.equal(f.service.snapshot().requests.length, 1);
  await f.service.respond({}, { ...item, allowed: true });
  assert.equal(await installation, true);

  const disclosure = describeAppInstallation(manifest);
  const canceled = f.service.request({ title: 'Same title', disclosure });
  const original = f.service.snapshot().requests[0];
  disclosure.tools[0].description = 'Changed after request';
  disclosure.capabilities.usesTools[0].tools.push('delete');
  assert.equal(original.disclosure.tools[0].description, '写入本地视频');
  assert.deepEqual(original.disclosure.capabilities.usesTools[0].tools, ['open']);
  const changed = f.service.request({ title: 'Same title', disclosure });
  const updated = f.service.snapshot().requests[1];
  assert.notEqual(updated.revision, original.revision);
  await f.service.respond({}, { ...original, allowed: false });
  await f.service.respond({}, { ...updated, allowed: false });
  assert.equal(await canceled, false);
  assert.equal(await changed, false);
  assert.equal(native, 0);
});
