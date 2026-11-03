import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuthService } from '../auth/service.js'
import { readServerConfig } from '../config.js'
import { createModels } from '../model/index.js'
import { startServer } from '../server.js'
import type { ServerConfig } from '../types.js'

const root = await mkdtemp(join(tmpdir(), 'moss-user-usage-'))
process.env.MOSS_SERVER_HOME = root
const models = await createModels({ driver: 'sqlite', filename: join(root, 'usage.db') })
try {
  const { service: auth } = await createAuthService({
    db: models.db, tokenTtlSec: 3600, bootstrapAdmin: { username: 'admin', password: 'password' },
  })
  const adminLogin = await auth.issueTokenFromPassword({ username: 'admin', password: 'password' })
  const admin = (await auth.verifyAccessToken(adminLogin.access_token))!
  const alice = (await auth.createUser({ orgId: admin.orgId, name: 'Alice', email: 'alice@example.test', role: 'user', password: 'password' }, admin)).user
  const aliceLogin = await auth.issueTokenFromPassword({ email: 'alice@example.test', password: 'password' })
  const { config } = await readServerConfig(join(root, 'server.json'))
  const serverConfig: ServerConfig = { ...config, port: 0, host: '127.0.0.1' }
  const app = startServer(serverConfig, models, auth)
  try {
    const base = `http://127.0.0.1:${await app.ready}`
    const call = async (path: string, token = aliceLogin.access_token, body?: unknown, method = body ? 'POST' : 'GET') => {
      const response = await fetch(base + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      return { status: response.status, body: await response.json() as any }
    }

    const cloudHeartbeat = { id: 'cloud-alice', epoch: 'epoch-cloud', name: '我的云电脑', kind: 'cloud', version: 'test', platform: 'linux', status: { activeSessions: 0 } }
    const desktopHeartbeat = { id: 'desktop-alice', epoch: 'epoch-desktop', name: 'Alice laptop', kind: 'desktop', version: 'test', platform: 'macos', status: { activeSessions: 0 } }
    const cloudEnrollment = await call('/api/v1/hosts/enroll', aliceLogin.access_token, cloudHeartbeat)
    const desktopEnrollment = await call('/api/v1/hosts/enroll', aliceLogin.access_token, desktopHeartbeat)
    assert.equal(cloudEnrollment.status, 200)
    assert.equal(desktopEnrollment.status, 200)

    const event = (id: string) => ({ eventId: id, sessionId: 'session-one', model: 'test', occurredAt: Date.now(), inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 })
    assert.equal((await call('/api/v1/hosts/cloud-alice/usage', cloudEnrollment.body.token, { events: [event('cloud-usage')] })).status, 200)
    assert.equal((await call('/api/v1/hosts/desktop-alice/usage', desktopEnrollment.body.token, { events: [event('desktop-usage')] })).status, 200)

    const all = await call('/api/v1/usage')
    assert.equal(all.status, 200)
    assert.equal(all.body.totals.totalTokens, 30)
    const cloud = await call('/api/v1/usage?host_kind=cloud')
    assert.equal(cloud.status, 200)
    assert.equal(cloud.body.totals.totalTokens, 15)
    assert.deepEqual(cloud.body.daily.map((row: any) => row.totalTokens), [15])
    assert.equal((await call('/api/v1/usage?host_kind=desktop')).status, 400)

    console.log('Usage: Host reports are deduplicated and cloud overview excludes Desktop usage')
  } finally {
    await app.stop()
  }
} finally {
  await models.close()
  await rm(root, { recursive: true, force: true })
}
