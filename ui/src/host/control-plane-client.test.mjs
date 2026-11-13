import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createHostControlClient } from './control-plane-client.mjs'

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
