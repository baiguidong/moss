// Real isolated Electron + CDP coverage for the natural-language project flow.
// The model endpoint is local and deterministic; no user credentials or paid API are used.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launchTestInstance } from '../src/app-testing/instance.mjs'

const ui = fileURLToPath(new URL('..', import.meta.url))
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-project-creation-cdp-')))
const home = path.join(root, 'profile')
const workspace = path.join(root, '幼儿园游戏案例项目', 'workspace')
const output = path.join(ui, 'output/project-creation-cdp')
const runId = randomUUID()
const checks = []
const exceptions = []
const mark = label => { checks.push(label); console.log('PASS', label) }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, label, timeout = 120000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await delay(100)
  }
  throw new Error('Timed out: ' + label)
}

const instructionProbe = '核对本轮项目指令'
const projectSessionDefaults = (await fs.readFile(new URL('../src/project-session-defaults.md', import.meta.url), 'utf8')).trim()
const serializedProjectSessionDefaults = JSON.stringify(projectSessionDefaults).slice(1, -1)
const probeRequests = []
const workspaceCheckId = randomUUID()
const previewId = randomUUID()
const server = createServer(async (request, response) => {
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
    if (!body.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ id: randomUUID(), type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'fixture' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }))
      return
    }
    const tool = body.tools?.find(entry => entry.name === 'ProjectPlan')
    const probing = JSON.stringify(body.messages).includes(instructionProbe)
    if (probing) {
      probeRequests.push(body)
    } else {
      assert.ok(tool, 'ProjectPlan was not included in the model request')
      assert.equal(tool.input_schema.properties?.firstTask, undefined)
      assert.match(tool.input_schema.properties?.instructions?.description || '', /真实换行/)
      assert.ok(!JSON.stringify(body.system).includes(serializedProjectSessionDefaults), 'project creation does not receive project session instructions')
    }
    const toolResults = body.messages?.flatMap(message => Array.isArray(message.content) ? message.content : []) || []
    const workspaceCheck = toolResults.find(block => block.type === 'tool_result' && block.tool_use_id === workspaceCheckId)
    const result = toolResults.find(block => block.type === 'tool_result' && block.tool_use_id === previewId)
    const input = !workspaceCheck ? { action: 'checkWorkspace', workspace } : {
      action: 'preview',
      name: '幼儿园游戏案例整理',
      icon: { kind: 'generated', color: 'green', paths: ['M4 5h16v14H4z', 'M8 9h8M8 13h5'] },
      instructions: '# AGENTS.md\n\n本文件为 Moss 和其他兼容代理提供项目协作指引。\n\n## 项目范围\n\n- 服务于幼儿园教育活动资料的整理、分析和表达。\n\n## 协作规则\n\n- 先阅读项目资料，再区分事实、观察与建议。\n- 使用清晰、适合教师使用的中文。\n- 保留原始资料和来源，不臆造内容。\n- 生成文件前确认结构、受众和输出格式。',
      workspace,
      mode: 'chat',
      permissionMode: 'bypassPermissions',
      agentTeamsEnabled: true,
      skillIds: [],
      expertIds: [],
      appIds: [],
      appServiceIds: [],
    }
    if (workspaceCheck && !probing) assert.deepEqual(JSON.parse(workspaceCheck.content), { usesExistingAgents: false })
    const call = result || probing ? null : { type: 'tool_use', id: workspaceCheck ? previewId : workspaceCheckId, name: 'ProjectPlan' }
    const text = probing ? '已收到。' : result ? '项目配置方案已生成，请在确认卡中检查并创建项目。' : ''
    const events = [
      { type: 'message_start', message: { id: randomUUID(), type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: call || { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(input) } : { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ]
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
  } catch (error) {
    exceptions.push(String(error))
    response.statusCode = 500
    response.end(String(error))
  }
})

let target, browser, page
try {
  await fs.mkdir(output, { recursive: true })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const modules = path.resolve(ui, '../../moss-apps/node_modules/.bun')
  const playwright = (await fs.readdir(modules)).filter(name => name.startsWith('playwright@')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
  const { chromium } = await import(pathToFileURL(path.join(modules, playwright, 'node_modules/playwright/index.mjs')))
  target = await launchTestInstance({
    run: { id: runId, directory: root, home },
    executable: path.join(ui, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    args: [ui], cwd: ui,
    settings: { language: 'chinese', agentMode: 'local', model: 'project-creation-fixture', url: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture-key', permissionMode: 'bypassPermissions', appearance: { themeMode: 'light' }, autoMemory: { enabled: false, extractionEnabled: false } },
    prepareEnvironment: false, runtimeHome: path.join(root, 'runtime-cache'), signal: new AbortController().signal, timeoutMs: 120000,
  })
  browser = await chromium.connectOverCDP(target.endpoint)
  page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes(runId))
  assert.ok(page)
  page.setDefaultTimeout(45000)
  await page.waitForSelector('button')

  const session = (await page.evaluate(() => window.agentDesktop.createSession({ title: '整理幼儿园文档', projectCreationMode: true, mode: 'chat', permissionMode: 'bypassPermissions' }))).summary
  await page.reload()
  await page.getByText('整理幼儿园文档', { exact: true }).first().click()
  await page.evaluate(({ sessionId }) => window.agentDesktop.send({ sessionId, prompt: '整理幼儿园文档' }), { sessionId: session.id })
  await until(async () => (await page.evaluate(sessionId => window.agentDesktop.projectCreation.getDraft({ sessionId }), session.id))?.status === 'awaiting_confirmation', 'project preview card')
  assert.ok(await page.getByRole('region', { name: '项目创建方案' }).count())
  assert.ok((await page.getByText('幼儿园游戏案例整理', { exact: true }).count()) > 0)
  mark('CDP creates a dedicated project-creation session and renders the editable plan')

  const draft = await page.evaluate(sessionId => window.agentDesktop.projectCreation.getDraft({ sessionId }), session.id)
  assert.equal(draft.project.permissionMode, 'bypassPermissions')
  assert.match(draft.project.instructions, /\n/)
  assert.doesNotMatch(draft.project.instructions, /\\n/)
  assert.doesNotMatch(draft.project.instructions, /整理幼儿园文档|游戏案例.*Word|生成.*文档/)
  assert.equal(draft.project.workspace, workspace)
  assert.equal(draft.firstTask, undefined)
  mark('Plan keeps durable Chinese Markdown rules, full-access default and requested workspace without one-off task details')

  const sharedRule = '原始观察记录按活动日期归档。'
  const originalAgents = '# AGENTS.md\n\n' + sharedRule + '\n'
  await fs.mkdir(workspace, { recursive: true })
  const agentsPath = path.join(workspace, 'AGENTS.md')
  await fs.writeFile(agentsPath, originalAgents)
  await fs.utimes(agentsPath, 1000, 1000)
  const modified = (await fs.stat(agentsPath)).mtimeMs
  const revised = await page.evaluate(({ id, version, project }) => window.agentDesktop.projectCreation.updateDraft({ draftId: id, version, patch: { instructions: project.instructions } }), draft)
  assert.equal(revised.usesExistingAgents, true)
  assert.equal(revised.project.instructions, '')
  assert.equal(revised.existingAgentsContent, originalAgents)
  const restored = await page.evaluate(draftId => window.agentDesktop.projectCreation.getDraft({ draftId }), draft.id)
  assert.equal(restored.existingAgentsContent, originalAgents)
  const storedDraft = JSON.parse(await fs.readFile(path.join(home, 'project-drafts', `${draft.id}.json`), 'utf8'))
  assert.equal(Object.hasOwn(storedDraft, 'existingAgentsContent'), false)
  await page.getByText('沿用默认工作目录已有的 AGENTS.md', { exact: true }).waitFor()
  const originalPreview = page.locator('[data-project-instructions-preview] pre')
  assert.equal(await originalPreview.textContent(), originalAgents)
  await page.getByRole('button', { name: '修改方案', exact: true }).click()
  assert.equal(await originalPreview.textContent(), originalAgents)
  assert.equal(await page.getByRole('textbox', { name: '项目指令' }).count(), 0)
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await page.getByRole('button', { name: '确认并创建', exact: true }).click()
  await until(async () => (await page.evaluate(() => window.agentDesktop.listProjects({}))).some(project => project.name === '幼儿园游戏案例整理'), 'project creation')
  await until(() => page.getByText('幼儿园游戏案例整理', { exact: true }).count(), 'project home')
  const projects = await page.evaluate(() => window.agentDesktop.listProjects({}))
  const project = projects.find(entry => entry.name === '幼儿园游戏案例整理')
  assert.ok(project)
  assert.equal(project.permissionMode, 'bypassPermissions')
  assert.equal(await fs.stat(workspace).then(stat => stat.isDirectory()), true)
  const agents = await fs.readFile(agentsPath, 'utf8')
  assert.equal(agents, project.instructions)
  assert.equal(agents, originalAgents)
  assert.equal((await fs.stat(agentsPath)).mtimeMs, modified)
  const sessions = await page.evaluate(() => window.agentDesktop.listSessions())
  assert.equal(sessions.filter(entry => entry.projectId === project.id).length, 0)
  assert.equal(sessions.find(entry => entry.id === session.id)?.projectCreationMode, true)
  mark('Confirmation creates the project with its existing AGENTS.md intact and starts no project session')

  async function checkInstructions(sessionId, expectedDocument, absentRule, projectSession = false) {
    const before = probeRequests.length
    await page.evaluate(({ sessionId, prompt }) => window.agentDesktop.send({ sessionId, prompt }), { sessionId, prompt: instructionProbe })
    assert.ok(probeRequests.length > before, 'No model request for the instruction probe')
    for (const body of probeRequests.slice(before)) {
      const request = JSON.stringify(body)
      const text = JSON.stringify(expectedDocument.trim()).slice(1, -1)
      const system = JSON.stringify(body.system)
      assert.equal(JSON.stringify(body.messages).split(text).length - 1, 1, 'expected the entire workspace document once')
      assert.equal(request.split(expectedDocument.includes(sharedRule) ? sharedRule : expectedDocument.trim().split('\n').at(-1)).length - 1, 1)
      assert.equal(system.split(serializedProjectSessionDefaults).length - 1, projectSession ? 1 : 0, 'expected the fixed prompt only for project sessions')
      assert.ok(!system.includes('[Project context]'))
      assert.ok(!system.includes('[Project memory:'))
      if (absentRule) assert.ok(!request.includes(absentRule), 'unexpected instructions from another workspace or revision')
      if (projectSession) {
        assert.ok(body.tools?.some(tool => tool.name === 'ProjectMemory'), 'project memory tool is available')
        assert.ok(body.tools?.some(tool => tool.name === 'ProjectResult'), 'project result tool is available')
      }
    }
  }
  const regular = await page.evaluate(workspace => window.agentDesktop.createSession({ workspace, mode: 'chat' }), workspace)
  const chat = await page.evaluate(({ projectId, workspace }) => window.agentDesktop.createSession({ projectId, workspace, mode: 'chat' }), { projectId: project.id, workspace })
  await checkInstructions(regular.summary.id, agents)
  await checkInstructions(chat.summary.id, agents, undefined, true)
  await checkInstructions(chat.summary.id, agents, undefined, true)
  const edited = agents.replace(sharedRule, '按年龄段记录观察资料。')
  await fs.writeFile(agentsPath, edited)
  await checkInstructions(regular.summary.id, edited, sharedRule)
  await checkInstructions(chat.summary.id, edited, sharedRule, true)
  const second = path.join(root, '另一个工作目录')
  const otherDoc = '# AGENTS.md\n\n本目录用案例编号归档。\n'
  await fs.mkdir(second)
  await fs.writeFile(path.join(second, 'AGENTS.md'), otherDoc)
  await page.evaluate(({ projectId, workspaces }) => window.agentDesktop.updateProject({ projectId, updates: { workspaces } }), { projectId: project.id, workspaces: [workspace, second] })
  const otherSession = await page.evaluate(({ projectId, workspace }) => window.agentDesktop.createSession({ projectId, workspace, mode: 'chat' }), { projectId: project.id, workspace: second })
  await checkInstructions(otherSession.summary.id, otherDoc, sharedRule, true)
  mark('Ordinary and project chats receive the same complete directory instructions once, follow edits, and isolate other workspaces')
  const source = path.join(root, 'external attachment.txt')
  await fs.writeFile(source, 'attachment fixture')
  const before = probeRequests.length
  await page.evaluate(({ sessionId, files, prompt }) => window.agentDesktop.send({ sessionId, files, prompt }),
    { sessionId: chat.summary.id, files: [source], prompt: instructionProbe })
  assert.ok(probeRequests.length > before)
  assert.ok(JSON.stringify(probeRequests.at(-1).messages).includes(source))
  const entries = await fs.readdir(workspace)
  for (const name of ['inputs', 'working', 'outputs', path.basename(source)]) assert.ok(!entries.includes(name), name)
  mark('Local project messages reference external attachments without copying them or creating workspace directories')
  await fs.writeFile(path.join(output, 'AGENTS.md'), agents)

  await fs.writeFile(path.join(output, 'validation.json'), JSON.stringify({ ok: true, checks, exceptions, project: { id: project.id, name: project.name, workspace, instructions: project.instructions } }, null, 2))
  console.log('Verified:', output)
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, exceptions }, null, 2))
  throw error
} finally {
  await target?.close(); await browser?.close()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}
