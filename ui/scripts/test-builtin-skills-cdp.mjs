import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launchTestInstance } from '../src/app-testing/instance.mjs'

const ui = fileURLToPath(new URL('..', import.meta.url)), core = path.dirname(ui)
const output = path.join(core, 'output/builtin-skills-cdp')
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-builtin-skills-'))
const home = path.join(directory, 'profile'), id = randomUUID()
const modules = path.resolve(core, '../moss-apps/node_modules/.bun')
const version = (await fs.readdir(modules)).filter(name => name.startsWith('playwright@')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
const { chromium } = await import(pathToFileURL(path.join(modules, version, 'node_modules/playwright/index.mjs')))
const run = promisify(execFile), checks = [], exceptions = []
let target, browser, page, cdp
const mark = message => { checks.push(message); console.log('PASS', message) }
const capture = async name => {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'))
}
async function common() {
  const back = page.locator('[data-installed-resource-details] nav').getByRole('button', { name: '常用', exact: true })
  if (await back.count()) await back.click()
  await page.getByRole('button', { name: '插件', exact: true }).first().click()
  await page.getByRole('tab', { name: '常用', exact: true }).click()
}
try {
  await fs.mkdir(output, { recursive: true })
  target = await launchTestInstance({ run: { id, directory, home }, executable: path.join(ui, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [ui], cwd: ui,
    settings: { language: 'chinese', agentMode: 'local', appearance: { themeMode: 'light' } }, prepareEnvironment: false,
    runtimeHome: path.join(output, 'runtime-cache'), signal: new AbortController().signal, timeoutMs: 90000 })
  browser = await chromium.connectOverCDP(target.endpoint)
  page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes(id)); assert.ok(page)
  page.setDefaultTimeout(25000)
  cdp = await page.context().newCDPSession(page); await cdp.send('Runtime.enable'); await cdp.send('Page.enable')
  cdp.on('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text))
  await page.getByRole('button', { name: '插件', exact: true }).first().waitFor()
  const installed = await page.evaluate(() => window.agentDesktop.skillHub.getInstalled())
  assert.equal(installed.success, true)
  for (const name of ['skill-creator', 'skill-installer', 'imagegen']) {
    const entries = installed.data.filter(skill => skill.name === name)
    assert.equal(entries.length, 1); assert.equal(entries[0].isBuiltin, true)
  }
  mark('Real IPC catalog exposes exactly three builtin skills with builtin provenance')
  for (const [name, title] of [['skill-creator', '技能创建'], ['skill-installer', '技能安装'], ['imagegen', '图片生成']]) {
    await common()
    await page.getByRole('button', { name: '打开 ' + title, exact: true }).click()
    const details = page.locator('[data-installed-resource-details="skill"]')
    await details.getByRole('heading', { name: title, exact: true }).waitFor()
    assert.ok(await details.getByText('Moss 内置', { exact: true }).count())
    await details.getByRole('button', { name: /SKILL.md/ }).click()
    await details.locator('aside pre').waitFor()
    assert.ok((await details.locator('aside pre').innerText()).includes('name: ' + name))
    assert.equal(await details.getByRole('alert').count(), 0)
    await capture(name + '-details')
    mark(title + ': common card opens shared details and actual instructions')
  }
  await common(); await page.getByRole('tab', { name: '技能', exact: true }).click()
  await page.getByRole('button', { name: /^已安装/ }).click()
  const imageCard = page.getByRole('button', { name: '打开 图片生成', exact: true })
  await imageCard.waitFor()
  assert.equal(await page.getByTitle('卸载', { exact: true }).count(), 0)
  await capture('installed-builtin-skills')
  await imageCard.click()
  assert.ok(await page.locator('[data-installed-resource-details="skill"]').getByText('Moss 内置', { exact: true }).count())
  mark('Skills installed tab uses the same details and does not offer uninstall for bundled originals')

  const body = path.join(directory, 'instructions.md'); await fs.writeFile(body, '# 测试周报\n根据用户材料生成事实与待办。\n')
  const creator = path.join(core, 'skills/skill-creator/scripts/skill.py'), installer = path.join(core, 'skills/skill-installer/scripts/install.py')
  const created = JSON.parse((await run('python3', ['-B', creator, 'init', 'demo-weekly-report', '--description', '从材料整理周报', '--instructions-file', body, '--dest', path.join(directory, 'source')])).stdout)
  const inspected = JSON.parse((await run('python3', ['-B', installer, 'inspect', '--source', created.path])).stdout)
  await run('python3', ['-B', installer, 'install', '--source', created.path, '--expected-digest', inspected.digest, '--dest', path.join(home, 'skills')])
  await page.reload(); await page.getByRole('button', { name: '插件', exact: true }).first().waitFor()
  const updated = await page.evaluate(() => window.agentDesktop.skillHub.getInstalled())
  const demo = updated.data.find(skill => skill.name === 'demo-weekly-report')
  assert.ok(demo); assert.equal(demo.isBuiltin, false); assert.equal(demo.isUploaded, true)
  await common(); await page.getByRole('button', { name: '打开 demo-weekly-report', exact: true }).click()
  await page.locator('[data-installed-resource-details="skill"]').getByRole('button', { name: /SKILL.md/ }).click()
  await page.locator('aside pre').waitFor()
  assert.ok((await page.locator('aside pre').innerText()).includes('测试周报'))
  await capture('created-and-installed-skill')
  mark('Creator + inspected install write into isolated personal profile and appear in real catalog/details after reload')

  await common(); await page.getByRole('button', { name: '打开 应用构建', exact: true }).click()
  let details = page.locator('[data-app-details="moss.app-builder"]'); await details.waitFor()
  assert.equal(await details.getByRole('combobox', { name: '工具使用范围' }).inputValue(), 'global-demand')
  assert.equal(await details.locator('[data-app-tool]').count(), 5)
  assert.equal(await details.getByText('Moss 内置', { exact: true }).count(), 1)
  await details.getByRole('region', { name: '技能', exact: true }).getByRole('button').first().click()
  await details.locator('aside pre').waitFor()
  assert.ok((await details.locator('aside pre').innerText()).includes('name: app-creator'))
  await capture('builder-details')
  await details.getByRole('button', { name: '打开', exact: true }).click()
  const workbench = page.locator('webview').filter({ visible: true }); await workbench.waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('webview')].some(view => view.offsetWidth > 0 && !view.isLoading()))
  const content = await workbench.evaluate(view => view.executeJavaScript('document.body.innerText'))
  assert.ok(content.includes('创建') && content.includes('选择资源'), content)
  await capture('builder-workbench')
  mark('Builtin Builder: global on-demand, five tools, app-creator skill and retained operational workbench')
  await common(); await page.getByRole('button', { name: '打开 应用构建', exact: true }).click()
  details = page.locator('[data-app-details="moss.app-builder"]')
  await details.getByRole('region', { name: '试用示例', exact: true }).getByRole('button').first().click()
  const composer = page.locator('textarea').filter({ visible: true }).first(); await composer.waitFor()
  assert.ok((await composer.inputValue()).includes('文本统计'))
  assert.equal(await page.locator('[data-app-details]').count(), 0)
  await capture('builder-main-conversation-example')
  mark('Builder example returns to main conversation and fills request without sending or calling a model')
  assert.deepEqual(exceptions, [])
  for (const name of ['failure.png', 'failure.json', 'failure-dom.txt']) await fs.rm(path.join(output, name), { force: true })
  await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ ok: true, checks, exceptions, scope: 'Isolated Electron production renderer/preload/IPC; no live model or paid image provider calls.' }, null, 2))
} catch (error) {
  await capture('failure').catch(() => {})
  if (page) await fs.writeFile(path.join(output, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => ''))
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, exceptions }, null, 2))
  throw error
} finally {
  await target?.close(); await browser?.close()
  await fs.copyFile(path.join(directory, 'instance.log'), path.join(output, 'instance.log')).catch(() => {})
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
