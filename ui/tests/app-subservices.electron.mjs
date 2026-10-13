// Run from ui: env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron tests/app-subservices.electron.mjs
import { app, BrowserWindow } from 'electron'
import { createServer } from 'vite'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-subservices-'))
app.setPath('userData', path.join(temp, 'profile'))
app.on('window-all-closed', () => {})
const watchdog = setTimeout(() => app.exit(1), 60_000)
let server, win
const wait = () => new Promise(resolve => setTimeout(resolve, 100))
app.whenReady().then(async () => {
  try {
    server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(temp, 'vite'), server: { host: '127.0.0.1', port: 0, hmr: false } })
    await server.listen()
    win = new BrowserWindow({ show: false, width: 1100, height: 900 })
    const evaluate = code => win.webContents.executeJavaScript(code)
    const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await wait() }
    const clickText = async (selector, text) => {
      await evaluate(`(() => { const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(item => item.textContent.includes(${JSON.stringify(text)})); if (!button) throw new Error('Missing button: ' + ${JSON.stringify(text)}); button.click() })()`)
      await wait()
    }
    const selected = () => evaluate("JSON.parse(document.querySelector('[data-services]').textContent)")
    const press = async keyCode => { for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode }); await wait() }
    const openMention = async () => {
      await evaluate("document.querySelector('textarea').focus()")
      win.webContents.sendInputEvent({ type: 'char', keyCode: '@' }); await wait()
      await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'App').dispatchEvent(new MouseEvent('mousedown', {bubbles:true,cancelable:true}))"); await wait()
    }
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message) })
    await win.loadURL(`${server.resolvedUrls.local[0]}tests/fixtures/app-tool-selection.html?subservices=1`)
    for (let i = 0; i < 100 && !await evaluate("Boolean(document.querySelector('textarea'))"); i++) await wait()
    await openMention()
    await clickText('button[data-active]', '客户服务管理')
    assert.deepEqual(await selected(), [])
    assert.equal(await evaluate("document.querySelectorAll('button[data-active]').length"), 2)
    await fs.writeFile('/tmp/moss-app-subservices-mention.png', (await win.webContents.capturePage()).toPNG())
    await press('Enter')
    assert.deepEqual(await selected(), ['["customer.services","mcp/default/database"]'])
    assert.equal(await evaluate("document.querySelector('[data-selected]').textContent"), '')
    assert.ok(await evaluate("document.querySelector('[aria-label=\"已选资源\"]').textContent.includes('客户服务管理 · 公司数据库')"))
    await click('[data-picker]')
    await clickText('[role="dialog"] button', '客户服务管理')
    assert.equal(await evaluate("[...document.querySelectorAll('[role=\"dialog\"] button')].find(b=>b.textContent.includes('公司数据库')).getAttribute('aria-pressed')"), 'true')
    await clickText('[role="dialog"] button', '全选当前可用服务')
    assert.equal((await selected()).length, 2)
    await click('[data-add-service]')
    assert.equal((await selected()).length, 2)
    assert.equal(await evaluate("[...document.querySelectorAll('[role=\"dialog\"] button')].find(b=>b.textContent.includes('新追加服务')).getAttribute('aria-pressed')"), 'false')
    await fs.writeFile('/tmp/moss-app-subservices-picker.png', (await win.webContents.capturePage()).toPNG())
    await clickText('[role="dialog"] button', '客户服务管理')
    await evaluate(`(() => { const input = document.querySelector('[role="dialog"] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '知识库'); input.dispatchEvent(new Event('input', {bubbles:true})) })()`)
    await wait()
    assert.ok(await evaluate("[...document.querySelectorAll('[role=\"dialog\"] button')].some(b=>b.textContent.includes('内部知识库') && b.getAttribute('aria-pressed')==='true')"))
    await clickText('[role="dialog"] button', '确定')
    await click('[data-switch]')
    assert.deepEqual(await selected(), [])
    await click('[data-switch]')
    assert.equal((await selected()).length, 2)
    await click('[aria-label="移除服务：客户服务管理 · 公司数据库"]')
    assert.deepEqual(await selected(), ['["customer.services","mcp/default/knowledge"]'])
    await openMention()
    await clickText('button[data-active]', '客户服务管理')
    await press('Escape')
    assert.ok(await evaluate("[...document.querySelectorAll('button[data-active]')].some(b => b.textContent.includes('客户服务管理'))"))
    console.log('PASS two-level mention and resource selection, keyboard navigation, direct search, precise chips, select-all snapshot and session isolation')
  } catch (error) {
    console.error(error)
    if (win) await fs.writeFile('/tmp/moss-app-subservices-failure.png', (await win.webContents.capturePage()).toPNG())
    process.exitCode = 1
  } finally {
    win?.destroy(); await server?.close(); clearTimeout(watchdog)
    await fs.rm(temp, { recursive: true, force: true }); app.exit(process.exitCode || 0)
  }
})
