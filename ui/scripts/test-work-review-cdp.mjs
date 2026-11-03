// Real isolated Host/App/renderer acceptance; only fixture data and a local model endpoint.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppRuntimeHost, writePackageChecksums } from '../../packages/app-runtime/src/index.mjs';
import { launchTestInstance } from '../src/app-testing/instance.mjs';

const ui = fileURLToPath(new URL('..', import.meta.url));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-work-review-'));
const home = path.join(root, 'profile'), output = path.resolve(ui, '../output/work-review-cdp');
const checks = [], exceptions = []; let runtime, target, browser, page;
const mark = label => { checks.push(label); console.log('PASS', label); };
const model = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body || '{}');
  const content = [{ type: 'text', text: '自动化验收完成' }];
  const message = { id: randomUUID(), type: 'message', role: 'assistant', model: request.model, content, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
  if (!request.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(message)); return; }
  const events = [
    { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content[0].text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  res.setHeader('Content-Type', 'text/event-stream'); res.end(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
});
async function until(check, label) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Timed out: ' + label);
}
const more = async label => { await page.getByRole('button', { name: '更多功能', exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click(); };
const prepare = mode => page.evaluate(mode => window.agentDesktop.invokeAppContribution({ kind: 'commands', id: 'fixture.operations/prepare', input: { mode } }), mode);
const drafts = () => page.evaluate(() => window.agentDesktop.operationDrafts.list());
try {
  await fs.mkdir(output, { recursive: true });
  const source = path.join(root, 'app'); await fs.cp(path.join(ui, 'tests/fixtures/apps/operation-review'), source, { recursive: true });
  await writePackageChecksums(source);
  runtime = await new AppRuntimeHost({ rootDir: path.join(root, 'source-profile') }).initialize();
  await runtime.installFromDirectory(source);
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  const modules = path.resolve(ui, '../../moss-apps/node_modules/.bun');
  const version = (await fs.readdir(modules)).filter(n => n.startsWith('playwright@')).sort().at(-1);
  const { chromium } = await import(pathToFileURL(path.join(modules, version, 'node_modules/playwright/index.mjs')));
  const id = randomUUID();
  target = await launchTestInstance({ run: { id, directory: root, home },
    executable: path.join(ui, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [ui], cwd: ui,
    appRuntime: runtime, runtimeHome: path.join(output, 'runtime-cache'), signal: new AbortController().signal, timeoutMs: 120000,
    settings: { language: 'chinese', agentMode: 'local', model: 'review-fixture', apiKey: 'fixture', url: `http://127.0.0.1:${model.address().port}/v1`, appearance: { themeMode: 'light' }, autoMemory: { enabled: false, extractionEnabled: false } },
  });
  browser = await chromium.connectOverCDP(target.endpoint);
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes(id)); assert.ok(page);
  page.setDefaultTimeout(20000); page.on('pageerror', e => exceptions.push(e.message)); await page.waitForSelector('button');
  const mail = await prepare('mail');
  await page.getByRole('button', { name: /^待处理/ }).click();
  await page.locator(`[data-pending-work-item="operation:${mail.id}"]`).click();
  const card = () => page.locator(`[data-operation-draft="${mail.id}"]`);
  await card().waitFor(); assert.ok((await card().innerText()).includes('person-7'));
  await card().getByRole('button', { name: '修改', exact: true }).click();
  assert.equal(await card().locator('input').count(), 0);
  await card().locator('textarea').fill('更新后的周报正文');
  await card().getByRole('button', { name: '保存修改', exact: true }).click();
  await until(async () => (await drafts()).find(d => d.id === mail.id)?.revision === 2, 'edit saved');
  await card().getByRole('button', { name: '确认执行', exact: true }).click();
  await until(async () => (await drafts()).find(d => d.id === mail.id)?.status === 'succeeded', 'mail receipt');
  await page.screenshot({ path: path.join(output, 'draft-completed.png') });
  mark('App Backend proposes a bound draft; pending work opens it; edited content executes and receipt persists');
  await page.reload(); await page.waitForSelector('button'); await more('业务操作草稿');
  await card().waitFor(); assert.ok((await card().innerText()).includes('已完成'));
  mark('Reload restores receipt and confirmation is unavailable for completed work');
  const unknown = await prepare('unknown'), uncertain = page.locator(`[data-operation-draft="${unknown.id}"]`);
  await uncertain.getByRole('button', { name: '确认执行', exact: true }).click();
  await until(async () => (await drafts()).find(d => d.id === unknown.id)?.status === 'unknown', 'unknown result');
  await uncertain.getByRole('button', { name: '查询结果', exact: true }).waitFor();
  assert.equal(await uncertain.getByRole('button', { name: '确认执行', exact: true }).count(), 0);
  assert.equal(await uncertain.getByRole('button', { name: '取消草稿', exact: true }).count(), 0);
  await uncertain.getByRole('button', { name: '查询结果', exact: true }).click();
  await until(async () => (await drafts()).find(d => d.id === unknown.id)?.status === 'succeeded', 'query receipt');
  mark('Unknown result exposes only reconciliation and resolves from the App receipt');
  const crm = await prepare('crm'), customer = page.locator(`[data-operation-draft="${crm.id}"]`);
  await customer.getByRole('button', { name: '确认执行', exact: true }).click();
  await until(async () => (await drafts()).find(d => d.id === crm.id)?.status === 'failed', 'CRM conflict');
  await customer.getByText('客户记录版本已变更，请重新生成草稿。', { exact: true }).first().waitFor();
  await customer.getByRole('button', { name: '取消草稿', exact: true }).click();
  mark('CRM stale base version is rejected before execution and remains actionable');
  const owner = await page.evaluate(() => window.agentDesktop.createSession({ title: '自动化验收', agentMode: 'local' }));
  await fs.writeFile(path.join(home, 'cron_tasks.json'), JSON.stringify({ tasks: [{ id: 'review-cron', ownerSessionId: owner.summary.id, cron: '0 9 * * *', prompt: '输出自动化验收完成', durable: true, recurring: true, enabled: false, createdAt: Date.now(), nextRunAt: Date.now() + 86400000 }] }));
  await more('定时任务');
  await page.getByRole('button', { name: '展开自动化详情' }).click();
  await page.getByText('还没有运行记录。', { exact: true }).waitFor();
  const run = await page.evaluate(() => window.agentDesktop.sessionCron.runNow('local', { taskId: 'review-cron' }));
  assert.equal(run.ok, true, run.error);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByText('成功', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'automation-runs.png') });
  await page.getByRole('button', { name: '打开会话', exact: true }).click();
  await page.getByText('自动化验收完成', { exact: true }).first().waitFor();
  mark('Cron manual run receives a real local model response; history shows success and links to its session');
  assert.deepEqual(exceptions, []);
  await fs.rm(path.join(output, 'failure.json'), { force: true });
  await fs.rm(path.join(output, 'failure.png'), { force: true });
  await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ ok: true, checks, exceptions, externalSideEffects: false }, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, exceptions }, null, 2)); throw error;
} finally {
  await target?.close(); await browser?.close(); await runtime?.shutdown(); model.closeAllConnections(); model.close();
  await fs.copyFile(path.join(root, 'instance.log'), path.join(output, 'instance.log')).catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
}
