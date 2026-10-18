// Real Desktop + installed App acceptance, driven by a scripted or real model.
import assert from 'node:assert/strict'
import { isExpectedControllerCancellation } from '../../src/app-testing/controller-cancellation.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { app, BrowserWindow, ipcMain, dialog, webContents } from 'electron'


const root = process.env.MOSS_SELF_TEST_APP_ROOT
assert.equal(await fs.readFile(path.join(root, '.self-test-app-verification'), 'utf8'), 'isolated self-test App verification')
assert.equal(root, process.env.MOSS_HOME)
const uiRoot = fileURLToPath(new URL('../..', import.meta.url))
app.setAppPath(uiRoot)
app.setPath('userData', path.join(root, 'electron'))
const handlers = new Map(), originalHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (name, handler) => { handlers.set(name, handler); return originalHandle(name, handler) }
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [process.env.MOSS_SELF_TEST_APP_ZIP] })
dialog.showMessageBox = async () => ({ response: 1 })
let mainWindow, done
const ready = new Promise(resolve => { done = resolve })
app.on('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false)
  if (mainWindow) return
  mainWindow = window
  window.webContents.once('did-finish-load', done)
})
async function until(read, predicate, label, timeout = 30000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await read().catch(() => null)
    if (predicate(value)) return value
    await delay(150)
  }
  throw new Error(`Timed out: ${label}`)
}
const invoke = (name, input) => handlers.get(name)({ sender: mainWindow.webContents }, input)
const click = text => mainWindow.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw new Error('Missing button'); button.click() })()`)
let appPage
const action = async (name, input = {}) => {
  if (appPage?.isDestroyed()) { await click('设置'); await click('Apps'); await click('AI 自测'); appPage = await findAppPage() }
  // Use the same bound IPC for observation; the Start button below uses the UI.
  const response = await handlers.get('app-ui:actions:invoke')({ sender: appPage }, { name, input, requestId: crypto.randomUUID() })
  if (!response.ok) throw new Error(response.error.message)
  return response.result
}
const findAppPage = () => until(async () => {
  for (const contents of webContents.getAllWebContents()) {
    if (contents !== mainWindow.webContents && await contents.executeJavaScript('window.mossApp?.app.getInfo().then(i=>i.id)').catch(() => null) === 'moss.self-test') return contents
  }
}, Boolean, 'bound App settings webview')
async function verify() {
try {
  assert.equal((await invoke('app:install-archive')).ok, true)
  const listed = await invoke('app:list')
  assert.ok(listed.some(item => item.id === 'moss.self-test'))
  assert.ok(!handlers.has('self-test:start'), 'Legacy self-test IPC must be removed')
  const all = await invoke('app:list-contributions', { kinds: ['tools'], selectedAppIds: [] })
  assert.ok(!all.tools.some(tool => tool.appId === 'moss.self-test'))
  const selected = await invoke('app:list-contributions', { kinds: ['tools'], selectedAppIds: ['moss.self-test'] })
  assert.equal(selected.tools.filter(tool => tool.appId === 'moss.self-test').length, 1)
  await until(() => click('设置').then(() => true), Boolean, 'settings button')
  await until(() => click('Apps').then(() => true), Boolean, 'App settings group')
  await until(() => click('AI 自测').then(() => true), Boolean, 'self-test settings entry')
  appPage = await findAppPage()
  const initialCatalog = await action('catalog')
  await until(() => appPage.executeJavaScript('document.querySelectorAll(".case-select input[type=checkbox]").length'), count => count === initialCatalog.cases.length, 'App test catalog')
  assert.equal(await mainWindow.webContents.executeJavaScript('document.querySelector("[data-settings-nav=apps]")?.getAttribute("aria-current")'), 'page')
  const settings = await invoke('agent:get-settings')
  for (const themeMode of ['dark', 'light']) {
    await invoke('agent:update-settings', { appearance: { ...settings.appearance, themeMode } })
    await until(() => appPage.executeJavaScript('document.documentElement.dataset.theme'), value => value === themeMode, `theme ${themeMode}`)
    await fs.writeFile(path.join(root, `app-${themeMode}.png`), (await mainWindow.webContents.capturePage()).toPNG())
  }
  // UI cannot forge the trusted controller identity when submitting a result.
  await assert.rejects(() => action('self-test', { action: 'record', run_id: '11111111-1111-1111-1111-111111111111', case_id: 'startup', status: 'passed' }), /只有本轮测试会话/)
  const cases = JSON.parse(process.env.MOSS_SELF_TEST_APP_CASES || '["startup"]')
  const catalog = await action('catalog')
  await appPage.executeJavaScript(`(() => {
    const ids = ${JSON.stringify(catalog.cases.map(item => item.id))}, selected = ${JSON.stringify(cases)};
    [...document.querySelectorAll('.case-select input[type=checkbox]')].forEach((input,index) => { if (input.checked !== selected.includes(ids[index])) input.click() });
  })()`)
  await delay(100)
  await appPage.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent==='开始自测').click()`)
  let run = await until(() => action('status'), value => value?.id, 'run creation')
  let previous = '', focusChecked = false
  const deadline = Date.now() + (Number(process.env.MOSS_SELF_TEST_APP_TIMEOUT_MS) || 50 * 60000)
  do {
    await delay(500)
    if (appPage.isDestroyed()) {
      await click('设置'); await click('Apps'); await click('AI 自测')
      appPage = await findAppPage()
    }
    run = await action('status')
    if (run.phase === 'running' && !focusChecked) {
      assert.equal(await mainWindow.webContents.executeJavaScript('document.querySelector("[data-settings-nav=apps]")?.getAttribute("aria-current")'), 'page', 'Starting a controller must keep the live self-test dashboard open')
      await action('instance.open'); focusChecked = true
    }
    const progress = `${run.phase}: ${run.message}`
    if (progress !== previous) { console.log(`SELF_TEST_APP: ${progress}`); previous = progress }
    if (Date.now() > deadline) throw new Error('Run deadline exceeded')
  } while (!run.finishedAt)
  await fs.writeFile(path.join(root, 'run.json'), JSON.stringify(run, null, 2))
  if (process.env.MOSS_SELF_TEST_APP_SCRIPTED === '1') assert.equal(run.phase, 'completed', run.message)
  else assert.ok(['completed', 'failed'].includes(run.phase), run.message)
  assert.ok(focusChecked, 'Running target can be focused without restarting it')
  const report = await until(async () => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/report.html') && !window.webContents.isLoading()), Boolean, 'automatic HTML report')
  await fs.writeFile(path.join(root, 'report.png'), (await report.webContents.capturePage()).toPNG())
  assert.ok((await fs.readFile(run.reportHtmlPath, 'utf8')).includes('data:image/png;base64,'))
  const target = await action('instance.status')
  assert.equal(target.phase, 'open')
  assert.ok(run.directory.startsWith(path.join(await fs.realpath(root), 'apps-data', 'moss.self-test')))
  const session = await invoke('agent:get-session', { sessionId: run.sessionId })
  assert.equal(session.permissionMode, 'bypassPermissions')
  assert.ok(session.appIds.includes('moss.self-test'))
  // A result can include earlier real MCP errors and an expected final abort.
  // Those mixed failures must remain visible; only a pure stop diagnostic is a
  // cleanup leak. Searching all history text incorrectly rejects both cases.
  const recordedCancellations = session.history.filter(item => isExpectedControllerCancellation(
    item.type === 'error' ? new Error(String(item.message || '')) : item,
    AbortSignal.abort(),
  ))
  if (recordedCancellations.length) {
    await fs.writeFile(path.join(root, 'controller-abort-history.json'), JSON.stringify(
      recordedCancellations, null, 2))
  }
  assert.equal(recordedCancellations.length, 0, 'Expected recorded-turn cancellation must not appear as an error')
  assert.equal(run.resetData, true)
  assert.ok(run.environmentReadyAt >= run.startedAt && run.controllerReadyAt >= run.environmentReadyAt)
  // Reopening a page keeps the Backend and the completed run; target open reuses its process.
  await click('工具'); await click('Apps'); await click('AI 自测')
  appPage = await findAppPage()
  assert.equal((await action('status')).id, run.id)
  await action('instance.open')
  const reopened = await until(() => action('instance.status'), value => value && !value.operation, 'target reuse')
  assert.equal(reopened.pid, target.pid)
  const { verifyRunEvidence } = await import(pathToFileURL(process.env.MOSS_SELF_TEST_APP_EVIDENCE_CHECK).href)
  const evidence = await verifyRunEvidence(run)
  let stopChecked = false, finalTarget = target
  if (process.env.MOSS_SELF_TEST_APP_SCRIPTED === '1') {
    const sentinel = path.join(target.home, 'sessions', 'previous-run-sentinel.txt')
    await fs.writeFile(sentinel, 'previous test data')
    const second = await action('run.start', { caseIds: cases })
    assert.notEqual(second.id, run.id)
    await until(() => action('status'), value => value?.id === second.id && value.phase === 'running', 'second run started')
    await delay(500)
    await action('run.stop', { runId: second.id })
    const canceled = await until(() => action('status'), value => value?.id === second.id && value.finishedAt, 'stop settles controller')
    assert.equal(canceled.phase, 'canceled', canceled.message)
    finalTarget = await action('instance.status')
    assert.notEqual(finalTarget.pid, target.pid, 'Default run reset must restart the target')
    assert.notEqual(canceled.sessionId, run.sessionId, 'Every run must create a fresh controller conversation')
    await assert.rejects(() => fs.access(sentinel))
    await fs.access(run.reportPath)
    await fs.writeFile(path.join(root, 'canceled-run.json'), JSON.stringify(canceled, null, 2))
    stopChecked = true
  }
  await invoke('app:set-enabled', { appId: 'moss.self-test', enabled: false })
  await until(async () => { try { process.kill(finalTarget.pid, 0); return false } catch { return true } }, Boolean, 'App deactivation target cleanup')
  const verification = { passed: true, runPhase: run.phase, runId: run.id, reportPath: run.reportPath, reportHtmlPath: run.reportHtmlPath,
    cases, evidence, stopChecked, checks: ['installed App', 'settings entry', 'session scope', 'button start', 'theme sync', 'trusted result source', 'model to CDP to App result', 'automatic report', 'page reopen', 'focus during run', 'target reuse', 'fresh controller per run', 'default data reset', 'expected abort suppressed', 'phase timing', 'disable cleanup'] }
  await fs.writeFile(path.join(root, 'verification.json'), JSON.stringify(verification, null, 2))
  console.log(`SELF_TEST_APP_PASSED: ${root}`)
  app.quit()
} catch (error) {
  console.error('SELF_TEST_APP_FAILED:', error.stack || error)
  await fs.writeFile(path.join(root, 'error.json'), JSON.stringify({ error: error.message }))
  await action('run.stop').catch(() => {})
  await invoke('app:set-enabled', { appId: 'moss.self-test', enabled: false }).catch(() => {})
  app.exit(1)
}

}
void ready.then(verify)
await import('../../src/main.mjs')
