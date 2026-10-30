// Real isolated Electron + Messages -> image_gen -> Images HTTP -> transcript -> preview.
// The HTTP server is a fixture; this test does not call a paid model.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { launchTestInstance } from '../src/app-testing/instance.mjs';

const ui = fileURLToPath(new URL('..', import.meta.url)), core = path.dirname(ui);
const output = path.join(core, 'output/image-gen-cdp');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-image-gen-cdp-'));
const home = path.join(directory, 'profile'), id = randomUUID();
const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace);
const modules = path.resolve(core, '../moss-apps/node_modules/.bun');
const version = (await fs.readdir(modules)).filter(name => name.startsWith('playwright@')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
const { chromium } = await import(pathToFileURL(path.join(modules, version, 'node_modules/playwright/index.mjs')));
const png = await sharp(Buffer.from('<svg width="800" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="500" rx="30" fill="#e9f2ff"/><circle cx="400" cy="230" r="125" fill="#3277db"/><circle cx="370" cy="200" r="60" fill="#8cb7ff"/><text x="400" y="425" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#254574">Moss image_gen · HTTP test fixture</text></svg>')).png().toBuffer();
const calls = [], checks = [], errors = []; let modelImages = 0, serial = 0;
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      assert.equal(req.headers.authorization, 'Bearer cdp-main-key');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'gpt-image-2' }, { id: 'custom-image-model' }, { id: 'gpt-image-test-chat' }] }));
      return;
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (!chunks.length) { res.statusCode = 204; res.end(); return; }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(req.headers.authorization, 'Bearer cdp-main-key');
    if (req.url.includes('/images/')) {
      assert.equal(body.model, 'gpt-image-2');
      assert.equal(body.size, 'auto'); assert.equal(body.quality, 'auto');
      calls.push({ path: req.url, model: body.model, background: body.background, references: body.images?.length || 0 });
      await new Promise(resolve => setTimeout(resolve, 900));
      res.setHeader('Content-Type', 'application/json');
      if (body.prompt === 'failure') { res.statusCode = 503; res.end(JSON.stringify({ error: { message: 'fixture image service unavailable' } })); return; }
      res.end(JSON.stringify({ background: body.background, data: [{ b64_json: png.toString('base64') }] })); return;
    }
    const main = body.tools?.some(tool => tool.name === 'image_gen');
    let block = { type: 'text', text: main ? '图片处理完成。' : '图片工具联调' };
    if (main) {
      assert.ok(!body.tools.some(tool => ['image_generate', 'image_edit'].includes(tool.name)));
      const last = body.messages.at(-1), content = Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content }];
      if (content.some(item => item.type === 'tool_result')) {
        const results = content.filter(item => item.type === 'tool_result');
        if (!results.some(item => item.is_error)) {
          assert.ok(content.some(item => item.type === 'image'), 'Model must see a native image after the tool result');
          modelImages++;
        }
      } else {
        const text = content.filter(item => item.type === 'text').map(item => item.text).join('\n');
        const input = text.includes('请求错误，测试图片服务失败') ? { prompt: 'failure' } : text.includes('把刚才的图改成透明背景') ? { prompt: 'transparent edit', num_last_images_to_include: 1, transparent_background: true } : { prompt: 'a blue icon' };
        block = { type: 'tool_use', id: `image-cdp-${++serial}`, name: 'image_gen', input };
      }
    }
    if (!body.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: 'aux', type: 'message', role: 'assistant', model: body.model, content: [block], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })); return; }
    const events = [
      { type: 'message_start', message: { id: `msg-${randomUUID()}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { ...block, text: '' } },
      { type: 'content_block_delta', index: 0, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: block.type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } },
      { type: 'message_stop' },
    ];
    res.setHeader('Content-Type', 'text/event-stream'); res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
  } catch (error) { errors.push(String(error)); res.statusCode = 500; res.end(JSON.stringify({ error: { message: String(error) } })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let target, browser, page, cdp;
const mark = message => { checks.push(message); console.log('PASS', message); };
const capture = async name => {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
};
try {
  await fs.mkdir(output, { recursive: true });
  target = await launchTestInstance({ run: { id, directory, home }, executable: path.join(ui, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [ui], cwd: ui,
    settings: { language: 'chinese', agentMode: 'local', model: 'gpt-image-test-chat', url: `http://127.0.0.1:${server.address().port}/gateway/v1`, apiKey: 'cdp-main-key',
      permissionMode: 'bypassPermissions', image: { model: '' }, appearance: { themeMode: 'light', toolDisplayMode: 'collapsed' },
      autoMemory: { enabled: false, extractionEnabled: false }, sessionMemory: { enabled: false } },
    prepareEnvironment: false, runtimeHome: path.join(output, 'runtime-cache'), signal: new AbortController().signal, timeoutMs: 90000 });
  browser = await chromium.connectOverCDP(target.endpoint);
  page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes(id)); assert.ok(page);
  page.setDefaultTimeout(30000);
  cdp = await page.context().newCDPSession(page); await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
  await page.getByRole('button', { name: '插件', exact: true }).first().waitFor();
  const created = await page.evaluate(workspace => window.agentDesktop.createSession({ title: '图片工具联调', workspace, permissionMode: 'bypassPermissions' }), workspace);
  await page.reload(); await page.getByText('图片工具联调', { exact: true }).first().click();
  async function send(text) { const composer = page.locator('textarea').filter({ visible: true }).first(); await composer.fill(text); await composer.press('Enter'); }
  await send('生成一个蓝色图标');
  await page.locator('[data-image-generation="running"]').waitFor(); await capture('generating');
  await page.locator('[data-image-generation="completed"] img').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-image-generation] img')].every(image => image.complete && image.naturalWidth > 0));
  await capture('generated');
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/gateway/v1/images/generations');
  mark('Main conversation invokes resident image_gen with shared URL/key and default model, shows pending then the image immediately');
  await page.getByRole('button', { name: '在右侧查看图片', exact: true }).click();
  await page.getByRole('button', { name: '在独立窗口打开', exact: true }).waitFor(); await capture('right-preview');
  mark('Generated image opens the existing right-side presentation viewer');
  await send('把刚才的图改成透明背景');
  await page.waitForFunction(() => document.querySelectorAll('[data-image-generation="completed"]').length === 2);
  assert.equal(calls.length, 2); assert.equal(calls[1].path, '/gateway/v1/images/edits'); assert.equal(calls[1].references, 1); assert.equal(calls[1].background, 'transparent');
  await capture('edited');
  await page.reload();
  await page.getByText('图片工具联调', { exact: true }).first().click();
  await page.locator('[data-image-generation="completed"] img').first().waitFor();
  assert.equal(await page.locator('[data-image-generation="completed"]').count(), 2);
  await page.evaluate(sessionId => window.agentDesktop.setSessionToolDisplayMode({ sessionId, mode: 'merged' }), created.summary.id);
  assert.equal(await page.locator('[data-image-generation="completed"]').count(), 2);
  await capture('restored');
  mark('Follow-up edit uses the previous conversation image; both generated versions survive a full renderer reload');
  await send('请求错误，测试图片服务失败');
  await page.locator('[data-image-generation="failed"]').waitFor();
  assert.ok((await page.locator('[data-image-generation="failed"]').innerText()).includes('503')); await capture('failed');
  assert.equal(calls.length, 3); assert.ok(modelImages >= 2);
  mark('Actual image blocks reach the next model request; service failures render a clear error without retrying');
  const settings = await page.evaluate(() => window.agentDesktop.getSettings());
  assert.deepEqual(settings.image, { model: 'gpt-image-2' });
  await page.getByRole('button', { name: '个人中心', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '模型与搜索', exact: true }).click();
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await page.getByText('已获取 3 个模型', { exact: true }).waitFor();
  assert.equal(await page.getByText('图片厂商', { exact: true }).count(), 0);
  assert.equal(await page.locator('#model').getByText('图片模型', { exact: true }).count(), 1);
  assert.equal(await page.locator('#model select[aria-label="图片模型名称"]').count(), 1);
  assert.equal(await page.locator('#model select').count(), 4, 'three model selectors plus thinking mode');
  const field = page.locator('#model select[aria-label="图片模型名称"]');
  await field.scrollIntoViewIfNeeded(); await capture('settings');
  await field.selectOption('custom-image-model');
  await page.waitForFunction(async () => (await window.agentDesktop.getSettings()).image.model === 'custom-image-model');
  const saved = JSON.parse(await fs.readFile(path.join(home, 'settings.json'), 'utf8'));
  assert.deepEqual(saved.models.image, { model: 'custom-image-model' });
  assert.equal(saved.models.text.apiKey, 'cdp-main-key');
  mark('Text model settings contain one image model field beside the default/fast models; only its name persists, sharing the main URL/key');
  assert.deepEqual(errors, []);
  for (const name of ['failure.json', 'failure-dom.txt', 'failure.png']) await fs.rm(path.join(output, name), { force: true });
  await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ ok: true, checks, calls, modelImages, errors, scope: 'Real isolated Electron + runtime + local HTTP fixtures, no live model calls' }, null, 2));
} catch (error) {
  await capture('failure').catch(() => {});
  if (page) await fs.writeFile(path.join(output, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => ''));
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, calls, modelImages, errors }, null, 2)); throw error;
} finally {
  await target?.close(); await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await fs.copyFile(path.join(directory, 'instance.log'), path.join(output, 'instance.log')).catch(() => {});
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
