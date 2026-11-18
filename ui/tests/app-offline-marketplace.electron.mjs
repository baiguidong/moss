// Run against the CI release directory. Market saves the media used by --offline. --online tests first launch.
import { app, dialog } from 'electron'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs, { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { AppProcessSupervisor } from '../../packages/app-runtime/src/process/index.mjs'

const ui = fileURLToPath(new URL('..', import.meta.url))
const apps = process.env.MOSS_APPS_ROOT || path.resolve(ui, '../../moss-apps')
const releaseDir = path.resolve(process.env.MOSS_TEST_RELEASE_DIR || '')
const recordFile = (await fsp.readdir(releaseDir)).find((name) => name.endsWith('.release.json'))
const {
  app: { id },
  version: release,
} = JSON.parse(await fsp.readFile(path.join(releaseDir, recordFile)))
const platform = process.platform + '-' + process.arch
const kit = release.offlineKits[platform],
  online = release.artifacts?.[platform] || release.artifact
const output = path.join(releaseDir, 'verification')
const mode = process.argv.includes('--offline')
  ? 'offline'
  : process.argv.includes('--online')
    ? 'online'
    : 'market'
const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-market-test-'))
const media = path.join(root, 'media')
const saved = path.join(output, kit.fileName)
const checks = []
let searchHit,
  supervisor,
  sandboxStarts = 0
const uiWindows = []
const desktopErrors = []
// A native error dialog must fail unattended acceptance, including during window teardown.
dialog.showErrorBox = (title, message) => desktopErrors.push(title + ': ' + message)
process.on('uncaughtExceptionMonitor', error => desktopErrors.push(error.stack))
const approvals = []
process.env.MOSS_HOME = process.env.MOSS_CONFIG_DIR = path.join(root, 'home')
process.env.MOSS_RUNTIME_HOME = path.join(root, 'runtimes')
process.env.MOSS_OPEN_DEVTOOLS = 'false'
app.setAppPath(ui)
app.setPath('userData', path.join(root, 'electron'))
app.on('window-all-closed', () => {})
app.on('browser-window-created', (_event, window) => {
  uiWindows.push(window)
  window.show = () => {}
  window.showInactive = () => {}
})
dialog.showMessageBox = async (...args) => {
  const options = args.at(-1)
  const reviewed = options.message?.includes('语义知识库') && options.buttons?.[1]?.includes('安装')
  if (reviewed) approvals.push(options)
  return { response: reviewed ? 1 : (options.cancelId ?? 0) }
}
dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved })
dialog.showOpenDialog = async (...args) => ({
  canceled: false,
  filePaths: [path.join(media, args.at(-1).title === 'Install Moss App' ? online.fileName : 'offline.json')],
})
const site = path.join(root, 'catalog')
let origin, server
const requests = []
async function stageCatalog() {
  const names = new Set([kit.fileName, online.fileName])
  const draft = process.env.MOSS_TEST_GITHUB_DRAFT_ID
  const remoteFiles = new Map()
  if (draft) {
    assert.match(draft, /^\d+$/)
    const repo = 'baiguidong/moss-apps'
    const assets = JSON.parse(
      execFileSync('gh', ['api', `repos/${repo}/releases/${draft}/assets`], { encoding: 'utf8' }),
    )
    // The renderer receives only the test origin. GitHub credentials stay in the test process.
    const credential = execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], {
      encoding: 'utf8',
    }).trim()
    for (const name of names) {
      const asset = assets.find((entry) => entry.name === name)
      assert.ok(Number.isSafeInteger(asset?.id))
      const response = await fetch(
        `https://api.github.com/repos/${repo}/releases/assets/${asset.id}?run=${Date.now()}`,
        {
          redirect: 'manual',
          headers: { Accept: 'application/octet-stream', Authorization: 'Bearer ' + credential },
        },
      )
      await response.body?.cancel()
      assert.equal(response.status, 302)
      const url = new URL(response.headers.get('location'))
      assert.equal(url.protocol, 'https:')
      assert.equal(url.hostname, 'release-assets.githubusercontent.com')
      remoteFiles.set(name, url.href)
    }
  }
  server = createServer(async (req, res) => {
    const url = new URL(req.url, origin)
    try {
      if (url.pathname.startsWith('/files/')) {
        const name = url.pathname.slice(7)
        if (!names.has(name)) throw Error('Unknown asset')
        requests.push(name)
        if (remoteFiles.has(name)) {
          res.writeHead(302, { Location: remoteFiles.get(name) })
          res.end()
          return
        }
        const file = path.join(releaseDir, name)
        res.writeHead(200, { 'Content-Length': (await fsp.stat(file)).size })
        createReadStream(file).pipe(res)
      } else if (['/v1/index.json', '/v1/apps/' + id + '.json'].includes(url.pathname)) {
        const data = await fsp.readFile(path.join(site, url.pathname), 'utf8')
        res.setHeader('Content-Type', 'application/json')
        // Only the staging asset locations differ from the generated release catalog.
        res.end(
          data
            .replaceAll(online.downloadUrl, origin + '/files/' + online.fileName)
            .replaceAll(kit.downloadUrl, origin + '/files/' + kit.fileName),
        )
      } else if (url.pathname === '/v1/assets/' + id + '.svg') {
        res.setHeader('Content-Type', 'image/svg+xml')
        res.end(await fsp.readFile(path.join(site, url.pathname)))
      } else {
        res.writeHead(404)
        res.end()
      }
    } catch (error) {
      res.writeHead(500)
      res.end(error.message)
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = 'http://127.0.0.1:' + server.address().port
  const build = spawnSync(
    process.env.MOSS_TEST_NODE || 'node',
    ['scripts/build-catalog.mjs', '--artifacts', releaseDir, '--output', site],
    {
      cwd: apps,
      env: { ...process.env, MOSS_APP_MARKET_BASE_URL: origin },
      encoding: 'utf8',
    },
  )
  assert.equal(build.status, 0, build.stderr)
  process.env.MOSS_APP_MARKET_INDEX_URL = origin + '/v1/index.json'
}
async function until(fn, label, timeout = 60000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await delay(150)
  }
  throw Error('Timed out: ' + label)
}
const js = (win, fn, ...args) =>
  win.webContents.executeJavaScript(`(${fn})(${args.map((v) => JSON.stringify(v)).join(',')})`)
const btn = (win, label) =>
  js(
    win,
    (text) => {
      const match = [...document.querySelectorAll('button')].find(
        (b) => !b.disabled && b.innerText.trim().startsWith(text),
      )
      if (match) {
        match.click()
        return true
      }
    },
    label,
  )
async function confirmReviewedInstall(win) {
  await until(async () => {
    if (approvals.some((prompt) => prompt.buttons?.some((text) => String(text).includes('安装')))) return true
    return js(win, () => {
      const dialog = document.querySelector('dialog.host-confirmation-dialog[open]')
      if (
        dialog?.innerText.includes('语义知识库') &&
        dialog.querySelector('.host-confirmation-accept')?.textContent.includes('安装')
      ) {
        dialog.querySelector('.host-confirmation-accept').click()
        return true
      }
      const pending = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('待确认操作（'))
      if (pending && !dialog) pending.click()
      return false
    })
  }, 'knowledge-rag permission review')
}
async function sha256(file) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}
let exitCode = 1
const watchdog = setTimeout(() => {
  console.error('Desktop test timed out')
  app.exit(1)
}, 750000)
async function prepare() {
  const register = AppProcessSupervisor.prototype.register
  AppProcessSupervisor.prototype.register = function (definition) {
    if (definition.appId === id) supervisor = this
    return register.call(this, definition)
  }
  const runtimes = process.env.MOSS_TEST_INSTALLED_RUNTIMES
  if (runtimes) {
    await fsp.mkdir(process.env.MOSS_RUNTIME_HOME, { recursive: true })
    for (const name of ['python', 'node']) {
      execFileSync('cp', ['-cR', path.join(runtimes, name), process.env.MOSS_RUNTIME_HOME])
    }
  }
  await fsp.mkdir(output, { recursive: true })
  if (mode !== 'offline') await stageCatalog()
  else {
    process.env.MOSS_APP_MARKET_INDEX_URL = 'http://127.0.0.1:9/v1/index.json'
    assert.equal(await sha256(saved), kit.sha256)
    const unpack = spawnSync('unzip', ['-q', saved, '-d', media], { encoding: 'utf8' })
    assert.equal(unpack.status, 0, unpack.stderr)
    assert.equal(await sha256(path.join(media, online.fileName)), online.sha256)
    const start = AppProcessSupervisor.prototype.startNow
    AppProcessSupervisor.prototype.startNow = async function (key, options) {
      if (this.definitions.get(key)?.appId !== id) return start.call(this, key, options)
      sandboxStarts++
      const executable = this.nodeExecutable,
        args = this.nodeArgs
      this.nodeExecutable = '/usr/bin/sandbox-exec'
      this.nodeArgs = [
        '-p',
        '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))',
        executable,
        ...args,
      ]
      try {
        return await start.call(this, key, options)
      } finally {
        this.nodeExecutable = executable
        this.nodeArgs = args
      }
    }
  }
  await import('../src/main.mjs')
}
// Electron emits ready only after its main ES module finishes loading.
const startupError = await prepare().then(
  () => null,
  (error) => error,
)
async function run() {
  try {
    if (startupError) throw startupError
    const win = await until(() => uiWindows[0], 'desktop window')
    win.setSize(1400, 950)
    await until(() => js(win, () => Boolean(window.agentDesktop?.appMarketplace)), 'production preload')
    await until(
      () =>
        js(win, () => {
          const button = document.querySelector('button[title="插件"]')
          if (button) {
            button.click()
            return true
          }
        }),
      'plugins navigation',
    )
    await until(
      () =>
        js(win, () => {
          const tab = [...document.querySelectorAll('[aria-label="资源分类"] [role=tab]')].find(
            (item) => item.textContent === 'Apps',
          )
          if (tab) {
            tab.click()
            return true
          }
        }),
      'Apps tab',
    )
    const activated = () =>
      until(
        () =>
          js(
            win,
            async (appId, version) => {
              const apps = await window.agentDesktop.listApps()
              return apps.some((app) => app.id === appId && app.currentVersion === version && app.enabled)
            },
            id,
            release.version,
          ),
        'signed App installation and activation',
      )
    if (mode !== 'offline') {
      await until(
        () =>
          js(
            win,
            (appId) => {
              const b = document.querySelector('[data-app-market-open="' + appId + '"]')
              if (b) {
                b.click()
                return true
              }
            },
            id,
          ),
        'market details',
      )
      await until(
        () =>
          js(win, () =>
            [...document.querySelectorAll('button')].some(
              (b) => b.textContent.includes('下载离线整包') && !b.disabled,
            ),
          ),
        'download choices',
      )
      if (mode === 'market') {
        // Wait for Chromium to paint the updated details before reading its compositor surface.
        await js(
          win,
          () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))),
        )
        await delay(400)
        await fsp.writeFile(path.join(output, 'market-choices.png'), (await win.webContents.capturePage()).toPNG())
        assert.ok(await btn(win, '下载离线整包'))
        await until(
          () => fs.existsSync(saved) && js(win, () => document.body.innerText.includes('离线整包已校验并保存')),
          'verified save',
          600000,
        )
        assert.equal(await sha256(saved), kit.sha256)
      }
      assert.ok(await btn(win, '在线安装'))
      await confirmReviewedInstall(win)
      await activated()
      if (mode === 'market') {
        assert.deepEqual(requests, [kit.fileName, online.fileName])
        if (process.env.MOSS_TEST_GITHUB_DRAFT_ID)
          checks.push('Core fetched both artifacts directly from the GitHub Release CDN')
        checks.push('Both UI choices', 'Saved and verified full transfer kit')
      } else {
        assert.deepEqual(requests, [online.fileName])
      }
      checks.push(
        'Generated index/detail read by Core',
        'Online ZIP download, trusted installation and activation',
      )
    } else {
      await until(
        () =>
          js(win, () => {
            const button = document.querySelector('button[aria-label="本地安装 ZIP"]')
            if (button && !button.disabled) {
              button.click()
              return true
            }
          }),
        'local ZIP installation',
      )
      await confirmReviewedInstall(win)
      await activated()
      checks.push(
        'Verified inner ZIP matches online artifact',
        'Disconnected local archive installation and permission confirmation',
      )
    }
    if (mode !== 'market') {
      const opened = await js(win, (name) => window.agentDesktop.launchApp({ name }), id)
      assert.equal(opened.ok, true, opened.error)
      const rag = await until(
        () =>
          uiWindows.find((w) => w !== win && !w.isDestroyed() && w.webContents.getURL().startsWith('moss-app:')),
        'installed App window',
      )
      await until(() => js(rag, () => Boolean(window.mossApp?.actions)), 'App preload')
      const initial = await js(rag, () => window.mossApp.actions.invoke('engine.status', {}))
      assert.equal(initial.result?.installed, false, JSON.stringify(initial))
      await until(() => btn(rag, mode === 'offline' ? '选择离线包' : '在线准备'), 'engine setup button')
      await until(
        () =>
          js(rag, async () => {
            const response = await window.mossApp.actions.invoke('engine.status', {})
            if (!response.ok) throw Error(response.error.message)
            if (response.result.state === 'failed') throw Error(response.result.error)
            return response.result.state === 'ready'
          }),
        'engine startup',
        mode === 'offline' ? 210000 : 600000,
      )
      const result = await js(rag, async () => {
        const invoke = async (name, input) => {
          const response = await window.mossApp.actions.invoke(name, input)
          if (!response.ok) throw Error(response.error.message)
          return response.result
        }
        await invoke('documents.create', {
          filepath: 'renewal.md',
          content: 'Customers receive a phone call before their subscription expires to extend the contract.',
        })
        await invoke('documents.create', {
          filepath: 'garden.md',
          content: 'Dig the soil and plant an apple tree, then water its roots.',
        })
        return invoke('documents.search', {
          query: '客户如何续约服务',
          method: 'hybrid',
          hybridAlpha: 1,
          limit: 2,
        })
      })
      if (mode === 'offline') assert.ok(sandboxStarts > 0, 'RAG backend ran under the network sandbox')
      searchHit = result.items[0].filepath
      assert.match(searchHit, /renewal\.md$/)
      checks.push('Cold ' + mode + ' venv and model', 'Cross-language semantic search')
      rag.close()
      await until(() => rag.isDestroyed(), 'close standalone App')
      const reopened = await js(win, name => window.agentDesktop.launchApp({ name }), id)
      assert.equal(reopened.ok, true, reopened.error)
      const reopenedApp = await until(
        () => uiWindows.find(w => w !== win && !w.isDestroyed() && w.webContents.getURL().startsWith('moss-app:')),
        'reopen standalone App',
      )
      await until(() => js(reopenedApp, () => Boolean(window.mossApp?.actions)), 'reopened App preload')
      reopenedApp.destroy()
      await until(() => reopenedApp.isDestroyed(), 'destroy standalone App')
      assert.deepEqual(desktopErrors, [])
      checks.push('Standalone App closes, reopens and is destroyed without a main-process exception')
    }
    checks.push('Installation disclosure accepted')
    await fsp.writeFile(
      path.join(output, mode + '-result.json'),
      JSON.stringify(
        {
          id,
          version: release.version,
          platform,
          mode,
          checks,
          searchHit,
          appSha256: online.sha256,
          kitSha256: kit.sha256,
        },
        null,
        2,
      ),
    )
    console.log(JSON.stringify({ mode, checks }))
    exitCode = 0
  } catch (error) {
    console.error(error.stack)
    for (const w of uiWindows.filter((item) => !item.isDestroyed()))
      console.error((await js(w, () => document.body?.innerText).catch(() => '')).slice(-2400))
  } finally {
    clearTimeout(watchdog)
    server?.close()
    try {
      await supervisor?.shutdown()
      for (const win of uiWindows.toReversed()) if (!win.isDestroyed()) win.destroy()
      // Package directories are immutable. Make only this temporary tree removable.
      execFileSync('find', [root, '-type', 'd', '-exec', 'chmod', 'u+rwx', '{}', '+'])
      await fsp.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
      assert.deepEqual(desktopErrors, [])
    } catch (error) {
      exitCode = 1
      console.error(error.stack)
    }
    app.exit(exitCode)
  }
}
void run()
