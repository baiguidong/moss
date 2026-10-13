// Exercise the built ClaudeSession API without model requests or the user's settings.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-session-mcp-'))
process.env.MOSS_HOME = path.join(root, 'home')
process.env.MOSS_CONFIG_DIR = process.env.MOSS_HOME
const { ClaudeSession, getMcpRuntimeStats } = await import('../ui/electron-direct.mjs')
const fixture = fileURLToPath(new URL('../src/services/mcp/fixtures/stateful-server.mjs', import.meta.url))
const sessions = []
const checks = []
const record = name => { checks.push(name); console.log(`PASS ${name}`) }
const create = ({ env, ...options } = {}) => {
  const instance = new ClaudeSession({ cwd: root, model: 'lifecycle-fixture', mcpServers: {
    fixture: { command: process.execPath, args: [fixture], env: { MCP_TEST_RESOURCES: '1', ...env } },
  }, appToolPolicy: { appIds: [], mcpServers: { fixture: { appId: 'test.app', toolScope: 'global' } } }, ...options })
  sessions.push(instance)
  return instance
}
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
const waitFor = async predicate => {
  for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error('Timed out waiting for lifecycle transition')
}
const call = async (session, name, args = {}) => {
  const connection = session.getAppState().mcp.clients.find(client => client.name === 'fixture')
  assert.equal(connection?.type, 'connected', JSON.stringify(session.getAppState().mcp.clients.map(({ name, type, error }) => ({ name, type, error }))))
  const result = await connection.client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema)
  return JSON.parse(result.content[0].text)
}
try {
  const a = create(), b = create()
  await Promise.all([a.previewFileRewind('missing'), b.previewFileRewind('missing')])
  assert.equal(a.getIdleRetirementBlocker(), 'stateful-mcp')
  await assert.rejects(a.prepareForIdleDispose(), /active work or MCP state/)
  const va = await call(a, 'set_value', { value: 'session A' }), vb = await call(b, 'get_value')
  assert.notEqual(va.pid, vb.pid); assert.equal(vb.value, '')
  await a.dispose(); await waitFor(() => !alive(va.pid))
  assert.equal((await call(b, 'get_value')).pid, vb.pid)
  await assert.rejects(a.send('after disposal').next(), /disposed/)
  await b.reconcileAppMcpServers([]); await waitFor(() => !alive(vb.pid))
  assert.equal(b.getIdleRetirementBlocker(), null)
  await assert.rejects(call(b, 'get_value'))
  await b.dispose()
  record('ClaudeSession: global visibility, separate state, automatic retirement protection, disposal and immediate revocation')

  const pidLog = path.join(root, 'cancel-pids')
  const cancelling = create({ env: { MCP_TEST_PID_LOG: pidLog, MCP_TEST_HANDSHAKE_DELAY: '2000' } })
  const pending = cancelling.previewFileRewind('missing'); void pending.catch(() => {})
  await waitFor(async () => { try { return Boolean(await fs.readFile(pidLog, 'utf8')) } catch { return false } })
  const pid = Number((await fs.readFile(pidLog, 'utf8')).trim())
  await cancelling.dispose(); await assert.rejects(pending)
  await waitFor(() => !alive(pid))
  const replacement = create({ sessionId: cancelling.sessionId })
  await replacement.previewFileRewind('missing')
  const next = await call(replacement, 'get_value')
  assert.notEqual(next.pid, pid)
  await cancelling.dispose()
  assert.equal((await call(replacement, 'get_value')).pid, next.pid)
  await replacement.dispose(); await waitFor(() => !alive(next.pid))
  const stats = getMcpRuntimeStats()
  assert.equal(stats.entries, 0); assert.equal(stats.lifetimes, 0)
  record('ClaudeSession: cancellation during initialization, safe generation replacement and zero leaked connections')
  const output = fileURLToPath(new URL('../output/mcp-app-proof/', import.meta.url))
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(output, 'lifecycle-verification.json'), `${JSON.stringify({ passed: true, at: new Date().toISOString(), checks, stats }, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${error.stack}\n`)
  process.exitCode = 1
} finally {
  await Promise.all(sessions.map(session => session.dispose()))
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 })
}
