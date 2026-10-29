import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launchTestInstance } from '../src/app-testing/instance.mjs'

const ui = fileURLToPath(new URL('..', import.meta.url))
const output = path.resolve(ui, '../output/creation-desktop-cdp')
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-creation-desktop-'))
const home = path.join(directory, 'profile'), id = randomUUID()
const appModules = path.resolve(ui, '../../moss-apps/node_modules/.bun')
const playwright = (await fs.readdir(appModules)).filter(n => n.startsWith('playwright@')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
const { chromium } = await import(pathToFileURL(path.join(appModules, playwright, 'node_modules/playwright/index.mjs')))
const require = createRequire(path.resolve(ui, '../../moss-apps/apps/pdf-tools/package.json'))
const { loadImage, createCanvas } = require('@napi-rs/canvas')
const apps = [['moss.visualize', '可视化'], ['moss.document', '文档创作'], ['moss.pdf', 'PDF 创作'], ['moss.spreadsheets', '表格'], ['moss.presentations', '演示文稿'], ['moss.templates', '模板']]
let target, browser, page, cdp
const checks = [], exceptions = []
const packages = JSON.parse(await fs.readFile(path.join(ui, 'dist/builtin-apps/manifest.json'), 'utf8')).apps
const mark = label => { checks.push(label); console.log('PASS', label) }
async function until(fn, label) {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)) }
  throw new Error('Timed out: ' + label)
}
async function capture(name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(data, 'base64'))
}
async function openDetails(appId, title) {
  await page.getByRole('button', { name: '插件', exact: true }).first().click()
  await page.getByRole('button', { name: '打开 ' + title, exact: true }).click()
  const details = page.locator(`[data-app-details="${appId}"]`)
  await details.waitFor()
  return details
}
try {
  await fs.mkdir(output, { recursive: true })
  const fixtures = []
  for (const [name, file] of [['report.docx', '项目周报.docx'], ['budget.xlsx', '季度预算.xlsx'], ['slides.pptx', '季度汇报.pptx'], ['report.pdf', '文档.pdf']]) {
    fixtures.push({ name, content: await fs.readFile(path.resolve(ui, '../output/creation-apps/exports', file)) })
  }
  target = await launchTestInstance({ run: { id, directory, home }, executable: path.join(ui, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [ui], cwd: ui,
    settings: { language: 'chinese', agentMode: 'local', appearance: { themeMode: 'light' } }, prepareEnvironment: false,
    runtimeHome: path.join(output, 'runtime-cache'), fixtures, fixtureTitle: '创作 App CDP 验证', signal: new AbortController().signal, timeoutMs: 90000 })
  browser = await chromium.connectOverCDP(target.endpoint)
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes(id)); assert.ok(page)
  page.setDefaultTimeout(30000)
  cdp = await page.context().newCDPSession(page)
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable')
  cdp.on('Runtime.exceptionThrown', e => exceptions.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text))
  await page.waitForSelector('button')
  await capture('desktop-start')
  mark('Real isolated Electron main/preload/production renderer connected over CDP')
  for (const [appId, title] of apps) {
    const details = await openDetails(appId, title)
    assert.equal(await details.getByRole('combobox', { name: '工具使用范围' }).inputValue(), 'global-always')
    assert.equal(await details.getByRole('switch', { name: '启用应用', exact: true }).isChecked(), true)
    assert.equal(await details.getByText('Moss 内置', { exact: true }).count(), 1)
    assert.ok(await details.locator('[data-app-tool]').count() > 0)
    assert.equal(await details.getByRole('region', { name: 'MCP 服务', exact: true }).count(), 0)
    await capture(appId + '-overview')
    await details.getByRole('region', { name: '技能', exact: true }).getByRole('button').first().click()
    await details.locator('aside pre').waitFor()
    assert.ok((await details.locator('aside pre').innerText()).length > 200)
    await capture(appId + '-details-skill')
    assert.equal(await details.getByRole('alert').count(), 0)
    mark(title + ': builtin shared details, enabled/global-always, declared tools/resources and packaged skill')
  }
  let details = await openDetails('moss.templates', '模板')
  const scope = () => details.getByRole('combobox', { name: '工具使用范围' })
  await scope().selectOption('global-demand')
  await until(async () => !await scope().isDisabled(), 'scope saved')
  await page.reload(); await page.getByRole('button', { name: '插件', exact: true }).first().waitFor()
  details = await openDetails('moss.templates', '模板')
  assert.equal(await scope().inputValue(), 'global-demand')
  await scope().selectOption('session'); await until(async () => !await scope().isDisabled(), 'session scope saved')
  await scope().selectOption('global-always'); await until(async () => !await scope().isDisabled(), 'always scope restored')
  mark('Three tool scopes selectable; global-demand persists across real renderer reload; always restored')
  const enabled = () => details.getByRole('switch', { name: '启用应用', exact: true })
  await enabled().click(); await until(async () => !await enabled().isChecked() && !await enabled().isDisabled(), 'disable saved')
  assert.ok(await details.getByRole('button', { name: '试用', exact: true }).isDisabled())
  await page.reload(); await page.getByRole('button', { name: '插件', exact: true }).first().waitFor()
  details = await openDetails('moss.templates', '模板'); assert.equal(await enabled().isChecked(), false)
  await enabled().click(); await until(async () => await enabled().isChecked() && !await enabled().isDisabled(), 'enable saved')
  assert.equal(await details.getByRole('button', { name: '试用', exact: true }).isDisabled(), false)
  mark('Disabled App stays inspectable after reload and re-enables through shared details')
  const example = details.getByRole('region', { name: '试用示例' }).getByRole('button').first()
  const exampleText = (await example.innerText()).replace(/^模板/, '').trim()
  await example.click()
  const composer = page.locator('textarea').filter({ visible: true }).first()
  await composer.waitFor()
  assert.ok((await composer.inputValue()).includes(exampleText))
  assert.equal(await page.locator('[data-app-details]').count(), 0)
  await capture('example-main-conversation')
  mark('Example returns to main conversation and fills natural language without sending')
  await page.getByText('创作 App CDP 验证', { exact: true }).click()
  const expand = page.getByRole('button', { name: /^展开.*(侧栏|工作区)/ }); if (await expand.count()) await expand.click()
  await page.getByText('report.pdf', { exact: true }).click()
  const pdfView = page.locator('[data-pdf-preview]').filter({ visible: true })
  await pdfView.waitFor()
  await pdfView.locator('[data-pdf-page] canvas[data-painted="true"]').first().waitFor()
  // A parsed PDF must have actual painted page pixels.
  // Require visible page pixels before recording a successful preview.
  await until(async () => {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const image = await loadImage(Buffer.from(shot.data, 'base64')), box = await pdfView.locator('[data-pdf-page="1"] canvas').boundingBox()
    assert.ok(box)
    const scale = image.width / await page.evaluate(() => innerWidth)
    const canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
    const pixels = context.getImageData(Math.round(box.x * scale), Math.round(box.y * scale), Math.floor(box.width * scale), Math.floor(box.height * scale)).data
    let white = 0, ink = 0; for (let i = 0; i < pixels.length; i += 4) { if (pixels[i] > 245 && pixels[i + 1] > 245 && pixels[i + 2] > 245) white++; if (pixels[i] < 160 && pixels[i + 1] < 160 && pixels[i + 2] < 160) ink++ }
    return white / (pixels.length / 4) > 0.8 && ink > 100
  }, 'PDF page visibly painted')
  const targets = await cdp.send('Target.getTargets'); await fs.writeFile(path.join(output, 'pdf-targets.json'), JSON.stringify(targets, null, 2))
  await capture('native-pdf-preview')
  mark('Real workspace PDF opens in the paged host viewer')
  await capture('fixture-conversation')
  await fs.writeFile(path.join(output, 'session-dom.txt'), await page.locator('body').innerText())
  await fs.writeFile(path.join(output, 'session-buttons.json'), JSON.stringify(await page.getByRole('button').evaluateAll(nodes => nodes.map(n => ({ text: n.textContent, aria: n.getAttribute('aria-label'), title: n.getAttribute('title') }))), null, 2))
  const log = await fs.readFile(path.join(directory, 'instance.log'), 'utf8')
  assert.doesNotMatch(log, /Builtin App checksum mismatch|\[builtin-apps\].*ERROR/)
  assert.match(log, /"count":7,"loadedApps":7/)
  assert.deepEqual(exceptions, [])
  await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ ok: true, checks, exceptions, packages, scope: 'Real isolated Moss Electron main/preload/production renderer; six packaged builtin Apps. No inherited user credentials or live model requests.' }, null, 2))
  await fs.rm(path.join(output, 'failure.png'), { force: true }); await fs.rm(path.join(output, 'failure.json'), { force: true })
  console.log('Verified:', output)
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, exceptions }, null, 2))
  throw error
} finally {
  await target?.close(); await browser?.close()
  await fs.copyFile(path.join(directory, 'instance.log'), path.join(output, 'instance.log')).catch(() => {})
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}
