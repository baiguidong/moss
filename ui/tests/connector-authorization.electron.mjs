import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-connector-authorization-'));
const output = path.join(root, '../output/connector-details');
app.setPath('userData', path.join(temp, 'profile'));
app.on('window-all-closed', () => {});
let server, win;
const watchdog = setTimeout(() => app.exit(1), 90_000);
app.whenReady().then(async () => {
try {
  server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(temp, 'vite'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
  await server.listen();
  win = new BrowserWindow({ show: false, width: 1200, height: 900 });
  const evaluate = async (fn, ...args) => { try { return await win.webContents.executeJavaScript(`(${fn})(...${JSON.stringify(args)})`); } catch (error) { throw new Error(String(error) + '\n' + String(fn)); } };
  const until = async fn => {
    for (let i = 0; i < 200; i++) { if (await evaluate(fn)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error('UI condition timed out: ' + fn);
  };
  const click = selector => evaluate(selector => document.querySelector(selector).click(), selector);
  const clickText = (text, scope = 'button') => evaluate((text, scope) => ([...document.querySelectorAll(scope)].find(button => button.textContent.trim() === text) || [...document.querySelectorAll(scope)].find(button => button.textContent.trim().startsWith(text))).click(), text, scope);
  const openManagement = async () => {
    await evaluate(() => {
      const trigger = document.querySelector('header [data-app-management-menu]');
      trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await until(() => Boolean(document.querySelector('[role="menu"]')));
  };
  const manage = async text => { await openManagement(); await clickText(text, '[role="menuitem"]'); };
  const capture = async name => { await fs.mkdir(output, { recursive: true }); await new Promise(resolve => setTimeout(resolve, 200)); await fs.writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG()); };
  await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/connector-authorization.html`);
  await until(() => !!document.querySelector('[data-app-open]'));
  assert.equal(await evaluate(() => document.querySelector('[data-app-category]').querySelectorAll('button').length), 1);
  assert.equal(await evaluate(() => document.querySelector('[data-app-category]').querySelectorAll('input,a,[role=switch]').length), 0);
  assert.doesNotMatch(await evaluate(() => document.querySelector('[data-app-category]').textContent), /重新授权|在会话中使用|认证 \/ 配置|管理|回滚|卸载/);
  await capture('display-only-card');
  await click('[data-app-open]');
  await until(() => !!document.querySelector('header [data-app-connection-open]'));
  assert.equal(await evaluate(() => document.querySelectorAll('[data-app-connection-open]').length), 1);
  assert.doesNotMatch(await evaluate(() => document.querySelector('[aria-label="应用设置"]').textContent), /连接设置|配置凭据、登录授权/);
  assert.equal((await evaluate(() => JSON.parse(JSON.stringify(window.__authorization)))).calls.length, 0, 'details have no connector or MCP side effects');
  await capture('details-top-actions');
  assert.equal(await evaluate(() => document.querySelectorAll('[data-app-management-menu]').length), 1);
  assert.equal(await evaluate(() => Boolean(document.querySelector('[data-app-details-section="应用管理"]'))), false);
  await openManagement();
  assert.deepEqual(await evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map(el => el.textContent)), ['版本历史', '更新应用', '卸载应用']);
  await capture('details-management-menu');
  await evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await until(() => !document.querySelector('[role="menu"]'));
  assert.equal(await evaluate(() => document.activeElement.hasAttribute('data-app-management-menu')), true);
  await click('[data-app-connection-open]');
  await until(() => !!document.querySelector('aside input[type=password]'));
  assert.equal(await evaluate(() => document.querySelectorAll('dialog[open], webview, iframe').length), 0);
  assert.equal(await evaluate(() => document.querySelector('aside input[type=password]').value), '');
  assert.doesNotMatch(await evaluate(() => document.querySelector('aside').textContent), /认证与连接/);
  for (const count of [1, 2]) {
    await clickText('重新授权', 'aside button');
    await until(() => !document.querySelector('[aria-label="关闭连接设置"]').disabled);
    const state = await evaluate(() => JSON.parse(JSON.stringify(window.__authorization)));
    assert.equal(state.created, count);
    assert.equal(state.calls.filter(([kind, payload]) => kind === 'connector' && payload.action === 'auth').at(-1)[1].sessionId, `authorization-${count}`);
  }
  await clickText('连接器技能');
  await until(() => !!document.querySelector('aside[aria-label="技能说明"] pre'));
  await click('[data-app-connection-open]');
  await until(() => !!document.querySelector('aside input[type=password]'));
  await evaluate(() => {
    window.__authorization.pauseSave = true;
    const input = document.querySelector('aside input[type=password]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'fixture-new-token');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('aside button[type=submit]');
  await until(() => document.querySelector('[aria-label="关闭连接设置"]').disabled);
  assert.equal(await evaluate(() => document.querySelector('[data-app-connection-open]').disabled), true);
  assert.equal(await evaluate(() => document.querySelector('[data-app-management-menu]').disabled), true);
  assert.equal(await evaluate(() => document.querySelector('[aria-label="应用详情导航"] button').disabled), true);
  assert.equal(await evaluate(() => [...document.querySelectorAll('[role=switch]')].every(input => input.disabled)), true, 'saving blocks concurrent enable and permission changes');
  let state = await evaluate(() => JSON.parse(JSON.stringify(window.__authorization)));
  assert.deepEqual(state.calls.find(([kind, payload]) => kind === 'connector' && payload.action === 'credentials')[1].values, { token: 'fixture-new-token' });
  assert.equal(state.created, 2);
  await evaluate(() => { window.__authorization.pauseSave = false; window.__authorization.finishSave(); });
  await until(() => !document.querySelector('[aria-label="关闭连接设置"]').disabled);
  await click('[aria-label="MCP 服务"] [data-app-details-entry]');
  await until(() => !!document.querySelector('aside [data-mcp-inspect]'));
  assert.equal((await evaluate(() => JSON.parse(JSON.stringify(window.__authorization)))).calls.filter(([kind]) => kind === 'inspect').length, 0);
  await click('aside [data-mcp-inspect]');
  await until(() => window.__authorization.calls.some(([kind]) => kind === 'inspect'));
  console.log('PASS: display-only card, top connection entry, credentials, busy protection, separate authorization sessions and explicit MCP inspection.');

  await manage('版本历史');
  await until(() => document.querySelector('aside')?.textContent.includes('0.9.0'));
  await evaluate(() => { window.confirm = () => false; });
  await evaluate(() => [...document.querySelectorAll('aside button')].find(button => button.textContent.trim() === '回滚' && !button.disabled).click());
  assert.equal((await evaluate(() => JSON.parse(JSON.stringify(window.__authorization)))).calls.some(([kind]) => kind === 'rollback'), false);
  await evaluate(() => { window.confirm = () => true; window.__authorization.failRollback = true; });
  await evaluate(() => [...document.querySelectorAll('aside button')].find(button => button.textContent.trim() === '回滚' && !button.disabled).click());
  await until(() => document.querySelector('aside [role=alert]')?.textContent.includes('测试回滚失败'));
  await evaluate(() => { window.__authorization.failRollback = false; });
  await evaluate(() => [...document.querySelectorAll('aside button')].find(button => button.textContent.trim() === '回滚' && !button.disabled).click());
  await until(() => document.querySelector('aside')?.textContent.includes('0.9.0当前版本'));
  await capture('versions');
  await manage('卸载应用');
  assert.equal(await evaluate(() => document.querySelectorAll('aside input:checked').length), 0, 'data and secrets are retained by default');
  await evaluate(() => { window.confirm = () => false; });
  await clickText('卸载应用', 'aside button');
  assert.equal((await evaluate(() => JSON.parse(JSON.stringify(window.__authorization)))).calls.some(([kind]) => kind === 'delete'), false);
  await evaluate(() => { window.confirm = () => true; window.__authorization.failDelete = true; });
  await clickText('卸载应用', 'aside button');
  await until(() => !!document.querySelector('aside [role=alert]'));
  state = await evaluate(() => JSON.parse(JSON.stringify(window.__authorization)));
  assert.deepEqual(state.calls.find(([kind]) => kind === 'delete')[1], { name: 'moss.baidu-netdisk', deleteData: false, deleteCredentials: false });
  await capture('uninstall');
  await click('aside input[type=checkbox]');
  await evaluate(() => { window.__authorization.failDelete = false; });
  await clickText('卸载应用', 'aside button');
  await until(() => !!document.querySelector('[data-app-category]'));
  state = await evaluate(() => JSON.parse(JSON.stringify(window.__authorization)));
  assert.deepEqual(state.calls.filter(([kind]) => kind === 'delete').at(-1)[1], { name: 'moss.baidu-netdisk', deleteData: true, deleteCredentials: false });
  console.log('PASS: version history, rollback failure/cancel/success, uninstall failure/cancel/success and separate data/credential choices.');

  const source = JSON.parse(await fs.readFile(path.join(root, '../../moss-apps/tool-apps/patsnap-search/app.json'), 'utf8'));
  await evaluate(source => {
    window.__authorization.selectApp({ id: source.id, name: source.id, title: source.displayName, displayName: source.displayName, description: source.description,
      icon: source.connector.icon, currentVersion: source.version, enabled: true, permissions: ['connector:use'], grants: ['connector:use'],
      publisher: source.publisher, connectorApp: { id: source.connector.id, capabilities: ['mcp', 'skills'], connection: { ...source.connector, hasRemoteMcp: true, connected: false, credentialsConfigured: false } } });
  }, source);
  await until(() => !!document.querySelector('[data-app-details="moss.patsnap-search"]'));
  await click('[data-app-connection-open]');
  await until(() => !!document.querySelector('aside input[aria-label="智慧芽 API Key"]'));
  assert.equal(await evaluate(() => document.querySelector('aside input').required), true);
  await capture('patsnap-light');
  await clickText('查看 API Key 获取说明', 'aside button');
  assert.equal((await evaluate(() => JSON.parse(JSON.stringify(window.__authorization)))).calls.filter(([kind]) => kind === 'external').at(-1)[1], source.connector.credentialSchema.docUrl);
  win.setSize(650, 900); await evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  assert.equal(await evaluate(() => getComputedStyle(document.body).colorScheme), 'dark');
  await capture('patsnap-narrow-dark');
  assert.equal(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await evaluate(() => { const footer = document.querySelector('aside footer').getBoundingClientRect(); return footer.bottom <= innerHeight && footer.height > 0; }), true);
  console.log('PASS: actual Patsnap schema, field guidance, documentation link, dark theme and narrow layout.');

  await evaluate(() => window.__authorization.selectApp({ id: 'fixture.runtime', name: 'fixture.runtime', displayName: '后台测试应用', enabled: true, currentVersion: '1.0.0',
    permissions: ['network:request'], grants: ['network:request'],
    hasBackend: true, configuration: { schema: { type: 'object', properties: { name: { type: 'string', title: '连接名称' } } } },
    backend: { lifecycle: 'on-demand', actions: [{ name: 'engine.prepare' }] },
    instances: [{ id: 'default', enabled: true, config: { name: 'fixture' }, secretRefs: { token: { configured: true } } }] }));
  await until(() => !!document.querySelector('[data-app-details="fixture.runtime"]'));
  await openManagement();
  assert.deepEqual(await evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map(el => el.textContent)), ['后台服务', '版本历史', '更新应用', '迭代此 App', '卸载应用']);
  await capture('runtime-management-narrow-dark');
  await clickText('后台服务', '[role="menuitem"]');
  await until(() => !!document.querySelector('aside button[title="日志"]'));
  await click('aside button[title="日志"]');
  await until(() => document.querySelector('aside')?.textContent.includes('fixture service ready'));
  await click('aside button[title="重启"]');
  await until(() => window.__authorization.calls.some(([kind]) => kind === 'restart'));
  await until(() => !document.querySelector('[aria-label="关闭后台服务"]').disabled);
  await clickText('保存配置', 'aside button');
  await until(() => window.__authorization.calls.some(([kind]) => kind === 'instance'));
  await until(() => !document.querySelector('[aria-label="关闭后台服务"]').disabled);
  await capture('runtime');
  await manage('迭代此 App');
  await until(() => window.__authorization.calls.some(([kind]) => kind === 'iterate'));
  await until(() => !document.querySelector('[aria-label="启用应用"]').disabled);
  assert.equal(await evaluate(() => document.querySelector('[title="清除密钥"]').disabled), true);
  await click('[aria-label="启用应用"]');
  await until(() => !document.querySelector('[title="清除密钥"]').disabled);
  await evaluate(() => { window.confirm = () => false; });
  await click('[title="清除密钥"]');
  assert.equal(await evaluate(() => window.__authorization.calls.some(([kind]) => kind === 'clear-credentials')), false);
  await evaluate(() => { window.confirm = () => true; });
  await click('[title="清除密钥"]');
  await until(() => window.__authorization.calls.some(([kind]) => kind === 'clear-credentials'));
  await until(() => !document.querySelector('[aria-label="启用应用"]').disabled);
  await click('[aria-label="启用应用"]');
  await until(() => document.querySelector('[aria-label="启用应用"]').checked && !document.querySelector('[aria-label="启用应用"]').disabled);
  await click('[aria-label="应用设置"] [role=switch]');
  await until(() => !document.querySelector('[aria-label="应用设置"] [role=switch]').checked);
  await until(() => !document.querySelector('select[aria-label="工具使用范围"]').disabled);
  await evaluate(() => { const el = document.querySelector('select[aria-label="工具使用范围"]'); el.value = 'global-always'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await until(() => window.__authorization.calls.some(([kind]) => kind === 'scope'));
  state = await evaluate(() => JSON.parse(JSON.stringify(window.__authorization)));
  assert.deepEqual(state.calls.find(([kind]) => kind === 'scope')[1], { appId: 'fixture.runtime', scope: 'global', loading: 'always' });
  await until(() => !document.querySelector('select[aria-label="工具使用范围"]').disabled);
  await clickText('试用');
  assert.equal(await evaluate(() => window.__authorization.calls.some(([kind]) => kind === 'try')), true);
  await manage('更新应用');
  await until(() => document.querySelector('h1')?.textContent === '应用市场');
  await click('[title="返回应用详情"]');
  await until(() => !!document.querySelector('[data-app-details="fixture.runtime"]'));
  console.log('PASS: migrated Backend logs, restart, configuration save, iteration, enable/disable, credential clearing, permissions, scope, try and update entry.');
} catch (error) {
  console.error(error);
  console.error(await win?.webContents.executeJavaScript('document.body.innerText').catch(() => ''));
  process.exitCode = 1;
  if (win) { await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG()); }
} finally {
  clearTimeout(watchdog); win?.destroy(); await server?.close(); await fs.rm(temp, { recursive: true, force: true }); app.exit(process.exitCode || 0);
}
});
