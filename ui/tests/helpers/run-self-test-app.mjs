import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { defaultInstanceId } from '../../../packages/app-runtime/src/state/index.mjs'

export async function runSelfTestApp({ packageRoot, settings, caseIds = ['startup'] }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-self-test-app-'))
  const uiRoot = fileURLToPath(new URL('../..', import.meta.url))
  const require = createRequire(import.meta.url)
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'app.moss.json'), 'utf8'))
  const zip = path.join(path.dirname(packageRoot), `${manifest.id}-${manifest.version}.zip`)
  await fs.access(zip)
  let stage = 0, server, failure, awaitingFinal = false
  const calls = []
  if (!settings) {
    server = createServer(async (request, response) => {
      try {
        if (request.method === 'GET') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'gpt-5.5', context_window: 200000 }] })); return }
        const chunks = []; for await (const chunk of request) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString())
        if (!body.tools?.some(tool => tool.name === 'app__moss_self_test__self_test')) {
          // Auxiliary calls (such as conversation titles) do not use the controller tool set.
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ id: 'auxiliary', type: 'message', role: 'assistant', model: body.model,
            content: [{ type: 'text', text: 'AI 自测' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }))
          return
        }
        const directory = path.join(root, 'apps-data/moss.self-test/instances', defaultInstanceId('moss.self-test'), 'runs')
        const ids = await fs.readdir(directory)
        const run = JSON.parse(await fs.readFile(path.join(directory, ids.find(id => id !== 'latest.json'), 'report.json'), 'utf8'))
        const results = (body.messages || []).flatMap(message => Array.isArray(message.content) ? message.content.filter(block => block.type === 'tool_result') : [])
        assert.ok(!results.some(result => result.is_error), 'Agent tool returned an error: ' + JSON.stringify(results).slice(-2000))
        const record = 'app__moss_self_test__self_test', snapshot = 'mcp__moss_test_browser__browser_snapshot', shot = 'mcp__moss_test_browser__browser_take_screenshot'
        assert.ok(body.tools.some(tool => tool.name === record), 'Selected App result tool must be resident')
        const steps = [
          { name: 'ToolSearch', input: { query: `select:${snapshot},${shot}` } },
          { name: snapshot, input: {} },
          { name: shot, input: { filename: path.join(run.evidenceDir, 'startup.png'), type: 'png' } },
          { name: record, input: { action: 'record', run_id: run.id, case_id: 'startup', status: 'passed', checks: run.cases[0].expected.map((_, index) => ({ index, passed: true, actual: 'Scripted transport verification: actual isolated Electron snapshot and screenshot captured.' })), evidence: ['startup.png'] } },
        ]
        const next = steps[stage++]
        if (next) calls.push(next.name)
        const events = [
          { type: 'message_start', message: { id: `msg_${stage}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: next ? { type: 'tool_use', id: `call_${stage}`, name: next.name, input: {} } : { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: next ? { type: 'input_json_delta', partial_json: JSON.stringify(next.input) } : { type: 'text_delta', text: 'Done' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: next ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 30 } },
          { type: 'message_stop' },
        ]
        response.setHeader('Content-Type', 'text/event-stream')
        if (!next) { awaitingFinal = true; response.write(`event: message_start\ndata: ${JSON.stringify(events[0])}\n\n`); return }
        response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
      } catch (error) { failure = error; response.writeHead(500); response.end('Scripted verification failed') }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    settings = { model: 'gpt-5.5', url: `http://127.0.0.1:${server.address().port}`, apiKey: 'scripted-test-key', permissionMode: 'default', maxTurns: 20, appearance: { themeMode: 'light', cssThemeId: 'default' } }
  }
  await fs.writeFile(path.join(root, '.self-test-app-verification'), 'isolated self-test App verification')
  await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify(settings), { mode: 0o600 })
  const env = { ...process.env, MOSS_HOME: root, MOSS_CONFIG_DIR: root, MOSS_SELF_TEST_APP_ROOT: root, MOSS_SELF_TEST_APP_ZIP: zip,
    MOSS_SELF_TEST_APP_SCRIPTED: server ? '1' : '0', MOSS_SELF_TEST_APP_CASES: JSON.stringify(caseIds), MOSS_SELF_TEST_APP_EVIDENCE_CHECK: path.join(packageRoot, 'source/apps/self-test/tests/verify-evidence.mjs'), MOSS_OPEN_DEVTOOLS: 'false' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.MOSS_SELF_TEST_RUN_ID
  delete env.VITE_DEV_SERVER_URL
  const child = spawn(require('electron'), [path.join(uiRoot, 'tests/helpers/self-test-app-main.mjs')], { cwd: uiRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const log = createWriteStream(path.join(root, 'desktop.log'), { mode: 0o600 })
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
  let buffer = '', passed = false
  child.stdout.on('data', chunk => {
    buffer += chunk
    const lines = buffer.split('\n'); buffer = lines.pop()
    for (const line of lines) if (line.startsWith('SELF_TEST_APP')) { console.log(line); if (line.startsWith('SELF_TEST_APP_PASSED')) passed = true }
  })
  console.log(`SELF_TEST_APP: artifacts ${root}`)
  const timeout = setTimeout(() => child.kill('SIGTERM'), server ? 180000 : 55 * 60000)
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
    if (failure) throw failure
    assert.equal(code, 0, `Desktop test failed; see ${root}/desktop.log`)
    assert.ok(passed, `Desktop test did not finish; see ${root}/desktop.log`)
    if (server) { assert.equal(calls.length, 4); assert.ok(awaitingFinal, 'Controller must interrupt the pending final reply after recording') }
    return root
  } finally {
    clearTimeout(timeout); log.end()
    server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve())
    // The verification artifacts are retained; remove model credentials from profiles.
    for (const file of [path.join(root, 'settings.json'), path.join(root, 'apps-data/moss.self-test/instances', defaultInstanceId('moss.self-test'), 'target/home/settings.json')]) {
      const value = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null)
      if (value) await fs.writeFile(file, JSON.stringify({ model: value.models?.text?.model || value.model,
        appearance: value.appearance, permissionMode: value.permissionMode }), { mode: 0o600 })
    }
  }
}
