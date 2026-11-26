// Real Electron sessions and ProjectMemory calls, served by a deterministic local model.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launchTestInstance } from '../src/app-testing/instance.mjs'

const ui = fileURLToPath(new URL('..', import.meta.url))
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-agreements-cdp-')))
const runId = randomUUID()
const header = '[Active project agreements]\n'
const included = '给甲方的报价统一含税。'
const excluded = '给甲方的报价统一不含税。'
const fact = '上次给甲方报了12万元。'
let activeTurn
const checks = []
const pass = description => { checks.push(description); console.log('PASS', description) }

async function until(read, label) {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for ' + label)
}

const server = createServer(async (req, res) => {
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    if (!chunks.length) { res.writeHead(204); res.end(); return }
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const message = { id: randomUUID(), role: 'assistant', type: 'message', model: body.model,
      content: [], usage: { input_tokens: 1, output_tokens: 1 } }
    if (!body.stream || !activeTurn) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ...message, content: [{ type: 'text', text: 'fixture' }], stop_reason: 'end_turn' }))
      return
    }
    const turn = activeTurn
    if (turn.fail) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'fixture turn failed' } }))
      return
    }
    const blocks = body.messages.flatMap(entry => typeof entry.content === 'string'
      ? [{ type: 'text', text: entry.content }] : entry.content)
    const snapshots = blocks.filter(block => block.type === 'text' && block.text.includes(header)).map(block =>
      JSON.parse(block.text.slice(block.text.indexOf(header)).split('\n')[2]))
    turn.requests.push({ snapshots, body })
    const result = blocks.find(block => block.type === 'tool_result' && block.tool_use_id === turn.toolId)
    const childRequest = turn.childMarker && blocks.some(block => block.text?.includes(turn.childMarker))
    if (childRequest) turn.workerRequests.push(body)
    const call = turn.input && !result && !childRequest
    if (result) {
      assert.ok(!result.is_error, JSON.stringify(result.content))
      const raw = Array.isArray(result.content) ? result.content.map(item => item.text).join('') : result.content
      turn.result = turn.toolName ? raw : JSON.parse(raw.split('\n<system-reminder>')[0].trim())
    }
    const text = snapshots.at(-1)?.agreements.map(item => item.text).join('；') || '无项目约定'
    const events = [
      { type: 'message_start', message: { ...message, stop_reason: null } },
      { type: 'content_block_start', index: 0, content_block: call ? { type: 'tool_use', id: turn.toolId, name: turn.toolName || 'ProjectMemory' } : { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(turn.input) } : { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ]
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(events.map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n').join(''))
  } catch (error) {
    if (activeTurn) activeTurn.error = error
    res.writeHead(400); res.end(String(error))
  }
})

let target, browser
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const modules = path.resolve(ui, '../../moss-apps/node_modules/.bun')
  const playwright = (await fs.readdir(modules)).find(name => name.startsWith('playwright@'))
  const { chromium } = await import(pathToFileURL(path.join(modules, playwright, 'node_modules/playwright/index.mjs')))
  let page
  const launch = async () => {
    target = await launchTestInstance({
      run: { id: runId, directory: root, home: path.join(root, 'profile') },
      executable: path.join(ui, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [ui], cwd: ui,
      settings: { agentMode: 'local', model: 'agreements-fixture', url: 'http://127.0.0.1:' + server.address().port + '/v1',
        apiKey: 'fixture', permissionMode: 'bypassPermissions', autoMemory: { enabled: false, extractionEnabled: false } },
      prepareEnvironment: false, runtimeHome: path.join(root, 'runtime'), signal: new AbortController().signal, timeoutMs: 120000,
    })
    browser = await chromium.connectOverCDP(target.endpoint)
    page = browser.contexts().flatMap(ctx => ctx.pages()).find(p => p.url().includes(runId))
    await page.waitForSelector('button')
  }
  await launch()
  const workspace = path.join(root, 'repository')
  const project = name => page.evaluate(({ workspace, name }) => window.agentDesktop.createProject({ name, workspaces: [workspace], mode: 'chat' }), { workspace, name })
  const session = async projectId => (await page.evaluate(({ workspace, projectId }) => window.agentDesktop.createSession({ workspace, projectId, mode: 'chat' }), { workspace, projectId })).summary.id
  const p = await project('报价项目')
  const other = await project('同目录独立项目')
  const a = await session(p.id), b = await session(p.id)
  const agentsFile = path.join(workspace, 'AGENTS.md')
  const original = await fs.readFile(agentsFile, 'utf8')
  async function send(sessionId, prompt, input) {
    const turn = { input, toolId: 'tool-' + randomUUID(), requests: [] }
    activeTurn = turn
    try {
      await page.evaluate(({ sessionId, prompt }) => window.agentDesktop.send({ sessionId, prompt }), { sessionId, prompt })
      if (turn.error) throw turn.error
      assert.ok(turn.requests.length, 'No model request for ' + prompt)
      if (input) assert.ok(turn.result, 'No tool result for ' + prompt)
      return turn
    } finally { activeTurn = null }
  }
  async function quote(id, versions, rules) {
    const { requests } = await send(id, '给甲方出个报价')
    const { snapshots, body } = requests[0]
    assert.deepEqual(snapshots.map(item => item.version), versions)
    assert.deepEqual(snapshots.at(-1)?.agreements.map(item => item.text) || [], rules)
    assert.ok(!JSON.stringify(body).includes(fact))
  }
  await quote(b, [], [])
  pass('B opens before A and starts without agreement context')
  await send(a, '记住上次给甲方报了12万', { action: 'note', kind: 'fact', text: fact })
  await quote(b, [], [])
  assert.ok(JSON.stringify((await send(a, '查一下历史报价', { action: 'read' })).result).includes(fact))
  pass('A can retrieve the historical fact and B does not receive it automatically')
  const added = await send(a, '以后给甲方的报价统一含税', { action: 'note', kind: 'agreement', text: included })
  const agreementId = added.result.agreement.id
  await quote(b, [1], [included])
  await quote(b, [1], [included])
  pass('Already-open B receives the scoped rule once across two quote requests')
  const fresh = await session(p.id)
  await quote(fresh, [1], [included])
  await quote(await session(other.id), [], [])
  await quote(await session(null), [], [])
  pass('New project chat inherits it; same-directory ordinary chat and a second project are isolated')
  await send(a, '这次单独给甲方出不含税报价')
  await quote(b, [1], [included])
  pass('One-off exception leaves project defaults intact')
  await send(a, '以后改为不含税', { action: 'note', kind: 'agreement', agreementId, text: excluded })
  await quote(b, [1, 2], [excluded])
  pass('Changing the rule replaces it in B’s active list')
  await send(a, '取消甲方的报价约定', { action: 'note', kind: 'agreement', agreementId, revoke: true })
  await quote(b, [1, 2, 3], [])
  await quote(fresh, [1, 3], [])
  await quote(b, [1, 2, 3], [])
  pass('Revocation sends an explicit empty list, including to a session that missed the edit')
  await send(a, '恢复甲方含税约定', { action: 'note', kind: 'agreement', text: included })
  await page.getByTitle('项目', { exact: true }).click()
  await page.getByRole('button', { name: '打开项目：报价项目', exact: true }).click()
  const list = page.getByRole('region', { name: '当前有效约定' })
  await list.getByText(included, { exact: true }).waitFor()
  await list.getByRole('button', { name: '编辑', exact: true }).click()
  await list.getByLabel('编辑项目约定').fill(excluded)
  await list.getByRole('button', { name: '保存', exact: true }).click()
  await list.getByText(excluded, { exact: true }).waitFor()
  await quote(b, [1, 2, 3, 5], [excluded])
  await list.getByRole('button', { name: '撤销约定', exact: true }).click()
  await list.waitFor({ state: 'hidden' })
  await quote(b, [1, 2, 3, 5, 6], [])
  pass('Edits and revocation from the project overview reach the open chat')
  assert.equal(await fs.readFile(agentsFile, 'utf8'), original)
  pass('Saving, changing and revoking agreements preserves the repository AGENTS.md')
  const taskStatus = id => page.evaluate(async ({ projectId, id }) =>
    (await window.agentDesktop.listProjectTasks({ projectId })).find(task => task.sessionId === id)?.status, { projectId: p.id, id })
  for (const mode of ['chat', 'boss']) {
    const id = (await page.evaluate(args => window.agentDesktop.createSession(args), { projectId: p.id, workspace, mode })).summary.id
    assert.equal(await taskStatus(id), 'idle')
    const turn = { toolName: 'AskUserQuestion', toolId: randomUUID(), requests: [], input: { questions: [{
      header: '验收', question: '选哪种报价？', multiSelect: false,
      options: [{ label: '含税报价', description: '使用含税价格' }, { label: '未税报价', description: '使用未税价格' }],
    }] } }
    activeTurn = turn
    await page.evaluate(id => { void window.agentDesktop.send({ sessionId: id, prompt: '请问我选择哪种报价' }).catch(console.error) }, id)
    const getQuestion = () => page.evaluate(async id =>
      (await window.agentDesktop.ipcInvoke('agent:list-pending-questions')).find(q => q.sessionId === id), id)
    const question = await until(getQuestion, mode + ' question')
    assert.equal(await taskStatus(id), 'waiting_for_user')
    const steer = intent => page.evaluate(args => window.agentDesktop.sessionInteraction(args), {
      action: 'steer', sessionId: id, id: randomUUID(), prompt: '补充报价规则', details: { intent, skills: [{ name: 'quote-check' }] },
    })
    assert.equal((await steer(mode === 'chat' ? 'boss' : 'chat')).status, 'deferred')
    assert.equal((await steer(mode)).status, 'accepted')
    await page.reload()
    await page.getByRole('button', { name: /^待处理/ }).click()
    const item = page.locator('[data-pending-work-item="question:' + question.requestId + '"]')
    await item.waitFor()
    assert.equal(await item.count(), 1)
    await item.click()
    await page.getByText('含税报价', { exact: true }).last().click()
    await page.getByRole('button', { name: '提交', exact: true }).click()
    await until(async () => (await taskStatus(id)) === 'idle' && turn.result, mode + ' answer')
    assert.equal(await taskStatus(id), 'idle')
    assert.equal(await getQuestion(), undefined)
    assert.ok(turn.result, 'missing answer tool result')
    const supplied = JSON.stringify(turn.requests.at(-1).body.messages)
    assert.ok(supplied.includes('quote-check') && supplied.includes(mode === 'boss' ? '[User-selected project skills]' : '[User-selected skills]'))
    await page.getByRole('button', { name: /^待处理/ }).click()
    assert.equal(await page.locator('[data-pending-work-item="session:' + id + ':result"]').count(), 0)
    assert.equal(await item.count(), 0)
    const sessionHome = path.join(root, 'profile', 'sessions', id)
    const metadata = JSON.parse(await fs.readFile(path.join(sessionHome, 'session.json'), 'utf8'))
    const manifest = JSON.parse(await fs.readFile(path.join(sessionHome, 'runtime/resource-manifest.json'), 'utf8'))
    assert.ok(!('instructions' in metadata.projectDefaults) && !('instructions' in manifest))
    pass(mode + ' accepts same-mode steer, defers a mode switch, restores the pending question on reload and returns to idle after the answer')
  }
  activeTurn = { requests: [] }
  const explicit = await page.evaluate(projectId => window.agentDesktop.createProjectTask({ projectId, task: { prompt: '整理简报', mode: 'chat' } }), p.id)
  await until(async () => (await taskStatus(explicit.session.id)) === 'completed', 'explicit task result')
  pass('An explicitly created project task with a successful runtime result is completed')

  activeTurn = { fail: true }
  await page.evaluate(id => window.agentDesktop.send({ sessionId: id, prompt: '模拟本次运行失败' }).catch(() => {}), b)
  assert.equal(await taskStatus(b), 'failed')
  await send(b, '重新开始')
  assert.equal(await taskStatus(b), 'idle')
  pass('A failed project turn reports failure and a successful follow-up returns it to idle')

  activeTurn = { toolName: 'AskUserQuestion', toolId: randomUUID(), requests: [], input: { questions: [{
    header: '停止', question: '继续工作吗？', multiSelect: false,
    options: [{ label: '继续', description: '继续工作' }, { label: '暂停', description: '暂停工作' }],
  }] } }
  await page.evaluate(id => { void window.agentDesktop.send({ sessionId: id, prompt: '发起确认以便停止' }).catch(() => {}) }, b)
  await until(async () => (await taskStatus(b)) === 'waiting_for_user', 'pending question before stop')
  await page.evaluate(sessionId => window.agentDesktop.abort({ sessionId }), b)
  await until(async () => (await taskStatus(b)) === 'stopped', 'stopped session')
  assert.ok(!(await page.evaluate(() => window.agentDesktop.ipcInvoke('agent:list-pending-questions'))).some(q => q.sessionId === b))
  pass('Stopping a project conversation cancels the pending request and records stopped')
  const stale = 'STALE-PROJECT-INSTRUCTIONS-' + randomUUID()
  const freshMarker = 'CURRENT-AGENTS-' + randomUUID()
  await browser.close()
  await target.close()
  const sessionHome = path.join(root, 'profile', 'sessions', b)
  const manifestPath = path.join(sessionHome, 'runtime/resource-manifest.json')
  const oldManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  await fs.writeFile(manifestPath, JSON.stringify({ ...oldManifest, instructions: stale }))
  await fs.appendFile(agentsFile, '\n' + freshMarker + '\n')
  await launch()
  const resumed = await send(b, '继续之前的会话')
  const request = JSON.stringify(resumed.requests[0].body)
  assert.equal(request.split(freshMarker).length - 1, 1)
  assert.ok(!request.includes(stale))
  pass('Restarting Electron and resuming the session reads the updated AGENTS.md once and ignores old manifest instructions')

  const bossId = (await page.evaluate(args => window.agentDesktop.createSession(args), { projectId: p.id, workspace, mode: 'boss' })).summary.id
  const childMarker = 'worker-check-' + randomUUID()
  const worker = { toolName: 'Agent', requests: [], workerRequests: [], toolId: randomUUID(), childMarker,
    input: { description: '检查项目指令', prompt: childMarker, subagent_type: 'general-purpose' } }
  activeTurn = worker
  await page.evaluate(sessionId => window.agentDesktop.send({ sessionId, mode: 'boss', prompt: '委派指令检查' }), bossId)
  await until(() => worker.workerRequests.length, 'worker model request')
  for (const child of worker.workerRequests) {
    const text = JSON.stringify(child)
    assert.ok(!text.includes(stale))
    assert.ok(text.split(freshMarker).length - 1 <= 1)
  }
  pass('Boss delegates to a real worker without replaying legacy or duplicate instructions')
  console.log(checks.length + ' CDP checks passed')
} finally {
  await target?.close(); await browser?.close()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}
