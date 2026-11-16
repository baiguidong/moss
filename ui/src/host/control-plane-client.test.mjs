import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createHostControlClient } from './control-plane-client.mjs'

test('restarting and signing in again reuse the registered computer identity', async t => {
  const home = await mkdtemp(join(tmpdir(), 'moss-host-identity-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const reports = []
  let accountId = 'alice'
  const options = {
    home, kind: 'desktop', version: 'test',
    db: { exec() {}, prepare() { return { all() { return [] } } } },
    getConnection: () => ({ serverUrl: 'https://enterprise.test', accountId, authToken: 'user-token' }),
    getStatus: () => ({}), execute() {}, applyPolicy() {}, onError(error) { throw error },
    fetchImpl: async (_url, init) => {
      reports.push(JSON.parse(init.body))
      return Response.json({ token: 'device-token', policy: {} })
    },
  }
  const first = createHostControlClient(options)
  await first.refresh()
  await first.stop()
  const second = createHostControlClient(options)
  await second.refresh()
  accountId = 'bob'
  await second.refresh()
  accountId = 'alice'
  await second.refresh()
  await second.stop()
  assert.equal(reports[0].id, reports[1].id)
  assert.notEqual(reports[0].epoch, reports[1].epoch)
  assert.notEqual(reports[0].id, reports[2].id)
  assert.equal(reports[0].id, reports[3].id)
})

test('corrupt state is preserved instead of silently enrolling another computer', async t => {
  const home = await mkdtemp(join(tmpdir(), 'moss-host-corrupt-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const filename = join(home, 'control-plane.json')
  for (const value of ['{broken', 'null', '[]', '{}', '{"deviceId":42}', '{"deviceId":"device","accounts":null}']) {
    await writeFile(filename, value)
    const errors = []
    const client = createHostControlClient({ home, db: { exec() {} }, onError: error => errors.push(error),
      fetchImpl: () => assert.fail('corrupt state must not enroll a new computer') })
    await client.refresh()
    await client.stop()
    assert.match(errors[0].message, /control-plane.json/)
    assert.equal(await readFile(filename, 'utf8'), value)
  }
})

test('clears the active account when the Moss token is rejected', async () => {
  const home = await mkdtemp(join(tmpdir(), 'moss-host-control-'))
  const accountChanges = []
  const accessChanges = []
  const db = {
    exec() {},
    prepare() {
      return { run() {}, all() { return [] } }
    },
  }
  const error = Object.assign(new Error('invalid access token'), { status: 401 })
  const client = createHostControlClient({
    home,
    db,
    kind: 'desktop',
    version: 'test',
    getConnection: async () => { throw error },
    getStatus: () => ({}),
    execute: async () => {},
    applyPolicy: async () => {},
    applyAccess: async value => { accessChanges.push(value) },
    onAccountChange: value => { accountChanges.push(value) },
    onError: cause => { throw cause },
  })

  await assert.rejects(client.refresh(), error)
  assert.deepEqual(accountChanges, [null])
  assert.deepEqual(accessChanges, [{ allowed: false, reason: '企业账号已停用或凭据失效。' }])
  await client.stop()
  await rm(home, { recursive: true, force: true })
})
