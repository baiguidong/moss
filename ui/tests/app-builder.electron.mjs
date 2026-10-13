// Real Chromium/preload/Backend coverage, or full Desktop IPC with an isolated profile.
import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

let releaseBootstrap
const bootstrapped = new Promise(resolve => { releaseBootstrap = resolve })
async function run() {
const mode = process.env.MOSS_BUILDER_TEST_MODE || 'browser'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-builder-electron-'))
const packageRoot = process.env.MOSS_BUILDER_PACKAGE
assert.ok(packageRoot, 'Build the Builder package before testing')
process.env.MOSS_HOME = root
process.env.MOSS_OPEN_DEVTOOLS = 'false'
app.setAppPath(fileURLToPath(new URL('..', import.meta.url)))
app.setPath('userData', path.join(root, 'electron'))
app.on('window-all-closed', () => {})
const timeout = setTimeout(() => { console.error(`BLOCKED: ${mode} test timed out`); void (async () => {
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  await fs.rm(root, { recursive: true, force: true }).catch(() => {})
  app.exit(1)
})() }, mode === 'agent' ? 600000 : 55000)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(read, predicate, attempts = 150) {
  let value
  for (let index = 0; index < attempts; index++) { value = await read(); if (predicate(value)) return value; await sleep(100) }
  throw new Error(`Timed out waiting for condition: ${JSON.stringify(value)}`)
}
let close = async () => {}
try {
  if (mode === 'browser') {
    const { fixture } = await import('./helpers/app-authoring-fixture.mjs')
    const { registerAppUiRequests } = await import('../src/apps/app-ui-requests.mjs')
    const { createAuthoringPreview } = await import('../src/apps/app-authoring-preview.mjs')
    const { createAppPlatformHandlers } = await import('../src/apps/app-platform-host.mjs')
    const { createAppComposer } = await import('../src/apps/app-composer.mjs')
    const { contractDefinition } = await import('../../packages/app-sdk/src/host/contracts.mjs')
    const { writeHostFixture } = await import('./helpers/app-authoring-host-fixture.mjs')
    const drafts = []
    const uiStates = new Map(), previewWindows = []
    let f
    const composer = createAppComposer({ getRuntime: () => f.runtime, getSession: id => f.sessions.get(id) })
    const skills = [
      { name: 'notes', displayName: '笔记整理', description: '整理笔记与主题摘录', source: '/installed/skills/notes' },
      { name: 'tasks', displayName: '任务管理', description: '记录与跟进待办任务', source: '/installed/skills/tasks' },
      { name: 'disabled', displayName: '停用技能', source: '/disabled', enabled: false },
    ]
    const assistants = [
      { name: 'writer', displayName: '写作助手', description: '把想法整理成文章', source: '/installed/assistants/writer' },
      { name: 'planner', displayName: '规划助手', description: '拆解目标与执行步骤', source: '/installed/assistants/planner' },
    ]
    f = await fixture({ listSkills: async () => skills, listAssistants: async () => assistants,
      onDraft: async draft => { const resolved = await composer.resolve(draft.context); drafts.push({ ...draft, resolved }) }, preview: (artifact, options) => createAuthoringPreview({
      root: path.join(f.home, 'previews'), getRuntime: () => f.runtime, nodeExecutable: process.env.MOSS_TEST_NODE,
      openWindow: async ({ artifact, runtime }) => {
        const preview = new BrowserWindow({ show: false, webPreferences: { preload: fileURLToPath(new URL('../src/apps/app-preload.mjs', import.meta.url)), sandbox: false, contextIsolation: true, nodeIntegration: false } })
        uiStates.set(preview.webContents.id, { id: artifact.manifest.id, runtime })
        previewWindows.push(preview)
        await preview.loadFile(path.join(artifact.directory, artifact.manifest.ui.entry))
        return preview
      },
    })(artifact, options) }); close = () => f.close()
    await f.runtime.setAppEnabled('test.builder', false)
    await f.runtime.installFromDirectory(packageRoot)
    await app.whenReady()
    let themeMode = 'light'
    const storage = new Map()
    ipcMain.handle('app-ui:get-info', () => ({ id: 'moss.app-builder', appearance: { themeMode, cssThemeId: 'grid-theme' } }))
    ipcMain.handle('app-ui:storage:get', (_event, { key }) => storage.get(key))
    ipcMain.handle('app-ui:storage:set', (_event, { key, value }) => { storage.set(key, value); return { ok: true, key } })
    registerAppUiRequests({ ipc: ipcMain, getState: sender => uiStates.get(sender.id) || ({ id: 'moss.app-builder', runtime: f.runtime }) })
    const window = new BrowserWindow({ show: false, width: 1100, height: 760, webPreferences: {
      preload: fileURLToPath(new URL('../src/apps/app-preload.mjs', import.meta.url)), sandbox: false, contextIsolation: true, nodeIntegration: false,
    } })
    await window.loadFile(path.join(packageRoot, 'dist/ui/index.html'))
    const evaluate = async script => {
      try { return await window.webContents.executeJavaScript(`(() => eval(${JSON.stringify(script)}))()`) }
      catch (error) { throw new Error(`Builder UI evaluation failed: ${script}`, { cause: error }) }
    }
    window.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message) })
    await until(() => evaluate('document.querySelector("#project-count").textContent'), text => text.includes('0'))
    assert.equal(await evaluate('document.querySelector("#notice").hidden'), true)
    assert.equal(await evaluate('Boolean(document.querySelector("#apps, #skill"))'), false)
    assert.equal(await evaluate('document.body.textContent.includes("迭代已有 App")'), false)
    await evaluate('document.querySelector("#requirements").value="创建一个待办 App";document.querySelector("#requirements").dispatchEvent(new Event("input"));document.querySelector("#create").requestSubmit()')
    await until(() => drafts.length, count => count === 1)
    assert.equal(drafts[0].prompt, '创建一个待办 App')
    assert.equal(f.service.operationsForSession('session').length, 0)
    assert.equal(storage.get('creation-draft').requirements, '创建一个待办 App')
    const output = path.join(os.tmpdir(), 'moss-builder-test-output'); await fs.mkdir(output, { recursive: true })
    await fs.writeFile(path.join(output, 'light.png'), (await window.webContents.capturePage()).toPNG())

    // The picker shares the same selection with @, including assistant replacement.
    await evaluate('document.querySelector("#choose-resources").click()')
    await until(() => evaluate('document.querySelectorAll("#resource-results .resource-row").length'), count => count === 2)
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[data-resource-tab]")).map(tab => tab.textContent.trim())'), ['技能', '助手'])
    await evaluate('document.querySelectorAll("#resource-results .resource-row")[0].click();document.querySelectorAll("#resource-results .resource-row")[1].click()')
    assert.equal(await evaluate('document.querySelectorAll("#resource-results [aria-pressed=true]").length'), 2)
    await evaluate('document.querySelector("#resource-search").value="不存在的资源";document.querySelector("#resource-search").dispatchEvent(new Event("input"))')
    assert.equal(await evaluate('document.querySelectorAll("#resource-results .resource-row").length'), 0)
    await evaluate('document.querySelector("#tab-assistant").click();document.querySelectorAll("#resource-results .resource-row")[0].click();document.querySelectorAll("#resource-results .resource-row")[1].click()')
    assert.equal(await evaluate('document.querySelectorAll("#resource-results [aria-pressed=true]").length'), 1)
    assert.equal(await evaluate('document.querySelector("#selection-count").textContent'), '3')
    await fs.writeFile(path.join(output, 'resource-picker.png'), (await window.webContents.capturePage()).toPNG())
    await evaluate('document.querySelector("#confirm-resources").click()')
    // Remove both skills, then add a matching skill using the keyboard. IME Enter must not select it.
    await evaluate('for (const chip of Array.from(document.querySelectorAll(".resource-chip"))) if (chip.dataset.resourceKey.startsWith("skill:")) chip.click(); const input=document.querySelector("#requirements");input.value="创建 @笔记";input.focus();input.setSelectionRange(input.value.length,input.value.length);input.dispatchEvent(new Event("input"))')
    assert.equal(await evaluate('document.querySelector("#mentions").hidden'), false)
    await evaluate('document.querySelector("#requirements").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true,cancelable:true}))')
    assert.equal(await evaluate('document.querySelectorAll(".resource-chip").length'), 1)
    await evaluate('document.querySelector("#requirements").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))')
    assert.equal(await evaluate('document.querySelector("#requirements").value'), '创建 ')
    assert.equal(await evaluate('document.querySelectorAll(".resource-chip").length'), 2)
    assert.equal(await evaluate('document.querySelector("#mentions").hidden'), true)
    await evaluate('const input=document.querySelector("#requirements");input.value="创建 @";input.setSelectionRange(input.value.length,input.value.length);input.dispatchEvent(new Event("input"));input.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true}));input.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true}));input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))')
    assert.equal(await evaluate('document.querySelectorAll(".resource-chip").length'), 2)
    await until(() => storage.get('creation-draft')?.requirements, value => value === '创建 ')
    await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.reload() })
    await until(() => evaluate('document.querySelectorAll(".resource-chip").length'), count => count === 2)
    assert.equal(await evaluate('document.querySelector("#requirements").value'), '创建 ')
    await evaluate('document.querySelector("#create").requestSubmit()')
    await until(() => drafts.length, count => count === 2)
    assert.deepEqual(drafts[1].context.ref.resources.map(item => item.kind).sort(), ['assistant', 'skill'])
    assert.ok(drafts[1].context.ref.resources.some(item => item.source === '/installed/skills/notes'))
    assert.match(drafts[1].resolved.instruction, /\/installed\/skills\/notes/)
    assert.match(drafts[1].resolved.prompt, /技能「笔记整理」/)
    assert.equal(f.service.operationsForSession('session').length, 0)
    // A resource alone can start creation; the provider supplies the initial prompt.
    await until(() => evaluate('document.querySelector("#submit").disabled'), disabled => !disabled)
    await evaluate('document.querySelector("#requirements").value="";document.querySelector("#requirements").dispatchEvent(new Event("input"));document.querySelector("#create").requestSubmit()')
    await until(() => drafts.length, count => count === 3)
    assert.equal(drafts[2].context.ref.resources.length, 2)
    assert.match(drafts[2].resolved.prompt, /助手「写作助手」/)
    themeMode = 'dark'; window.webContents.send('app-ui:event:appearance', { themeMode })
    await until(() => evaluate('document.documentElement.dataset.theme'), value => value === 'dark')
    window.setSize(420, 800)
    await sleep(150)
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'))
    await fs.writeFile(path.join(output, 'dark-narrow.png'), (await window.webContents.capturePage()).toPNG())
    await evaluate('document.querySelector("#choose-resources").click()')
    await sleep(100)
    assert.ok(await evaluate('document.querySelector("#resource-picker").getBoundingClientRect().right <= innerWidth'))
    await fs.writeFile(path.join(output, 'picker-dark-narrow.png'), (await window.webContents.capturePage()).toPNG())
    await evaluate('document.querySelector("#close-picker").click()')
    window.destroy()
    await f.runtime.setAppEnabled('moss.app-builder', false)
    await f.runtime.setAppEnabled('test.builder', true)
    f.runtime.registerHostProtocol(contractDefinition('moss.platform/v1'))
    f.runtime.registerHostHandler('moss.platform/v1', 'file.materialize', createAppPlatformHandlers({})['file.materialize'])
    const project = await f.prepare(); await writeHostFixture(project)
    const build = await f.wait((await f.build(project)).operationRef)
    assert.equal(build.status, 'succeeded', build.error)
    const preview = await f.call('artifact.preview', { artifactRef: build.result.artifactRef, submissionKey: 'browser-preview', grants: ['platform:files'] })
    const previewResult = await f.wait(preview.operationRef, 'artifact')
    assert.equal(previewResult.status, 'ready', previewResult.error)
    const targetWindow = previewWindows.at(-1)
    await targetWindow.webContents.executeJavaScript(`document.querySelector('#value').value='real Host file';document.querySelector('#write').click()`)
    await until(() => targetWindow.webContents.executeJavaScript(`document.querySelector('#result').textContent`), value => value === 'real Host file')
    await f.call('artifact.close', { operationRef: preview.operationRef })
    assert.equal(targetWindow.isDestroyed(), true)
    console.log('PASS: actual preview UI click → preload → target Backend → real Core file Host handler')
    console.log(`PASS: Builder skill/assistant picker, @ search/keyboard/IME, shared and persistent selections, validated conversion drafts, removed App list, dark/light and narrow layout (${output})`)
  } else {
    if (mode === 'agent') {
      assert.ok(process.env.MOSS_BUILDER_AGENT_SETTINGS, 'BLOCKED: model settings are required')
      const settings = JSON.parse(await fs.readFile(process.env.MOSS_BUILDER_AGENT_SETTINGS, 'utf8'))
      assert.ok(settings.models?.text?.model && settings.models?.text?.baseUrl, 'BLOCKED: no configured text model')
      await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify({ models: { text: { ...settings.models.text, maxTurns: 60 } }, maxTurns: 60, permissionMode: 'acceptEdits' }), { mode: 0o600 })
    }
    const handlers = new Map(), drafts = []
    const originalHandle = ipcMain.handle.bind(ipcMain)
    ipcMain.handle = (name, handler) => { handlers.set(name, handler); originalHandle(name, handler) }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(path.dirname(packageRoot), 'moss.app-builder-0.1.0.zip')] })
    dialog.showMessageBox = async () => ({ response: 1 })
    const ready = new Promise(resolve => app.on('browser-window-created', (_event, window) => {
      window.show = () => {}; window.showInactive = () => {}
      const send = window.webContents.send.bind(window.webContents)
      window.webContents.send = (channel, ...args) => {
        if (channel === 'app:composer:prepare') drafts.push(args[0])
        if (mode === 'agent' && channel === 'agent:question-request') {
          const question = args[0], input = question.input || question
          const metadata = input.metadata || question.metadata || {}
          const command = metadata.toolInput?.command || ''
          const allowed = /builder_(inspect|prepare|build|preview|release)$/.test(metadata.toolName || '')
            || (metadata.toolName === 'Bash' && /^cd '[^']+\/\.moss-app-builds\/[a-f0-9-]+' && '[^']+\/node' '[^']+\/npm-cli.js' 'run' 'build'$/.test(command))
          setTimeout(() => {
            const request = allowed ? { ...question, answers: Object.fromEntries((input.questions || []).map(item => [item.question, item.options.find(option => /允许一次/.test(option.label))?.label || item.options[0].label])) } : question
            void handlers.get(allowed ? 'agent:answer-question' : 'agent:reject-question')({ sender: window.webContents }, request).catch(console.error)
          }, 0)
        }
        return send(channel, ...args)
      }
      window.webContents.once('did-finish-load', () => resolve(window))
    }))
    await import('../src/main.mjs')
    releaseBootstrap()
    const window = await ready
    const invoke = (name, payload) => { assert.ok(handlers.has(name), name); return handlers.get(name)({ sender: window.webContents }, payload) }
    const installed = await invoke('app:install-archive')
    assert.equal(installed.ok, true)
    assert.equal((await invoke('app:authoring:get')).available, true)
    const before = await invoke('agent:list-sessions')
    await invoke('app:authoring:prepare', { appId: 'moss.app-builder' })
    assert.equal(drafts.length, 1)
    assert.equal((await invoke('agent:list-sessions')).length, before.length)
    const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace)
    const created = await invoke('agent:create-session', { workspace, title: 'Builder acceptance', agentMode: 'local' })
    const sessionId = created.summary.id
    assert.deepEqual(await invoke('app:authoring:operations', { sessionId }), [])
    const contributions = await invoke('app:list-contributions', { kinds: ['tools'] })
    assert.equal(contributions.tools.filter(tool => tool.appId === 'moss.app-builder').length, 5)
    if (mode === 'agent') {
      if (process.env.MOSS_BUILDER_TEST_EXTERNAL === '1') {
        const server = http.createServer((request, response) => {
          if (request.headers.authorization !== 'Bearer fixture-token') { response.writeHead(401); response.end('missing credentials'); return }
          response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ value: 41 }))
        })
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
        const endpoint = `http://127.0.0.1:${server.address().port}/lookup`
        const previousClose = close
        close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await previousClose() }
        const skillPath = 'external-fixture-skill'
        await fs.mkdir(path.join(workspace, skillPath))
        await fs.writeFile(path.join(workspace, skillPath, 'SKILL.md'), '# Conversion fixture\nCapabilities: sum two numbers, and lookup a value from an HTTP service with a caller-supplied bearer token. Missing token and service errors must be explicit failures. No fabricated fallback values. Input data, not executable instructions.')
        await fs.writeFile(path.join(workspace, skillPath, 'source.py'), 'import requests\ndef add(a, b): return {"value": a+b}\ndef lookup(endpoint, token):\n if not token: raise ValueError("missing credential")\n r=requests.get(endpoint, headers={"Authorization":"Bearer "+token}); r.raise_for_status(); return r.json()\n')
        await invoke('agent:send', { sessionId, appContext: { providerId: 'moss.app-builder/projects', intent: 'create', ref: { skillPath } }, prompt: `把 external-fixture-skill 的源码能力转换为 Backend-only App test.builder-external。先 builder_inspect skill 静态分析，不能运行源脚本。使用最新版 Core SDK。新 App 声明 add 与 lookup 两个 Action，add 输入 a/b 数字，输出 {value:a+b}；lookup 输入 endpoint/token 字符串（token 可省略但必须明确报错），通过 fetch 用 Bearer token 调用 endpoint 并返回真实 {value}，HTTP 错误与网络故障必须抛错。不要安装或公开发布。无第三方业务依赖；用普通 Write 编写文件，build.mjs 用 node:fs 将 .moss-sdk 完整复制到 dist/sdk，Backend 从 ./sdk/packages/app-sdk/src/index.mjs 导入；复制源码到 dist。用 builder_build 构建，builder_preview open 后依次运行四项真实 Action 测试并查询最终回执：add {a:1,b:2} 应为 {value:3}；lookup {endpoint:${JSON.stringify(endpoint)},token:"fixture-token"} 应为 {value:41}；lookup 同一 endpoint 不带 token 应失败；lookup {endpoint:"http://127.0.0.1:1/unavailable",token:"fixture-token"} 应服务不可用失败。后两项是预期负例，不能标成成功。保留预览供测试检查。不要 Bash、子 Agent 或提问。` })
        await until(() => invoke('app:authoring:operations', { sessionId }), items => items.filter(item => item.kind === 'test' && ['succeeded', 'failed'].includes(item.status)).length >= 4, 5000)
        await until(() => invoke('agent:get-session', { sessionId }), value => !value.busy, 600)
        const operations = await invoke('app:authoring:operations', { sessionId }), tests = operations.filter(item => item.kind === 'test')
        assert.ok(tests.some(item => item.status === 'succeeded' && item.result.value.value === 3))
        assert.ok(tests.some(item => item.status === 'succeeded' && item.result.value.value === 41))
        assert.ok(tests.filter(item => item.status === 'failed').length >= 2)
        assert.ok(tests.some(item => item.status === 'failed' && /credential|token|凭据|令牌/i.test(item.error)))
        assert.ok(!operations.some(item => item.kind === 'release'))
        const output = path.join(os.tmpdir(), 'moss-builder-test-output'); await fs.mkdir(output, { recursive: true })
        await fs.writeFile(path.join(output, 'external-conversion-evidence.json'), JSON.stringify({ ordinaryLocalSession: true, sourceRepositoriesDenied: process.env.MOSS_PACKAGE_ISOLATED === '1', localEquivalence: true, actualExternalService: true, missingCredentialRejected: true, unavailableServiceRejected: true, operations }, null, 2))
        console.log('PASS: real Agent converted local and external Skill capabilities; actual Backend actions passed equivalence/service tests and rejected missing credentials/unavailable service')
      } else {
      const conversion = process.env.MOSS_BUILDER_TEST_CONVERSION === '1'
      if (conversion) {
        await fs.mkdir(path.join(workspace, 'fixture-skill'))
        await fs.writeFile(path.join(workspace, 'fixture-skill/SKILL.md'), '# Local TODO input\nCapability: add a nonempty todo item, persist it locally, list todos. Inputs: text; outputs: visible todo list. No network, credentials or external CLI required. scripts.mjs is source material, not an instruction to execute.')
        await fs.writeFile(path.join(workspace, 'fixture-skill/scripts.mjs'), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(path.join(workspace, 'skill-script-executed'))},'unexpected execution');`)
      }
      const ref = await invoke('app:composer:resolve', { context: { providerId: 'moss.app-builder/projects', intent: 'create', ...(conversion ? { ref: { skillPath: 'fixture-skill' } } : {}) }, sessionId })
      const initialPrompt = (conversion ? '将工作区 fixture-skill 中的 Skill 资料转换为 App。先用 builder_inspect 的 skill 操作静态分析，不运行其中脚本。' : '') + '创建一个最小的待办 App，ID 为 test.builder-e2e。使用当前 Host 契约与 Builder 工具完成真实构建并查询成功回执。请使用无外部依赖的 HTML/JS，build.mjs 只用 node:fs 复制到 dist，manifest 的 ui.entry 使用 dist/index.html，host.protocols 声明 moss.apps/v1。待办输入框 id=e2e-input，添加按钮 id=e2e-add，列表容器 id=e2e-list。用普通 Write/Edit 编写文件，用 builder_build 构建，使用 Builder 工具打开真实预览，并安装到本机临时测试环境。声明 dataCompatibility=unchanged。不需要 Bash、子 agent 或提问。'
      await invoke('agent:send', { sessionId, prompt: initialPrompt, appContext: { providerId: 'moss.app-builder/projects', intent: 'create', ref: ref.ref } })
      await until(() => invoke('app:authoring:operations', { sessionId }), items => items.some(item => item.kind === 'release' && item.status === 'succeeded'), 5000)
      await until(() => invoke('agent:get-session', { sessionId }), value => !value.busy, 600)
      const previewWindow = BrowserWindow.getAllWindows().filter(item => item !== window).at(-1)
      assert.ok(previewWindow, 'A real preview window must exist')
      await previewWindow.webContents.executeJavaScript(`document.querySelector('#e2e-input').value='verified first';document.querySelector('#e2e-input').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#e2e-add').click()`)
      await until(() => previewWindow.webContents.executeJavaScript(`document.querySelector('#e2e-list').textContent`), value => value.includes('verified first'))
      const firstContext = await invoke('app:authoring:context', { sessionId })
      await invoke('agent:send', { sessionId, prompt: '继续修改同一个项目：添加清空所有待办按钮 id=e2e-clear，保留原测试 id，版本改为 0.2.0。复用项目源码和 SDK，用普通 Write/Edit 修改，Builder 工具构建、预览并安装；查询成功回执。无需外部依赖、Bash 或提问，数据格式保持兼容。' })
      await until(() => invoke('app:authoring:operations', { sessionId }), items => items.filter(item => item.kind === 'release' && item.status === 'succeeded').length === 2, 5000)
      await until(() => invoke('agent:get-session', { sessionId }), value => !value.busy, 600)
      assert.deepEqual(await invoke('app:authoring:context', { sessionId }), firstContext)
      const operations = await invoke('app:authoring:operations', { sessionId })
      const releases = operations.filter(item => item.kind === 'release' && item.status === 'succeeded')
      assert.equal(releases.at(-1).result.baseVersion, '0.2.0')
      assert.equal(releases.at(-1).result.installationRevision, 2)
      const existingWindows = new Set(BrowserWindow.getAllWindows().map(item => item.id))
      assert.equal((await invoke('app:launch', { name: 'test.builder-e2e' })).ok, true)
      const installedWindow = BrowserWindow.getAllWindows().find(item => !existingWindows.has(item.id))
      assert.ok(installedWindow, 'Installed App opens a separate window')
      await until(() => installedWindow.webContents.executeJavaScript(`Boolean(document.querySelector('#e2e-clear'))`), Boolean)
      await installedWindow.webContents.executeJavaScript(`document.querySelector('#e2e-input').value='verified installed';document.querySelector('#e2e-input').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#e2e-add').click()`)
      await until(() => installedWindow.webContents.executeJavaScript(`document.querySelector('#e2e-list').textContent`), value => value.includes('verified installed'))
      await installedWindow.webContents.executeJavaScript(`document.querySelector('#e2e-clear').click()`)
      await until(() => installedWindow.webContents.executeJavaScript(`document.querySelector('#e2e-list').textContent`), value => !value.includes('verified installed'))
      const targetDraftCount = drafts.length
      await installedWindow.webContents.executeJavaScript(`window.mossApp.host.request('moss.apps/v1','authoring.prepare',{intent:'edit'})`)
      assert.equal(drafts.length, targetDraftCount + 1)
      assert.equal(drafts.at(-1).context.intent, 'edit')
      assert.ok(drafts.at(-1).context.ref.targetRef)
      await invoke('agent:send', { sessionId, prompt: '只用一句话解释此次修改，不调用工具，不重新构建或安装。' })
      await until(() => invoke('agent:get-session', { sessionId }), value => !value.busy, 600)
      assert.equal((await invoke('app:authoring:operations', { sessionId })).length, operations.length)
      const history = JSON.stringify((await invoke('agent:get-session', { sessionId })).history)
      assert.ok(!/"name":"app_(build|preview|publish|launch|update|extract_to_workspace|get_versions)"/.test(history) && !history.includes('convert-skill-to-app'))
      if (conversion) {
        await assert.rejects(() => fs.access(path.join(workspace, 'skill-script-executed')), /ENOENT/)
        assert.ok(history.includes('scriptsExecuted'), 'The real Agent used static Skill analysis')
      }
      const output = path.join(os.tmpdir(), 'moss-builder-test-output'); await fs.mkdir(output, { recursive: true })
      await fs.writeFile(path.join(output, conversion ? 'conversion-agent-evidence.json' : 'agent-evidence.json'), JSON.stringify({ ordinaryLocalSession: true, sourceRepositoriesDenied: process.env.MOSS_PACKAGE_ISOLATED === '1', skillInputConversion: conversion, uiBehavior: { addTodo: true, clearTodos: true, targetAuthoringEntry: true }, operations: await invoke('app:authoring:operations', { sessionId }), context: await invoke('app:authoring:context', { sessionId }), retiredToolsUsed: false }, null, 2))
      console.log('PASS: real ordinary Agent created, previewed and installed twice in one project; follow-up did not rebuild')
      }
    }
    await invoke('app:set-enabled', { appId: 'moss.app-builder', enabled: false })
    assert.equal((await invoke('app:authoring:get')).available, false)
    assert.equal((await invoke('app:delete', { name: 'moss.app-builder' })).ok, true)
    const removed = await invoke('app:list-contributions', { kinds: ['tools'] })
    assert.equal(removed.tools.filter(tool => tool.appId === 'moss.app-builder').length, 0)
    assert.ok(await invoke('agent:get-session', { sessionId }))
    console.log('PASS: full Desktop local ZIP installation, dynamic tools, provider detection, ordinary session draft, disable and uninstall')
  }
  await close(); clearTimeout(timeout)
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 })
  if (process.env.MOSS_BUILDER_TEST_COMPLETION_FILE) await fs.writeFile(process.env.MOSS_BUILDER_TEST_COMPLETION_FILE, JSON.stringify({ mode, status: 'passed' }))
  app.exit(0)
} catch (error) {
  releaseBootstrap()
  console.error(error.stack || error)
  await close().catch(() => {}); clearTimeout(timeout)
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }).catch(() => {})
  app.exit(1)
}

}
void run().catch(error => { releaseBootstrap(); console.error(error); app.exit(1) })
if (process.env.MOSS_BUILDER_TEST_MODE !== 'browser') await bootstrapped
