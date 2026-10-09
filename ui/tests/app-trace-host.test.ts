import { afterEach, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { AppTraceHost, createTraceProtocolDefinition } from '../src/apps/app-trace-host.mjs'
import * as output from '../../src/services/trace/traceOutput'
import { withTraceScope } from '../../src/services/trace/traceScope'
import { toTraceMessages } from '../../src/services/api/traceMessages'
import { createTraceFetch, drainTraceFetchForTests } from '../../src/services/api/traceFetch'
import { AppHostCapabilityRegistry } from '../../packages/app-runtime/src/capabilities/index.mjs'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
async function fixture() {
  const home = await fs.mkdtemp(path.join(tmpdir(), 'moss-trace-app-'))
  const id = 'moss.trace--default'
  const installation = { appId: 'moss.trace', enabled: false, grants: ['trace:capture'] }
  const instance = { id, appId: 'moss.trace', enabled: true }
  let installed = false
  const runtime = {
    dataDir: path.join(home, 'apps-data'),
    installations: { get: () => installed ? installation : null },
    instances: { get: () => installed ? instance : null, list: () => installed ? [instance] : [] },
    appDataPath: (...parts: string[]) => path.join(...parts),
    getActivePackage: async () => ({ manifest: { permissions: ['trace:capture'], host: { protocols: ['moss.trace/v1'] },
backend: { } } }),
  }
  const host = new AppTraceHost({ mossHome: home, getRuntime: () => runtime, getCore: async () => ({ ...output, toTraceMessages }) })
  const directory = path.join(runtime.dataDir, 'moss.trace', 'instances', id, 'trace')
  const capture = () => withTraceScope(home, () => output.resolveTraceCapture())
  const record = (callId = 'call-1') => ({ id: callId, sessionId: 'session-1', source: 'anthropic' as const,
    request: { url: 'https://user:password@example.test/messages?token=private-token', body: { messages: [{ role: 'user', content: 'hello' }] }, headers: { authorization: 'Bearer private-key' } } })
  cleanups.push(async () => { await drainTraceFetchForTests(); await host.close(); await fs.rm(home, { recursive: true, force: true }) })
  return { home, id, host, directory, instance, installation, runtime, capture, record,
    install: () => { installed = true; installation.enabled = true }, uninstall: () => { installed = false } }
}

test('only installed, enabled and granted App captures; legacy enabled setting cannot activate Desktop', async () => {
  const f = await fixture()
  await fs.writeFile(path.join(f.home, 'trace-settings.json'), '{"traceCapture":{"enabled":true}}')
  await f.host.refresh()
  expect(f.capture()).toBeNull()
  f.install(); await f.host.refresh()
  expect(f.capture()).not.toBeNull()
  await f.capture()!.recordCall(f.record())
  const raw = await fs.readFile(path.join(f.directory, 'traces/session-1.jsonl'), 'utf8')
  expect(raw).toContain('hello')
  for (const secret of ['password', 'private-token', 'private-key']) expect(raw).not.toContain(secret)
  await expect(fs.stat(path.join(f.home, 'db/trace-index-v1.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(path.join(f.directory, 'db'))).rejects.toMatchObject({ code: 'ENOENT' })
  const old = f.capture()!
  f.installation.enabled = false
  expect(f.capture()).toBeNull() // No dependency on asynchronous runtime notifications.
  await old.recordCall(f.record('after-disable'))
  expect(await fs.readFile(path.join(f.directory, 'traces/session-1.jsonl'), 'utf8')).not.toContain('after-disable')
  await f.host.refresh()
  f.installation.enabled = true; await f.host.refresh()
  await old.recordCall(f.record('stale-generation'))
  await f.capture()!.recordCall(f.record('new-generation'))
  const next = await fs.readFile(path.join(f.directory, 'traces/session-1.jsonl'), 'utf8')
  expect(next).not.toContain('stale-generation'); expect(next).toContain('new-generation')
  f.installation.grants = []; expect(f.capture()).toBeNull()
  f.installation.grants = ['trace:capture']; f.instance.enabled = false; expect(f.capture()).toBeNull()
  f.uninstall(); await f.host.beforeDeactivation('moss.trace')
  await fs.rm(f.directory, { recursive: true, force: true })
  await old.recordCall(f.record('after-uninstall'))
  await expect(fs.stat(f.directory)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('enabled App captures through actual fetch while its Backend is not running; metadata is saved independently', async () => {
  const f = await fixture(); f.install(); await f.host.refresh()
  await withTraceScope(f.home, async () => {
    const traced = createTraceFetch(async () => new Response('{"usage":{"input_tokens":5,"output_tokens":2},"content":[{"type":"text","text":"done"}]}'), { sessionId: 'session-1' })
    const response = await traced('https://example.test/messages', { method: 'POST', body: JSON.stringify(f.record().request.body) })
    expect(await response.text()).toContain('done')
    await drainTraceFetchForTests(); await output.drainTraceOutput(f.home)
  })
  const lines = (await fs.readFile(path.join(f.directory, 'traces/session-1.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  expect(lines.every(line => line.schemaVersion === 1)).toBe(true)
  expect(lines.filter(line => line.type === 'call').map(line => line.record.status)).toEqual(['pending', 'ok'])
  await f.host.recordSession({ id: 'desktop-1', underlyingSessionId: 'session-1', title: '排查配置', workspace: '/fixture',
    history: [{ type: 'user', uuid: 'u', prompt: 'hello', timestamp: 1000 }] })
  const meta = JSON.parse(await fs.readFile(path.join(f.directory, 'sessions/session-1.json'), 'utf8'))
  expect(meta.session.title).toBe('排查配置'); expect(meta.messages[0].content).toBe('hello')
})

test('imports old raw records once, leaves originals intact, and never imports the old switch', async () => {
  const f = await fixture()
  await fs.mkdir(path.join(f.home, 'traces'))
  await fs.writeFile(path.join(f.home, 'traces/legacy.jsonl'), '{"legacy":true}\n')
  await fs.writeFile(path.join(f.home, 'trace-settings.json'), '{"traceCapture":{"enabled":false}}')
  f.install(); await f.host.refresh()
  expect(f.capture()).not.toBeNull()
  expect(await fs.readFile(path.join(f.directory, 'traces/legacy.jsonl'), 'utf8')).toContain('legacy')
  expect(await fs.readFile(path.join(f.home, 'traces/legacy.jsonl'), 'utf8')).toContain('legacy')
})

test('Trace protocol exposes status only and denies undeclared capture grants and output paths', async () => {
  const protocol = createTraceProtocolDefinition()
  expect(Object.keys(protocol.methods)).toEqual(['status'])
  expect(() => protocol.methods.status.validateInput({ directory: '/tmp/elsewhere' })).toThrow()
  const registry = new AppHostCapabilityRegistry({ protocols: [protocol] })
  registry.registerHandler('moss.trace/v1', 'status', () => ({ enabled: true }))
  await expect(registry.dispatch({ appId: 'moss.trace', instanceId: 'moss.trace--default', protocol: 'moss.trace/v1', method: 'status',
    input: {}, protocols: ['moss.trace/v1'], permissions: ['trace:capture'], grants: [] })).rejects.toThrow()
})

test('Core generates record identities and reports disk failures without changing model responses', async () => {
  const f = await fixture(); f.install(); await f.host.refresh()
  const record = f.record(); delete (record as { id?: string }).id
  const stored = await f.capture()!.recordCall(record) as { id: string }
  expect(stored.id).toMatch(/^[a-f0-9-]{36}$/)
  await fs.rm(path.join(f.directory, 'traces'), { recursive: true })
  await fs.writeFile(path.join(f.directory, 'traces'), 'blocked directory')
  await withTraceScope(f.home, async () => {
    const traced = createTraceFetch(async () => new Response('model response'), { sessionId: 'session-1' })
    expect(await (await traced('https://example.test/messages', { method: 'POST', body: '{}' })).text()).toBe('model response')
    await drainTraceFetchForTests()
  })
  const status = await f.host.status({ appId: 'moss.trace', instanceId: f.id })
  expect(status.enabled).toBe(true)
  expect(status.droppedRecords).toBeGreaterThan(0)
  expect(status.error).toBeTruthy()
})
