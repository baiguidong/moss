import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AppSessionSourceHost, SESSION_SOURCE_PROTOCOL, sessionSourceFileName } from '../src/apps/app-session-source-host.mjs'

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-session-source-'))
  const appId = 'example.reader', instanceId = `${appId}--default`
  const installation = { appId, enabled: true, grants: ['session-source:read', 'session-source:open'] }
  const instance = { id: instanceId, appId, enabled: true }
  const sessions = [
    { id: 'one', agentMode: 'local', updatedAt: 1, busy: false, title: 'One', history: [{ uuid: 'a', token: 'PRIVATE' }] },
    { id: 'two', agentMode: 'local', updatedAt: 1, busy: false, title: 'Two', history: [{ uuid: 'b' }] },
    { id: 'remote', agentMode: 'remote-direct', updatedAt: 1, history: [] },
  ]
  const opened = []
  const runtime = {
    dataDir: path.join(home, 'apps-data'),
    installations: { get: id => id === appId ? installation : null, list: () => [installation] },
    instances: { get: id => id === instanceId ? instance : null, list: id => id === appId ? [instance] : [] },
    appDataPath: (...parts) => path.join(...parts),
    getActivePackage: async () => ({ manifest: { permissions: installation.grants, host: { protocols: [SESSION_SOURCE_PROTOCOL] } } }),
  }
  let snapshotCalls = 0
  const host = new AppSessionSourceHost({ mossHome: home, getRuntime: () => runtime, getSessions: () => sessions,
    getSessionRevision: session => JSON.stringify([session.updatedAt, session.history.length, session.busy, session.title]),
    getSessionSnapshot: session => { snapshotCalls++; return session }, openSession: input => opened.push(input),
    log: error => { throw error } })
  const context = { appId, instanceId }
  t.after(async () => { await host.close(); await fs.rm(home, { recursive: true, force: true }) })
  return { home, host, installation, sessions, context, opened, snapshotCalls: () => snapshotCalls,
    root: path.join(runtime.dataDir, appId, 'instances', instanceId, 'session-source') }
}

test('lists cheap revisions and exports only requested local sessions', async t => {
  const f = await fixture(t)
  const listed = f.host.handle('session.list', {}, f.context)
  assert.deepEqual(listed.sessions.map(session => session.id), ['one', 'two'])
  assert.equal(f.snapshotCalls(), 0)
  const exported = await f.host.handle('session.export', { sessionId: 'one' }, f.context)
  assert.equal(exported.fileName, sessionSourceFileName('one'))
  assert.equal(f.snapshotCalls(), 1)
  const file = path.join(f.root, exported.fileName)
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).history[0].token, '[REDACTED]')
  const before = await fs.stat(file)
  await f.host.handle('session.export', { sessionId: 'one' }, f.context)
  assert.equal((await fs.stat(file)).ino, before.ino)
  assert.equal(f.snapshotCalls(), 1)
  f.sessions[0].updatedAt++
  f.sessions[0].history.push({ uuid: 'c' })
  await f.host.handle('session.export', { sessionId: 'one' }, f.context)
  assert.equal(f.snapshotCalls(), 2)
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).history.length, 2)
  assert.deepEqual((await fs.readdir(f.root)).filter(name => name.endsWith('.json')), [exported.fileName])
})

test('session events survive history truncation and revoked Apps cannot export', async t => {
  const f = await fixture(t)
  const ticket = await f.host.recordEvent({ sessionId: 'one', eventType: 'turn_reverted', details: { status: 'started' }, sourceSession: { history: [{ token: 'PRIVATE' }] } })
  assert.equal(ticket.length, 1)
  assert.equal(await f.host.updateEvent(ticket, { status: 'completed' }), true)
  const event = JSON.parse(await fs.readFile(path.join(f.root, 'events', `${ticket[0].id}.json`), 'utf8'))
  assert.equal(event.details.status, 'completed')
  assert.equal(event.sourceSession.history[0].token, '[REDACTED]')
  assert.deepEqual(f.host.handle('session.open', { sessionId: 'one' }, f.context), { opened: true })
  assert.equal(f.opened.length, 1)
  assert.throws(() => f.host.handle('session.open', { sessionId: 'remote' }, f.context), /不存在/)
  await f.host.beforeDeactivation(f.context.appId)
  f.installation.enabled = false
  assert.throws(() => f.host.handle('session.list', {}, f.context), /权限已变更/)
  assert.equal(await f.host.updateEvent(ticket, { status: 'late' }), false)
})
