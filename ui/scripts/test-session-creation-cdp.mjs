// Source-built Apps, real desktop/native tool routing, isolated profile, local model fixture.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launchTestInstance } from '../src/app-testing/instance.mjs'
import { AppRuntimeHost, writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'

const ui = fileURLToPath(new URL('..', import.meta.url)), core = path.dirname(ui)
const appsRoot = path.resolve(process.env.MOSS_APPS_ROOT || path.join(core, '../moss-apps'))
const output = path.join(core, 'output/session-creation-cdp')
const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-session-creation-cdp-')))
const home = path.join(directory, 'profile'), runId = randomUUID()
const definitions = [
  { folder: 'visualize', id: 'moss.visualize', prefix: 'visualize', input: { title: '会话图表', mode: 'html', html: '<h1>会话图表</h1><button onclick="this.textContent=\'已点击\'">交互检查</button>' } },
  { folder: 'document-converter', id: 'moss.document', prefix: 'document', input: { title: '会话周报', mode: 'author', to: 'docx', content: '# 会话周报\n\n本次文件归当前会话。' } },
  { folder: 'spreadsheets', id: 'moss.spreadsheets', prefix: 'spreadsheet', input: { title: '会话预算', sheets: [{ name: '预算', rows: [['项目', '金额'], ['收入', 120000], ['支出', 78000], ['结余', { formula: 'B2-B3', numFmt: '#,##0' }]] }] } },
  { folder: 'presentations', id: 'moss.presentations', prefix: 'presentation', input: { title: '会话汇报', slides: [{ title: '会话汇报', body: '本次产物保存在会话 workspace。' }, { title: '下一步', body: '检查预览和会话清理。' }] } },
  { folder: 'templates', id: 'moss.templates', prefix: 'template', input: { title: '会话模板', content: '# {{标题}}\n\n{{正文}}', instructions: '保留标题和正文。' } },
  { folder: 'pdf-tools', id: 'moss.pdf', prefix: 'pdf', input: { title: '会话 PDF', options: { mode: 'create', content: '会话 PDF\n\n本次文件归当前会话。' } } },
]
const modules = path.join(appsRoot, 'node_modules/.bun')
const playwright = (await fs.readdir(modules)).filter(n => n.startsWith('playwright@')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
const { chromium } = await import(pathToFileURL(path.join(modules, playwright, 'node_modules/playwright/index.mjs')))
const checks = [], exceptions = [], calls = [], schemaChecks = [], tasks = [], packages = []
const mark = text => { checks.push(text); console.log('PASS', text) }
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, label, timeout = 120000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(100) }
  throw new Error('Timed out: ' + label)
}
let pending, target, browser, page, cdp, host
const server = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    if (!chunks.length) { res.statusCode = 204; res.end(); return }
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (!body.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: 'aux', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: '存储验证' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })); return }
    let call, content = '检查完成。'
    if (pending && !pending.sent) {
      const tool = body.tools?.find(tool => tool.name === pending.name)
      assert.ok(tool, 'Tool absent from real model request: ' + pending.name)
      assert.doesNotMatch(tool.description, /This tool is provided by the installed/)
      assert.ok(!tool.input_schema.properties?.storage && !tool.input_schema.properties?.sessionId)
      const system = typeof body.system === 'string' ? body.system : (body.system || []).filter(block => block.type === 'text').map(block => block.text).join('\n')
      const environment = system.match(/# Environment[\s\S]*?(?=\n# |$)/)?.[0] || ''
      assert.doesNotMatch(environment, /apps-data|\/apps\/moss\./)
      schemaChecks.push({ name: tool.name, description: tool.description, schema: tool.input_schema, environment })
      pending.sent = true; pending.toolId = randomUUID(); call = pending
    } else if (pending?.sent) {
      const result = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : []).find(block => block.type === 'tool_result' && block.tool_use_id === pending.toolId)
      assert.ok(result, 'Tool result absent: ' + pending.name)
      const text = typeof result.content === 'string' ? result.content : result.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      pending.result = result.is_error ? { error: text } : JSON.parse(text)
      pending.done = true
      content = pending.result?.result?.displayMarkdown || '检查完成。'
      calls.push({ name: pending.name, input: pending.input, result: pending.result, isError: !!result.is_error })
    }
    const events = [
      { type: 'message_start', message: { id: randomUUID(), type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: call ? { type: 'tool_use', id: call.toolId, name: call.name, input: {} } : { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } : { type: 'text_delta', text: content } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } },
      { type: 'message_stop' },
    ]
    res.setHeader('Content-Type', 'text/event-stream'); res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
  } catch (error) { exceptions.push(String(error)); if (pending) pending.failure = String(error); console.error(error); res.statusCode = 500; res.end(String(error)) }
})
async function invoke(sessionId, name, input = {}, { expectError = false } = {}) {
  pending = { name, input }
  await page.evaluate(({ sessionId, name }) => { window.storageTurn = null; void window.agentDesktop.send({ sessionId, prompt: '执行存储回归检查：' + name }).then(value => { window.storageTurn = { value } }, error => { window.storageTurn = { error: String(error) } }) }, { sessionId, name })
  await until(() => { if (pending.failure) throw new Error(pending.failure); return page.evaluate(() => window.storageTurn) }, name + ' turn')
  assert.ok(pending.done, `${name}: ${JSON.stringify(await page.evaluate(() => window.storageTurn))}; ${exceptions.join('; ')}`)
  const result = pending.result; pending = null
  if (!expectError) assert.ok(!result.error, JSON.stringify(result))
  return result
}
async function create(session, definition, input = definition.input) {
  const queued = await invoke(session.id, definition.prefix + '_create', input)
  assert.ok(queued.id, JSON.stringify(queued))
  const scope = path.join(session.workspace, 'artifacts', definition.id, session.id)
  await until(async () => {
    const task = definition.id === 'moss.pdf'
      ? (await fs.readFile(path.join(scope, 'workspace.json'), 'utf8').then(JSON.parse)).tasks.find(task => task.id === queued.id)
      : await fs.readFile(path.join(scope, 'jobs', queued.id, 'task.json'), 'utf8').then(JSON.parse)
    if (['failed', 'canceled', 'interrupted'].includes(task?.status)) throw new Error(JSON.stringify(task))
    return task?.status === 'succeeded'
  }, definition.id + ' task')
  const task = await invoke(session.id, definition.prefix + '_status', { id: queued.id })
  assert.equal(task.status, 'succeeded', JSON.stringify(task))
  assert.ok(task.result.resourceUri.includes('session=' + session.id))
  const marker = JSON.parse(await fs.readFile(path.join(scope, '.moss-session.json'), 'utf8'))
  assert.equal(marker.sessionId, session.id)
  const files = task.artifacts || task.result.files
  for (const file of files.filter(file => file.path)) assert.ok(file.path.startsWith(scope + path.sep), file.path)
  const privateDir = path.join(home, 'apps-data', definition.id, 'instances', definition.id + '--default')
  for (const entry of ['jobs', 'workspace.json', 'files', 'tasks', 'creation-review']) assert.equal(await fs.stat(path.join(privateDir, entry)).catch(() => null), null)
  tasks.push({ appId: definition.id, sessionId: session.id, task, scope })
  return task
}
async function capture(name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(data, 'base64'))
}
async function preview(session, definition, task, suffix = '') {
  await page.evaluate(({ sessionId, input }) => window.agentDesktop.presentation.open({ sessionId, input }), { sessionId: session.id, input: task.result.presentation })
  if (['moss.visualize', 'moss.templates'].includes(definition.id)) {
    // Select the visible right-pane frame, independent of inline conversation frames.
    const visibleFrame = page.locator('iframe').filter({ visible: true }).last()
    await visibleFrame.waitFor()
    await visibleFrame.contentFrame().locator('h1').first().waitFor()
    if (definition.id === 'moss.visualize' && !suffix) {
      await visibleFrame.contentFrame().getByRole('button', { name: '交互检查' }).click()
      await visibleFrame.contentFrame().getByRole('button', { name: '已点击' }).waitFor()
    }
  } else {
    const pdf = page.locator('[data-pdf-preview]').filter({ visible: true })
    await pdf.locator('canvas[data-painted="true"]').first().waitFor()
    assert.ok(await pdf.locator('canvas[data-painted="true"]').first().evaluate(canvas => canvas.width > 0 && canvas.height > 0))
  }
  const cards = await page.locator('[aria-label^="文件："]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
  for (const card of cards) assert.doesNotMatch(card, /^文件：(task|content-index|workflow|render-state|workspace)\.json$/)
  await capture(definition.id + suffix)
}
try {
  await fs.mkdir(output, { recursive: true }); await fs.mkdir(home, { recursive: true })
  process.env.MOSS_HOME = process.env.MOSS_CONFIG_DIR = home
  host = new AppRuntimeHost({ rootDir: home, requireTrustedPublisher: false, nodeExecutable: process.execPath })
  await host.initialize()
  for (const definition of definitions) {
    const source = path.join(appsRoot, 'apps', definition.folder), pkg = path.join(directory, definition.id)
    await fs.mkdir(pkg)
    for (const entry of ['dist', 'schemas', 'assets', 'resources', 'app.moss.json']) await fs.cp(path.join(source, entry), path.join(pkg, entry), { recursive: true, mode: constants.COPYFILE_FICLONE })
    const manifest = JSON.parse(await fs.readFile(path.join(pkg, 'app.moss.json'), 'utf8'))
    assert.equal(manifest.backend.storage, 'session')
    await writePackageChecksums(pkg); await host.installFromDirectory(pkg)
    packages.push({ id: manifest.id, version: manifest.version, backendSha256: await hash(path.join(pkg, manifest.backend.entry)) })
    await fs.rm(pkg, { recursive: true, force: true })
  }
  // Suppress old bundled archives in this isolated profile. All six installed packages above are source-built.
  const bundled = JSON.parse(await fs.readFile(path.join(ui, 'dist/builtin-apps/manifest.json'), 'utf8'))
  await fs.writeFile(path.join(home, 'builtin-apps.json'), JSON.stringify({ version: 1, seen: Object.fromEntries(bundled.apps.map(app => [app.id, app.version])) }))
  await fs.writeFile(path.join(home, 'app-registry.json'), JSON.stringify({ version: 2, apps: packages.map(pkg => ({ id: pkg.id, name: pkg.id, kind: 'app', currentVersion: pkg.version, currentVersionId: pkg.version, publishedVersion: pkg.version, latestVersion: pkg.version, latestVersionId: pkg.version, versionCount: 1 })) }))
  await host.shutdown(); host = null
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  target = await launchTestInstance({ run: { id: runId, directory, home }, executable: path.join(ui, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [ui], cwd: ui,
    settings: { language: 'chinese', agentMode: 'local', model: 'storage-fixture', url: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'test-key', permissionMode: 'bypassPermissions', appearance: { themeMode: 'light' }, autoMemory: { enabled: false, extractionEnabled: false } },
    prepareEnvironment: false, runtimeHome: path.join(core, 'output/builtin-skills-cdp/runtime-cache'), signal: new AbortController().signal, timeoutMs: 90000 })
  browser = await chromium.connectOverCDP(target.endpoint)
  page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes(runId)); assert.ok(page)
  page.setDefaultTimeout(45000)
  cdp = await page.context().newCDPSession(page); await cdp.send('Runtime.enable'); await cdp.send('Page.enable')
  cdp.on('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text))
  await page.waitForSelector('button')
  const created = await page.evaluate(() => window.agentDesktop.createSession({ title: '会话存储 CDP 验证', permissionMode: 'bypassPermissions' }))
  const session = created.summary
  await page.reload(); await page.getByText('会话存储 CDP 验证', { exact: true }).first().click()
  mark('Isolated production Electron main/preload/renderer, source-built Apps and real native tool bridge')
  const originals = []
  for (const definition of definitions) {
    const task = await create(session, definition); originals.push(task)
    await preview(session, definition, task)
    mark(definition.id + ': model tool call → real backend → session files → desktop preview')
  }
  const edits = [
    { ...definitions[0].input, title: '图表第二版', parentId: originals[0].id },
    { title: '周报第二版', mode: 'review', parentId: originals[1].id, sourcePath: originals[1].artifacts[0].path, edits: [{ find: '本次文件归当前会话。', replace: '修改版也归当前会话。' }] },
    { title: '预算第二版', mode: 'edit', parentId: originals[2].id, sourcePath: originals[2].artifacts[0].path, edits: [{ sheet: '预算', cell: 'B3', value: 70000 }] },
    { ...definitions[3].input, title: '汇报第二版', parentId: originals[3].id },
    { title: '模板第二版', mode: 'update', parentId: originals[4].id, templateId: originals[4].id, instructions: '正文增加时间。' },
    { title: 'PDF 第二版', parentId: originals[5].id, options: { mode: 'create', content: '修改版 PDF 仍归当前会话。' } },
  ]
  for (let i = 0; i < definitions.length; i++) {
    const originalFile = originals[i].artifacts?.[0]?.path
    const previous = originalFile && await hash(originalFile)
    const changed = await create(session, definitions[i], edits[i]); assert.equal(changed.result.version, 2)
    if (originalFile) assert.equal(await hash(originalFile), previous)
    mark(definitions[i].id + ': second version stays in session; original preserved')
  }
  const second = (await page.evaluate(workspace => window.agentDesktop.createSession({ title: '隔离会话 B', workspace, permissionMode: 'bypassPermissions' }), session.workspace)).summary
  for (let i = 0; i < definitions.length; i++) {
    const rejected = await invoke(second.id, definitions[i].prefix + '_status', { id: originals[i].id }, { expectError: true })
    assert.ok(rejected.error, definitions[i].id + ' leaked another session task')
  }
  mark('All six Apps reject task IDs from another session sharing the same workspace')
  const fork = (await page.evaluate(sessionId => window.agentDesktop.forkSession({ sessionId }), session.id)).summary
  const originalUrl = originals[0].artifacts[0].url
  assert.equal((await fetch(originalUrl)).status, 200)
  await page.evaluate(sessionId => window.agentDesktop.deleteSession({ sessionId }), session.id)
  assert.equal((await fetch(originalUrl)).status, 404)
  for (let i = 0; i < definitions.length; i++) {
    const oldScope = path.join(session.workspace, 'artifacts', definitions[i].id, session.id)
    assert.equal(await fs.stat(oldScope).catch(() => null), null)
    const retained = await invoke(fork.id, definitions[i].prefix + '_status', { id: originals[i].id })
    assert.equal(retained.status, 'succeeded'); assert.ok(retained.result.resourceUri.includes('session=' + fork.id))
  }
  await page.reload(); await page.getByText(fork.title, { exact: true }).first().click()
  const retained = await invoke(fork.id, definitions[0].prefix + '_status', { id: originals[0].id })
  await preview(fork, definitions[0], retained, '-fork-after-delete')
  await delay(500)
  for (const definition of definitions) assert.equal(await fs.stat(path.join(session.workspace, 'artifacts', definition.id, session.id)).catch(() => null), null)
  mark('Real desktop fork keeps all six Apps readable after original deletion; original URL revoked and scopes stay deleted; fork preview works')
  assert.deepEqual(exceptions, [])
  await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), checks, exceptions, packages, schemaChecks, calls, scope: 'Current source-built six Apps; real isolated Electron main/preload/renderer and native tool invocation through local HTTP model fixture. No external model calls or user profile changes.' }, null, 2))
  await fs.rm(path.join(output, 'failure.json'), { force: true }); await fs.rm(path.join(output, 'failure.png'), { force: true })
  console.log('Verified:', output)
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, exceptions, calls, pending, tasks }, null, 2))
  throw error
} finally {
  await target?.close(); await browser?.close(); await host?.shutdown()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  await fs.copyFile(path.join(directory, 'instance.log'), path.join(output, 'instance.log')).catch(() => {})
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}
