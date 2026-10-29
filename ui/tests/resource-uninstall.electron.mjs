import { app, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-resource-uninstall-'))
const output = path.join(root, '../output/resource-uninstall')
app.setPath('userData', path.join(temp, 'profile'))
const errors = []
let server, win
const delay = () => new Promise(resolve => setTimeout(resolve, 80))
const watchdog = setTimeout(() => app.exit(1), 60000)
app.whenReady().then(async () => {
  try {
    server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(temp, 'vite'), server: { host: '127.0.0.1', port: 0, hmr: false } })
    await server.listen()
    win = new BrowserWindow({ show: false, width: 1100, height: 850, useContentSize: true })
    win.webContents.on('console-message', (_event, level, text) => { if (level >= 3) errors.push(text) })
    const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`)
    const until = async fn => { for (let i = 0; i < 100; i++) { if (await evaluate(fn)) return; await delay() } throw new Error('UI condition timed out: ' + fn) }
    const click = async selector => { assert(await evaluate(selector => { const el = document.querySelector(selector); el?.click(); return Boolean(el) }, selector), `missing ${selector}`); await delay() }
    const clickText = async (text, selector = 'button') => { assert(await evaluate((text, selector) => { const el = [...document.querySelectorAll(selector)].find(el => el.textContent.trim().startsWith(text)); el?.click(); return Boolean(el) }, text, selector), `missing ${text}`); await delay() }
    const load = async () => {
      await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/resource-uninstall.html`)
      await until(() => document.querySelectorAll('button[aria-label^="打开 "]').length === 4)
    }
    const capture = async name => { await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()) }
    const assertHeaderAction = async () => {
      assert.equal(await evaluate(() => document.querySelectorAll('[data-resource-uninstall]').length), 1)
      assert.equal(await evaluate(() => Boolean(document.querySelector('[data-installed-resource-details] header [data-resource-uninstall]'))), true)
    }
    await load()
    await click('[aria-label="打开 内置技能"]')
    assert.equal(await evaluate(() => document.querySelectorAll('[data-resource-uninstall]').length), 0, 'builtins cannot be uninstalled')
    await click('[aria-label="技能详情导航"] button')

    for (const [kind, title, sourcePath] of [['skill', '资料整理', '/fixture/skills/research'], ['expert', '分析专家', '/fixture/assistants/analyst']]) {
      await click(`[aria-label="打开 ${title}"]`)
      await assertHeaderAction()
      await capture(`${kind}-light`)
      await evaluate(() => { window.__uninstall.confirm = false })
      const before = await evaluate(() => window.__uninstall.calls.length)
      await click('[data-resource-uninstall]')
      assert.equal(await evaluate(() => window.__uninstall.calls.length), before, 'cancel never calls uninstall')
      await evaluate(() => { window.__uninstall.confirm = true; window.__uninstall.mode = 'fail' })
      await click('[data-resource-uninstall]')
      await until(() => document.querySelector('[data-installed-resource-details] [role="alert"]')?.textContent.includes('测试卸载失败'))
      assert.equal(await evaluate(() => document.querySelector('[data-resource-uninstall]').matches(':disabled')), false)
      await evaluate(() => { window.__uninstall.mode = 'throw' })
      await click('[data-resource-uninstall]')
      await until(() => document.querySelector('[data-installed-resource-details] [role="alert"]')?.textContent.includes('测试连接中断'))
      await evaluate(() => { window.__uninstall.mode = 'pending' })
      await click('[data-resource-uninstall]')
      assert.equal(await evaluate(() => document.querySelector('[data-resource-uninstall]').matches(':disabled')), true)
      assert.equal(await evaluate(() => document.querySelector('[data-installed-resource-details] nav button').disabled), true)
      await click('[data-resource-uninstall]')
      assert.equal(await evaluate(() => window.__uninstall.calls.length), before + 3, 'pending prevents duplicate uninstall')
      assert.deepEqual(await evaluate(() => window.__uninstall.calls.at(-1)), { kind, sourcePath })
      await evaluate(() => window.__uninstall.finish())
      await until(() => !document.querySelector('[data-installed-resource-details]'))
      assert.equal(await evaluate(title => Boolean(document.querySelector(`[aria-label="打开 ${title}"]`)), title), false, 'success refreshes the common list')
    }
    await click('[aria-label="打开 研究团队"]')
    await assertHeaderAction()
    await evaluate(() => { window.__uninstall.mode = 'success' })
    await click('[data-resource-uninstall]')
    await until(() => !document.querySelector('[data-installed-resource-details]'))
    assert.equal(await evaluate(() => window.__uninstall.confirmations.at(-1)), '确定卸载专家团“研究团队”？')
    assert.deepEqual(await evaluate(() => window.__uninstall.calls.at(-1)), { kind: 'expert', sourcePath: '/fixture/assistants/team' })

    for (const [tab, title, installedTab] of [['技能', '资料整理', '已安装'], ['专家', '分析专家', '我安装的']]) {
      await load()
      await clickText(tab, '[role="tablist"] button')
      await clickText(installedTab)
      await until(() => document.querySelectorAll('button[aria-label^="打开 "]').length === 2)
      assert.equal(await evaluate(() => document.querySelectorAll('[title="卸载"], [data-resource-uninstall]').length), 0, 'installed cards only open details')
      await click(`[aria-label="打开 ${title}"]`)
      await assertHeaderAction()
      if (tab === '技能') {
        await clickText('SKILL.md')
        await until(() => document.querySelector('pre')?.textContent.includes('测试说明内容'))
        win.setContentSize(420, 850)
        await evaluate(() => { document.documentElement.dataset.theme = 'dark' })
        await delay()
        assert(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow details fit')
        await capture('skill-narrow-dark')
        win.setContentSize(1100, 850)
      }
      await click('[data-resource-uninstall]')
      await until(() => !document.querySelector('[data-installed-resource-details]'))
      assert.equal(await evaluate(title => Boolean(document.querySelector(`[aria-label="打开 ${title}"]`)), title), false, 'installed list removes deleted resource')
      assert(await evaluate(text => [...document.querySelectorAll('button')].some(el => el.textContent.trim() === `${text} 1`), installedTab), 'installed count refreshes')
    }
    assert.deepEqual(errors, [])
    console.log('PASS resource uninstall: common skill/expert/team, builtin protection, cancel, error/retry, pending guard, installed lists, header layout')
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    clearTimeout(watchdog)
    win?.destroy()
    await server?.close()
    await fs.rm(temp, { recursive: true, force: true })
    app.exit(process.exitCode || 0)
  }
})
