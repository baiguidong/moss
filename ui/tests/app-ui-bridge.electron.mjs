import { HostRequests } from '../../packages/app-runtime/src/host/requests.mjs'
import { build } from 'esbuild'
import { app, BrowserWindow, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerAppUiRequests } from '../src/apps/app-ui-requests.mjs'

const directory = mkdtempSync(path.join(os.tmpdir(), 'moss-ui-bridge-'))
app.setPath('userData', directory)
app.on('window-all-closed', () => {})
const watchdog = setTimeout(() => { console.error('Electron bridge test timed out'); app.exit(1) }, 15000)
app.whenReady().then(async () => {
  let stopped = 0
  let updating = false, active = 0
  const requests = new HostRequests()
  const runtime = {
    invoke: async (appId, instanceId, name, input) => ({ appId, instanceId, name, input }),
    requestHostCapability: async (appId, instanceId, protocol, method, input, options) => requests.run({ ...options, appId, instanceId, protocol, method, input, key: instanceId, owner: { key: 'local' }, surface: 'ui' }, async options => {
      if (method === 'denied') throw Object.assign(new Error('Permission denied'), { code: 'APP_PERMISSION_DENIED', details: { permission: 'fixture:read' } })
      if (method === 'echo') return { ok: 'business result' }
      if (method === 'beginUpdate') { updating = true; return {} }
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => { stopped++; reject(options.signal.reason) }, { once: true }))
    }),
  }
  registerAppUiRequests({ ipc: ipcMain, getState: () => ({ id: 'fixture.ui', runtime }), beginRequest: () => {
    if (updating) throw Object.assign(new Error('Update in progress'), { code: 'UPDATE_IN_PROGRESS' })
    active++
    return () => { active-- }
  } })
  const window = new BrowserWindow({ show: false, webPreferences: {
    preload: fileURLToPath(new URL('../src/apps/app-preload.mjs', import.meta.url)),
    sandbox: false, contextIsolation: true, nodeIntegration: false,
  } })
  try {
    window.webContents.on('preload-error', (_event, _path, error) => console.error('Preload failed:', error))
    window.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message) })
    await fs.writeFile(path.join(directory, 'index.html'), '<html><body>Host bridge test</body></html>')
    await window.loadFile(path.join(directory, 'index.html'))
    const bundled = await build({ entryPoints: [fileURLToPath(new URL('../../packages/app-sdk/src/ui/index.mjs', import.meta.url))], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'MossSdk' })
    const sdk = bundled.outputFiles[0].text + '\nconst { createAppClient } = MossSdk;'
    const result = await window.webContents.executeJavaScript(`(async () => { try {
      ${sdk}
      const client = createAppClient(window.mossApp)
      const action = await client.actions.invoke('echo', { value: 7 })
      const business = await client.host.request('moss.fixture/v1', 'echo')
      const denied = await client.host.request('moss.fixture/v1', 'denied').catch(error => ({ code: error.code, details: error.details }))
      const controller = new AbortController()
      const pending = client.host.request('moss.fixture/v1', 'wait', {}, { signal: controller.signal }).catch(error => error.code)
      setTimeout(() => controller.abort(), 25)
      const cancelledCode = await pending
      const timeout = await client.host.request('moss.fixture/v1', 'wait', {}, { timeoutMs: 100 }).catch(error => error.code)
      await client.host.request('moss.fixture/v1', 'beginUpdate')
      const updateDenied = await client.actions.invoke('echo', {}).catch(error => error.code)
      return { action, business, denied, cancelled: cancelledCode, timeout, updateDenied }
      } catch (error) { return { error: error.message, stack: error.stack } }
    })()`)
    assert.deepEqual(result, {
      action: { appId: 'fixture.ui', instanceId: 'fixture.ui--default', name: 'echo', input: { value: 7 } },
      business: { ok: 'business result' },
      denied: { code: 'APP_PERMISSION_DENIED', details: { permission: 'fixture:read' } },
      cancelled: 'APP_ACTION_CANCELED', timeout: 'APP_HOST_TIMEOUT',
      updateDenied: 'UPDATE_IN_PROGRESS',
    })
    assert.equal(stopped, 2)
    assert.equal(active, 0)
    console.log('Electron bridge verified: bound identity, structured errors, AbortSignal and timeout.')
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally {
    clearTimeout(watchdog)
    window.destroy()
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    app.exit(process.exitCode || 0)
  }

}).catch(error => { console.error(error); app.exit(1) })
