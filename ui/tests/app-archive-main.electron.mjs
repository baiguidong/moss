// Opt-in acceptance for a real archive through the complete Desktop Main.
// Only native file selection / permission confirmation are deterministic.
import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const archive = process.env.MOSS_APP_INSTALL_ARCHIVE
assert.ok(archive && path.isAbsolute(archive), 'Set MOSS_APP_INSTALL_ARCHIVE to an absolute App ZIP path')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-archive-main-'))
process.env.MOSS_HOME = root
process.env.MOSS_CONFIG_DIR = root
process.env.MOSS_OPEN_DEVTOOLS = 'false'
app.setAppPath(fileURLToPath(new URL('..', import.meta.url)))
app.setPath('userData', path.join(root, 'electron'))
app.on('window-all-closed', () => {})
const handlers = new Map(), handle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (name, callback) => { handlers.set(name, callback); return handle(name, callback) }
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [archive] })
dialog.showMessageBox = async () => { await new Promise(resolve => setTimeout(resolve, 250)); return { response: 1 } }
let mainWindow
const ready = new Promise(resolve => app.on('browser-window-created', (_event, window) => {
  window.show = () => {}; window.showInactive = () => {}
  if (mainWindow) return
  mainWindow = window
  window.webContents.once('did-finish-load', resolve)
}))
const timeout = setTimeout(() => { console.error('Archive Desktop acceptance timed out'); app.exit(1) }, 60000)
app.on('will-quit', () => { clearTimeout(timeout); void fs.rm(root, { recursive: true, force: true }) })
try {
  await import('../src/main.mjs')
  await ready
  const invoke = (name, input) => handlers.get(name)({ sender: mainWindow.webContents }, input)
  const result = await invoke('app:install-archive')
  assert.equal(result.ok, true)
  const id = result.app.id
  const listed = await invoke('app:list')
  assert.ok(listed.some(item => item.id === id && item.enabled))
  const stored = await invoke('app:get-runtime-state', { appId: id })
  assert.equal(stored.manifest.id, id)
  console.log(JSON.stringify({ passed: true, archive, id, version: stored.manifest.version, checks: ['complete Electron Main', 'production install IPC', 'permission callback delay', 'registry publication', 'runtime activation', 'App list visibility'] }))
  app.quit()
} catch (error) { console.error(error.stack); clearTimeout(timeout); app.exit(1) }
