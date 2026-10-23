import { app, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-discovery-ui-'))
const output = path.join(root, '../output/app-tool-organization-20261023/ui')
app.setPath('userData', path.join(temp, 'profile'))
const errors = []
let server, win
const delay = () => new Promise(resolve => setTimeout(resolve, 100))
const watchdog = setTimeout(() => app.exit(1), 60000)
app.whenReady().then(async () => {
try {
  server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(temp, 'vite'), server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } })
  await server.listen()
  win = new BrowserWindow({ show: false, width: 1200, height: 850, useContentSize: true })
  win.webContents.on('console-message', (_event, level, text) => { if (level >= 3) errors.push(text) })
  const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn})(${args.map(arg => JSON.stringify(arg)).join(',')})`)
  const until = async fn => { for (let i = 0; i < 150; i++) { if (await evaluate(fn)) return; await delay() } throw new Error('UI condition timed out: ' + fn) }
  const click = async (text, selector = 'button') => { assert(await evaluate((text, selector) => { const item = [...document.querySelectorAll(selector)].find(el => el.textContent.trim().startsWith(text)); item?.click(); return Boolean(item) }, text, selector), `missing ${text}`); await delay() }
  const selectGroup = async value => { assert(await evaluate(value => { const select = document.querySelector('select[aria-label="应用分区"]'); if (!select) return false; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); return true }, value), 'missing App group selector'); await delay() }
  const titles = () => evaluate(() => [...document.querySelectorAll('section h3')].map(el => el.textContent))
  const capture = async name => { await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()) }
  await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/app-discovery.html`)
  await until(() => Boolean(document.querySelector('[data-app-discovery]')))
  assert.deepEqual(await titles(), ['数据库'], 'installed Apps open on the application section')
  assert.deepEqual(await evaluate(() => [...document.querySelector('select[aria-label="应用分区"]').options].map(option => option.value)), ['app', 'tool'])
  assert.equal(await evaluate(() => document.querySelectorAll('[data-app-discovery] select').length), 1)
  assert.equal(await evaluate(() => document.body.textContent.includes('常用')), false)
  assert.equal(await evaluate(() => Boolean(document.querySelector('button[title="固定到常用"]'))), false)
  assert.equal(await evaluate(() => Boolean(document.querySelector('select[aria-label="认证方式"]'))), false)
  await capture('installed-app-light')
  win.setContentSize(520, 850)
  await delay()
  assert(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow installed Apps layout overflows horizontally')
  assert(await evaluate(() => Boolean([...document.querySelectorAll('button')].find(button => button.textContent.includes('本地安装 ZIP')))), 'ZIP install label is hidden in the narrow layout')
  await click('本地安装 ZIP')
  assert.equal(await evaluate(() => window.__archiveImports), 1)
  win.setContentSize(1200, 850)
  await delay()
  await selectGroup('app')
  assert.deepEqual(await titles(), ['数据库'])
  await selectGroup('tool')
  assert.equal((await titles()).length, 4)
  assert.equal(await evaluate(() => document.querySelectorAll('[data-app-discovery] select').length), 1)
  assert(await evaluate(() => { const card = [...document.querySelectorAll('section')].find(item => item.querySelector('h3')?.textContent === '腾讯地图'); const button = [...(card?.querySelectorAll('button') || [])].find(item => item.textContent.trim().startsWith('管理')); button?.click(); return Boolean(button) }), 'missing Tencent Map settings')
  await until(() => Boolean(document.querySelector('[data-app-connector] input[type="password"]')))
  await capture('online-settings-light')
  await click('应用市场')
  await until(() => document.querySelector('h1')?.textContent.includes('应用市场'))
  assert.equal(await evaluate(() => Boolean(document.querySelector('select[aria-label="认证方式"]'))), false)
  assert.equal((await titles()).length, 2, 'application section includes unclassified legacy Apps')
  assert((await titles()).includes('自定义应用'))
  await selectGroup('tool')
  assert.equal((await titles()).length, 5)
  assert.equal(await evaluate(() => document.querySelectorAll('[data-app-discovery] select').length), 1)
  await click('本地安装 ZIP')
  assert.equal(await evaluate(() => window.__archiveImports), 2)
  await capture('market-tools-light')
  await click('详情')
  await until(() => document.body.textContent.includes('KB'))
  await evaluate(() => document.documentElement.dataset.theme = 'dark')
  await delay()
  assert(await evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim() !== ''), 'theme must load')
  await capture('market-tools-dark')
  win.setContentSize(520, 850)
  await delay()
  assert(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow layout overflows horizontally')
  assert(await evaluate(() => { const title = document.querySelector('[data-app-header] h1').getBoundingClientRect(), group = document.querySelector('select[aria-label="应用分区"]').getBoundingClientRect(); return title.bottom <= group.top || title.right <= group.left }), 'narrow group selector overlaps the title')
  await capture('market-tools-narrow')
  assert.equal(await evaluate(() => document.body.textContent.includes('隐藏应用')), false)
  await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/app-discovery.html?empty=1`)
  await until(() => document.querySelector('h1')?.textContent === '应用市场')
  assert.equal(await evaluate(() => Boolean(document.querySelector('[title="返回已安装 App"]'))), false)
  await capture('empty-start-marketplace')
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ ok: true, checks: ['installed-applications', 'only-application-tool-sections', 'no-extra-filters', 'legacy-app-visible', 'connector-settings', 'market-tools', 'market-details', 'archive-import', 'no-hidden-apps', 'empty-marketplace', 'light-dark-narrow'], errors }, null, 2))
  console.log('App discovery UI checks passed')
} catch (error) { console.error(error); process.exitCode = 1 }
finally { clearTimeout(watchdog); win?.destroy(); await server?.close(); await fs.rm(temp, { recursive: true, force: true }); app.exit(process.exitCode || 0) }

})
