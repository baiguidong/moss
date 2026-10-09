import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { AppAuditHost, createAuditProtocolDefinition, AUDIT_PROTOCOL } from '../src/apps/app-audit-host.mjs'
import { AppHostCapabilityRegistry } from '../../packages/app-runtime/src/capabilities/index.mjs'

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-audit-host-'))
  const instance = { id: 'moss.audit--default', appId: 'moss.audit', enabled: true }
  const installation = { enabled: true, grants: ['audit:read', 'audit:navigate', 'audit:notify'] }
  const sessions = [{ id: 'local-1', agentMode: 'local', title: '本地会话', workspace: '/workspace', history: [] }, { id: 'cloud-1', agentMode: 'remote-direct' }]
  const opened = [], notifications = []
  const runtime = {
    dataDir: path.join(home, 'apps-data'),
    installations: { get: () => installation },
    instances: { get: id => id === instance.id ? instance : null, list: () => [instance] },
    appDataPath: (...parts) => path.join(...parts),
    getActivePackage: async () => ({ manifest: { permissions: installation.grants, host: { protocols: [AUDIT_PROTOCOL] },
backend: { } } }),
  }
  const host = new AppAuditHost({ mossHome: home, getRuntime: () => runtime, getSessions: () => sessions,
    openSession: input => opened.push(input), notify: (...args) => notifications.push(args) })
  const context = { appId: 'moss.audit', instanceId: instance.id }
  const root = path.join(runtime.dataDir, 'moss.audit', 'instances', instance.id)
  t.after(async () => { await host.close(); await fs.rm(home, { recursive: true, force: true }) })
  return { home, host, runtime, installation, instance, sessions, root, context, opened, notifications,
    capture: () => host.handle('source.capture', {}, context) }
}

test('disabled or ungranted Audit cannot capture or make rewind depend on an App', async t => {
  const f = await fixture(t)
  for (const disable of [() => { f.installation.enabled = false }, () => { f.installation.enabled = true; f.installation.grants = [] }]) {
    disable()
    assert.throws(f.capture, /审计 App 未启用/)
    assert.equal(await f.host.recordEvent({ sessionId: 'local-1' }), null)
  }
  await assert.rejects(fs.stat(f.root), { code: 'ENOENT' })
})

test('exports full local snapshots outside IPC, with secrets redacted at the Host boundary', async t => {
  const f = await fixture(t)
  f.sessions[0].history = [{ message: { content: '正文'.repeat(400_000), api_key: 'PRIVATE_API_KEY' }, result: 'Bearer PRIVATE_TOKEN' }]
  const result = await f.capture()
  assert.equal(result.sessionCount, 1)
  assert.ok(JSON.stringify(result).length < 200)
  const raw = await fs.readFile(path.join(f.root, 'source/snapshot.json'), 'utf8')
  assert.ok(Buffer.byteLength(raw) > 1024 * 1024)
  assert.ok(!raw.includes('PRIVATE_API_KEY') && !raw.includes('PRIVATE_TOKEN') && !raw.includes('cloud-1'))
  assert.equal(JSON.parse(raw).sessions[0].history[0].message.content.length, 800_000)
})

test('backs up the live legacy WAL database once and retains the original and App edits', async t => {
  const f = await fixture(t)
  const old = new DatabaseSync(path.join(f.home, 'audit.db'))
  t.after(() => old.close())
  old.exec("PRAGMA journal_mode=WAL; CREATE TABLE records (id TEXT, state TEXT); INSERT INTO records VALUES ('old', 'resolved')")
  await f.capture()
  const migrated = new DatabaseSync(path.join(f.root, 'audit.db'))
  assert.equal(migrated.prepare('SELECT state FROM records').get().state, 'resolved')
  migrated.exec("UPDATE records SET state='acknowledged'")
  migrated.close()
  await f.capture()
  const reopened = new DatabaseSync(path.join(f.root, 'audit.db'), { readOnly: true })
  assert.equal(reopened.prepare('SELECT state FROM records').get().state, 'acknowledged')
  reopened.close()
  assert.equal(old.prepare('SELECT state FROM records').get().state, 'resolved')
})

test('rewind events survive Backend inactivity; stale tickets cannot write after revocation', async t => {
  const f = await fixture(t)
  const ticket = await f.host.recordEvent({ sessionId: 'local-1', eventType: 'turn_reverted', details: { status: 'started' }, sourceSession: { history: ['retained'] } })
  assert.equal(await f.host.updateEvent(ticket, { status: 'completed' }), true)
  const eventPath = path.join(f.root, 'events', `${ticket.id}.json`)
  assert.equal(JSON.parse(await fs.readFile(eventPath, 'utf8')).details.status, 'completed')
  await f.host.beforeDeactivation('moss.audit')
  f.installation.enabled = false
  await fs.rm(f.root, { recursive: true })
  assert.equal(await f.host.updateEvent(ticket, { status: 'late' }), false)
  await assert.rejects(fs.stat(f.root), { code: 'ENOENT' })
  f.installation.enabled = true; f.host.refresh()
  assert.equal(await f.host.updateEvent(ticket, {}), false)
})

test('pending capture is invalidated before deactivation completes', async t => {
  const f = await fixture(t)
  const pending = f.capture()
  const rejection = assert.rejects(pending, /授权已变更/)
  await f.host.beforeDeactivation('moss.audit')
  await rejection
  await assert.rejects(fs.stat(f.root), { code: 'ENOENT' })
})

test('refuses symlink exports and cross-App calls', async t => {
  const f = await fixture(t)
  await fs.mkdir(f.root, { recursive: true })
  await fs.symlink(f.home, path.join(f.root, 'source'))
  await assert.rejects(f.capture(), /符号链接/)
  assert.throws(() => f.host.handle('source.capture', {}, { ...f.context, appId: 'other.app' }), /仅供审计/)
})

test('navigation only accepts existing local sessions; notifications are App scoped', async t => {
  const f = await fixture(t)
  assert.deepEqual(f.host.handle('session.open', { sessionId: 'local-1', toolUseId: 'tool-1' }, f.context), { opened: true })
  assert.throws(() => f.host.handle('session.open', { sessionId: 'cloud-1' }, f.context), /不存在/)
  f.host.handle('notification.publish', { id: 'finding-1', severity: 'warning', title: '风险', message: '待处理' }, f.context)
  assert.equal(f.notifications[0][0].source, '审计中心')
  assert.equal(f.notifications[0][1].id, 'audit:finding-1')
})

test('capability registry enforces grants and rejects arbitrary paths and methods', async () => {
  const definition = createAuditProtocolDefinition()
  assert.throws(() => definition.methods['source.capture'].validateInput({ path: '/private' }))
  const registry = new AppHostCapabilityRegistry({ protocols: [definition] })
  registry.registerHandler(AUDIT_PROTOCOL, 'source.capture', () => ({ schemaVersion: 1, capturedAt: 1, sessionCount: 0 }))
  const input = { appId: 'moss.audit', instanceId: 'default', protocol: AUDIT_PROTOCOL, method: 'source.capture', input: {}, protocols: [AUDIT_PROTOCOL], permissions: ['audit:read'], grants: [] }
  await assert.rejects(registry.dispatch(input))
  assert.deepEqual(await registry.dispatch({ ...input, grants: ['audit:read'] }), { schemaVersion: 1, capturedAt: 1, sessionCount: 0 })
})
