// Full Desktop install + production preload + shared UI + actual Draw.io MCP.
import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { AppRuntimeHost } from '../../packages/app-runtime/src/host/index.mjs'

const core = fileURLToPath(new URL('../..', import.meta.url))
const output = path.resolve(process.env.MOSS_MCP_PROOF_OUTPUT || path.join(core, 'output/mcp-app-proof'))
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-mcp-ui-proof-'))
process.env.MOSS_HOME = root
process.env.MOSS_CONFIG_DIR = root
process.env.MOSS_OPEN_DEVTOOLS = 'false'
app.setAppPath(fileURLToPath(new URL('..', import.meta.url)))
app.setPath('userData', path.join(root, 'electron'))
app.on('window-all-closed', () => {})
let runtime, selectedArchive, mainWindow
const registered = AppRuntimeHost.prototype.registerInstalled
AppRuntimeHost.prototype.registerInstalled = function (...args) { runtime = this; return registered.apply(this, args) }
const handlers = new Map(), handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (name, callback) => { handlers.set(name, callback); return handle(name, callback) }
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedArchive] })
dialog.showMessageBox = async () => ({ response: 1 })
const ready = new Promise(resolve => app.on('browser-window-created', (_event, window) => {
  window.show = () => {}; window.showInactive = () => {}
  if (mainWindow) return
  mainWindow = window; window.webContents.once('did-finish-load', resolve)
}))
const waitFor = async (operation, label) => {
  const deadline = Date.now() + 70_000
  while (Date.now() < deadline) { if (await operation()) return; await new Promise(resolve => setTimeout(resolve, 150)) }
  throw new Error(`Timed out: ${label}`)
}
const timeout = setTimeout(() => { console.error('MCP App Desktop verification timed out'); app.exit(1) }, 150_000)
async function run() {
  try {
    await import('../src/main.mjs')
    await ready
    const invoke = (name, input) => handlers.get(name)({ sender: mainWindow.webContents }, input)
    const proof = JSON.parse(await fs.readFile(path.join(output, 'verification.json'), 'utf8'))
    for (const archive of proof.packages) {
      selectedArchive = archive
      assert.equal((await invoke('app:install-archive')).ok, true)
    }
    assert.deepEqual(runtime.installations.listAll().map(item => item.appId), ['moss.drawio'])
    const { getPublishedApp } = await import('../src/app-platform.mjs')
    assert.equal(getPublishedApp('moss.drawio').bundleRoot, path.join(core, 'ui/dist/mcp-app/'))
    const before = new Set(BrowserWindow.getAllWindows())
    assert.equal((await invoke('app:launch', { name: 'moss.drawio' })).ok, true)
    let view
    await waitFor(() => { view = BrowserWindow.getAllWindows().find(window => !before.has(window)); return view }, 'App window')
    const js = source => view.webContents.executeJavaScript(source)
    await waitFor(() => js("document.querySelector('.service-status')?.textContent === '使用时连接' && !document.querySelector('#inspect').disabled"), 'on-demand connection state')
    assert.equal(await js("document.querySelectorAll('.tool-row').length"), 0)
    await js("document.querySelector('#inspect').click()")
    await waitFor(() => js("document.querySelectorAll('.tool-row').length >= 7 && !document.querySelector('#inspect').disabled"), 'actual Draw.io tools')
    assert.equal(await js("document.querySelector('h1').textContent"), 'Draw.io')
    assert.deepEqual(await js("window.mossApp.app.getInfo().then(info => ({ id: info.id, hasBackend: info.hasBackend }))"), { id: 'moss.drawio', hasBackend: false })
    assert.doesNotMatch(await js('document.body.innerText'), /MCP 应用底座|共享组件|演示模式/)
    assert.match(await js('document.body.innerText'), /在对话中创建和编辑图表/)
    const toolCount = await js("document.querySelectorAll('.tool-row').length")
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme = '${theme}'`)
      await new Promise(resolve => setTimeout(resolve, 200))
      await fs.writeFile(path.join(output, `drawio-${theme}.png`), (await view.webContents.capturePage()).toPNG())
    }
    await js("document.documentElement.dataset.theme='light'")
    view.setSize(520, 900)
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(await js('document.documentElement.scrollWidth <= window.innerWidth'), true)
    await fs.writeFile(path.join(output, 'drawio-narrow.png'), (await view.webContents.capturePage()).toPNG())
    view.setSize(1120, 780)
    const openSettings = async () => { await js("document.querySelector('#settings').click()"); await waitFor(() => js("Boolean(document.querySelector('dialog[open]'))"), 'settings dialog') }
    const edit = (selector, value) => js(`Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(value)}); document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('input', { bubbles: true }))`)
    const submit = () => js("document.querySelector('button[type=submit]').click()")
    const saved = () => waitFor(() => js("!document.querySelector('dialog')"), 'settings saved and checked')
    const configSelector = 'textarea[aria-label="drawio 连接配置"]'
    await openSettings()
    await js("document.querySelector('.connection-settings').open=true")
    const original = await js(`document.querySelector(${JSON.stringify(configSelector)}).value`)
    assert.deepEqual(JSON.parse(original).args, ['-y', '@drawio/mcp'])
    await fs.writeFile(path.join(output, 'drawio-settings.png'), (await view.webContents.capturePage()).toPNG())
    await edit(configSelector, '{invalid json')
    await submit()
    await waitFor(() => js("Boolean(document.querySelector('.error-message'))"), 'invalid configuration feedback')
    await edit(configSelector, JSON.stringify({ type: 'stdio', command: 'moss-mcp-nonexistent-test-command', args: [] }))
    await submit(); await saved()
    await waitFor(() => js("document.querySelector('.service-status').textContent === '检查失败'"), 'failed connection feedback')
    await openSettings()
    await js("document.querySelector('.connection-settings').open=true")
    await edit(configSelector, original)
    await edit('textarea[aria-label="drawio 不启用的工具"]', 'search_shapes')
    await js("document.querySelector('select').value='global';document.querySelector('select').dispatchEvent(new Event('change', { bubbles: true }))")
    await submit(); await saved()
    await waitFor(() => runtime.getToolScope('moss.drawio') === 'global', 'scope change')
    await waitFor(() => js("document.querySelector('.service-status').textContent === '检查通过' && document.querySelector('.muted-badge')?.textContent === '已排除'"), 'recovered connection and tool exclusion')
    const searchTool = await js("document.querySelector('.tool-row h4').firstChild.textContent")
    // Upstream descriptions can refer to another tool by name, so a name query can match multiple rows.
    const matchingRows = await js(`[...document.querySelectorAll('.tool-row')].filter(row => row.textContent.toLowerCase().includes(${JSON.stringify(searchTool.toLowerCase())})).length`)
    await js(`document.querySelector('.service-tools').open=true; const el=document.querySelector('input[aria-label=搜索工具]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(searchTool)});el.dispatchEvent(new Event('input',{bubbles:true}))`)
    await waitFor(() => js(`document.querySelectorAll('.tool-row').length === ${matchingRows}`), 'tool search')
    await openSettings()
    await js("document.querySelector('input[type=checkbox]').click()")
    await submit(); await saved()
    assert.equal(await js("document.querySelector('.service-status').textContent"), '服务已停用')
    await openSettings()
    await js("document.querySelector('input[type=checkbox]').click()")
    await submit(); await saved()
    assert.equal(await js("document.querySelector('.service-status').textContent"), '检查通过')
    await fs.writeFile(path.join(output, 'desktop-verification.json'), JSON.stringify({ passed: true, at: new Date().toISOString(), fullDesktop: true, tools: toolCount, packages: proof.packages,
      checks: ['standalone install through real install-archive IPC', 'Core builtin UI through production App protocol/preload', 'drawio identity without Backend', 'real MCP tools', 'Git/Filesystem page structure', 'light/dark/narrow screenshots', 'settings dialog', 'invalid JSON and failed connection feedback', 'recover connection', 'tool scope and exclusion', 'tool search', 'service toggle and reconnect'] }, null, 2) + '\n')
    console.log(`PASS full Desktop: standalone Draw.io, Core UI, ${toolCount} real tools, settings, failure recovery and lifecycle`)
  } catch (error) {
    console.error(error.stack)
    await fs.writeFile(path.join(output, 'desktop-verification.json'), JSON.stringify({ passed: false, error: error.stack }, null, 2) + '\n')
    process.exitCode = 1
  } finally {
    clearTimeout(timeout)
    await runtime?.shutdown().catch(() => {})
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    app.exit(process.exitCode || 0)
  }
}
void run()
