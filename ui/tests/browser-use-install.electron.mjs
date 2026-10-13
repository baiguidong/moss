// Run with MOSS_APP_INSTALL_ARCHIVE pointing to the Browser Use archive.
// Keep its first inspection pending through the real Desktop installation flow.
import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { AppRuntimeHost } from '../../packages/app-runtime/src/host/index.mjs'

const archive = process.env.MOSS_APP_INSTALL_ARCHIVE
assert.ok(archive && path.isAbsolute(archive), 'Set MOSS_APP_INSTALL_ARCHIVE to the Browser Use ZIP')
const id = 'moss.browser-use', instanceId = `${id}--default`
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-browser-install-'))
process.env.MOSS_HOME = root
process.env.MOSS_CONFIG_DIR = root
process.env.MOSS_OPEN_DEVTOOLS = 'false'
app.setAppPath(fileURLToPath(new URL('..', import.meta.url)))
app.setPath('userData', path.join(root, 'electron'))
app.on('window-all-closed', () => {})
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const endpoint = `http://127.0.0.1:${reservation.address().port}`
await new Promise(resolve => reservation.close(resolve))
let runtime, repeated = 0, inspections = 0, entered, release
const inspecting = new Promise(resolve => { entered = resolve })
const gate = new Promise(resolve => { release = resolve })
const register = AppRuntimeHost.prototype.registerInstalled
AppRuntimeHost.prototype.registerInstalled = async function (appId, version, options) {
  if (appId === id) {
    runtime = this
    if (this.installations.get(appId)?.activeVersion === version) { repeated++; await inspecting }
  }
  return register.call(this, appId, version, options)
}
const dispatch = AppRuntimeHost.prototype.dispatchHostRequestNow
AppRuntimeHost.prototype.dispatchHostRequestNow = async function (request) {
  if (request.appId === id && request.protocol === 'moss.mcp/v1') {
    if (request.method === 'servers.save') {
      request = { ...request, input: { ...request.input, config: { ...request.input.config,
        args: [request.input.config.args[0], '--moss-managed-browser', '--cdp-endpoint', endpoint, '--output-dir', path.join(root, 'screenshots')],
      } } }
    }
    if (request.method === 'servers.inspect') { inspections++; entered(); await gate }
  }
  return dispatch.call(this, request)
}
const handlers = new Map(), handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (name, callback) => { handlers.set(name, callback); return handle(name, callback) }
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [archive] })
dialog.showMessageBox = async () => ({ response: 1 })
let mainWindow
const ready = new Promise(resolve => app.on('browser-window-created', (_event, window) => {
  window.show = () => {}; window.showInactive = () => {}
  if (mainWindow) return
  mainWindow = window
  window.webContents.once('did-finish-load', resolve)
}))
const waitFor = async (operation) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await operation()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Browser Use did not become ready')
}
const timeout = setTimeout(() => { console.error('Browser Use installation timed out'); app.exit(1) }, 60_000)
async function run() { try {
  await import('../src/main.mjs')
  await ready
  const invoke = (name, input) => handlers.get(name)({ sender: mainWindow.webContents }, input)
  assert.equal((await invoke('app:install-archive')).ok, true)
  assert.ok(repeated > 0, 'The real install flow must repeat registration during inspection')
  release()
  const status = () => runtime.invoke(id, instanceId, 'servers.list', {})
  await waitFor(async () => {
    const result = await status()
    assert.equal(result.ok, true)
    assert.notEqual(result.data.preparation.state, 'failed', JSON.stringify(result.data.preparation))
    return result.data.preparation.state === 'ready'
  })
  const result = await status()
  assert.equal(result.data.servers[0].check.state, 'connected')
  assert.ok(result.data.servers[0].check.tools.length > 0)
  const existingWindows = new Set(BrowserWindow.getAllWindows())
  assert.equal((await invoke('app:launch', { name: id })).ok, true)
  let view
  await waitFor(() => { view = BrowserWindow.getAllWindows().find(window => !existingWindows.has(window)); return view })
  await waitFor(() => view.webContents.executeJavaScript("document.querySelector('[role=status]')?.textContent === '工具已就绪'"))
  const beforeReconnect = inspections
  await view.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(button => button.textContent.includes('重新连接')).click()")
  await waitFor(() => inspections > beforeReconnect)
  await waitFor(() => view.webContents.executeJavaScript("document.querySelector('[role=status]')?.textContent === '工具已就绪'"))
  await assert.rejects(fetch(`${endpoint}/json/version`), undefined, 'Installation and reconnect must leave Chrome closed')
  console.log(JSON.stringify({ passed: true, version: runtime.installations.get(id).activeVersion, repeatedRegistrations: repeated,
    tools: result.data.servers[0].check.tools.length, state: '工具已就绪', browserOpened: false }))
  clearTimeout(timeout)
  await runtime.shutdown()
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  app.exit(0)
} catch (error) {
  console.error(error.stack)
  clearTimeout(timeout)
  release()
  await runtime?.shutdown().catch(() => {})
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  app.exit(1)
} }
// Let Electron finish evaluating its ESM entry so app.whenReady can resolve.
void run()
