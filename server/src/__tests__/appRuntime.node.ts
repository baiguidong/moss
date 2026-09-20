import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ServerAppRuntime } from '../apps/serverAppRuntime.js'
import { createAuthService } from '../auth/service.js'
import { startServer } from '../server.js'
import type { RuntimeService } from '../runtimeService.js'
import { defaultInstanceId, writePackageChecksums } from '../../../packages/app-runtime/src/index.mjs'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-server-app-'))
try {
  const appId = 'fixture.persistent-single'
  const version = '1.0.0'
  const fixtureRoot = [
    path.resolve('ui/tests/fixtures/apps'),
    path.resolve('../ui/tests/fixtures/apps'),
  ].find(candidate => existsSync(candidate))
  if (!fixtureRoot) throw new Error('App Runtime fixtures are unavailable')
  const source = path.join(root, 'source', appId, 'versions', version)
  await fs.mkdir(path.dirname(source), { recursive: true })
  await fs.cp(path.join(fixtureRoot, 'persistent-single'), source, { recursive: true })
  await writePackageChecksums(source)
  const prereleaseVersion = '1.1.0-beta.1+build.7'
  const prereleaseSource = path.join(root, 'source', appId, 'versions', prereleaseVersion)
  await fs.cp(source, prereleaseSource, { recursive: true })
  const prereleaseManifestPath = path.join(prereleaseSource, 'app.moss.json')
  const prereleaseManifest = JSON.parse(await fs.readFile(prereleaseManifestPath, 'utf8'))
  prereleaseManifest.version = prereleaseVersion
  await fs.writeFile(prereleaseManifestPath, `${JSON.stringify(prereleaseManifest, null, 2)}\n`)
  await writePackageChecksums(prereleaseSource)
  const desktopOnlyVersion = '1.2.0'
  const desktopOnlySource = path.join(root, 'source', appId, 'versions', desktopOnlyVersion)
  await fs.cp(source, desktopOnlySource, { recursive: true })
  const desktopOnlyManifestPath = path.join(desktopOnlySource, 'app.moss.json')
  const desktopOnlyManifest = JSON.parse(await fs.readFile(desktopOnlyManifestPath, 'utf8'))
  desktopOnlyManifest.version = desktopOnlyVersion
  desktopOnlyManifest.backend.targets = ['desktop']
  await fs.writeFile(desktopOnlyManifestPath, `${JSON.stringify(desktopOnlyManifest, null, 2)}\n`)
  await writePackageChecksums(desktopOnlySource)
  const config = {
    host: '127.0.0.1', port: 0, authMode: 'local' as const, tokenTtlSec: 3600,
    bootstrapAdmin: { username: 'admin' }, idleTimeoutMs: 1000, maxSessions: 1,
    rootDir: root, dbPath: path.join(root, 'server.db'), dataDir: path.join(root, 'data'),
    runDir: path.join(root, 'run'), logDir: path.join(root, 'logs'), dockerStopTimeoutSec: 1,
    dockerLabels: {}, startupPolicy: 'reattach-or-resume' as const, heartbeatTimeoutMs: 1000,
    reattachProbeTimeoutMs: 100, resumeOnMissingRuntime: true, logLevel: 'error' as const,
    appSourceDir: path.join(root, 'source'),
  }
  const instanceId = defaultInstanceId(appId)
  const first = await ServerAppRuntime.create(config, 'server-node-a')
  await first.installKnown(appId, version)
  await first.installKnown(appId, prereleaseVersion)
  await assert.rejects(
    () => first.installKnown(appId, desktopOnlyVersion),
    /App does not support Server deployment/,
  )
  assert.equal((await first.runtime.packages.get(appId, prereleaseVersion)).manifest.version, prereleaseVersion)
  await first.runtime.setInstanceEnabled(appId, instanceId, true)
  await first.runtime.setAppEnabled(appId, true)
  assert.equal((await first.runtime.getInstanceStatus(appId, instanceId))[0].runtime.state, 'running')

  const competing = await ServerAppRuntime.create(config, 'server-node-b')
  assert.equal((await competing.runtime.getInstanceStatus(appId, instanceId))[0].runtime.state, 'stopped')
  assert.equal((await first.runtime.getInstanceStatus(appId, instanceId))[0].runtime.state, 'running')
  await competing.shutdown()
  await first.shutdown()

  const restored = await ServerAppRuntime.create(config, 'server-node-c')
  assert.equal((await restored.runtime.getInstanceStatus(appId, instanceId))[0].runtime.state, 'running')
  assert.equal((await restored.runtime.getApp(appId)).deployments.length, 1)

  const authDb = new DatabaseSync(':memory:')
  const { service: authService } = await createAuthService({
    db: authDb,
    dbPath: ':memory:',
    tokenTtlSec: 3600,
    bootstrapAdmin: { username: 'admin', password: 'admin-password', email: 'admin@example.com' },
  })
  const sessionRuntime = { store: { db: authDb }, countActiveSessions: () => 0 } as unknown as RuntimeService
  const server = startServer(config, sessionRuntime, authService, undefined, restored)
  try {
    const port = await server.ready
    assert.ok(port)
    const baseUrl = `http://127.0.0.1:${port}`
    assert.equal((await fetch(`${baseUrl}/api/v1/apps`)).status, 401)
    const login = authService.issueTokenFromPassword({ username: 'admin', password: 'admin-password' })
    const adminAuth = authService.verifyAccessToken(login.access_token)
    assert.ok(adminAuth)
    const appUserRole = authService.createRole({
      orgId: login.user.orgId,
      name: 'App user',
      permissions: ['apps:read', 'apps:manage', 'apps:deploy', 'apps:logs'],
    }).role
    authService.createUser({
      orgId: login.user.orgId,
      email: 'app-user@example.com',
      name: 'app-user',
      roleIds: [appUserRole.id],
      password: 'app-user-password',
    }, adminAuth)
    const appUserLogin = authService.issueTokenFromPassword({
      username: 'app-user',
      password: 'app-user-password',
    })
    const headers = { authorization: `Bearer ${login.access_token}`, 'content-type': 'application/json' }
    const appUserHeaders = { authorization: `Bearer ${appUserLogin.access_token}`, 'content-type': 'application/json' }
    const emptyUserListResponse = await fetch(`${baseUrl}/api/v1/apps`, { headers })
    assert.equal(emptyUserListResponse.status, 200)
    assert.equal(((await emptyUserListResponse.json()) as { apps: unknown[] }).apps.length, 0)
    const userInstallResponse = await fetch(`${baseUrl}/api/v1/apps/install`, {
      method: 'POST', headers, body: JSON.stringify({ appId, version, grants: [] }),
    })
    assert.equal(userInstallResponse.status, 200)
    const userListResponse = await fetch(`${baseUrl}/api/v1/apps`, { headers })
    const userApps = (await userListResponse.json()) as { apps: Array<{ installation: { owner: { scope: string; userId: string } } }> }
    assert.equal(userApps.apps.length, 1)
    assert.equal(userApps.apps[0]?.installation.owner.scope, 'user')
    assert.equal(userApps.apps[0]?.installation.owner.userId, login.user.id)
    const otherUserBeforeInstall = await fetch(`${baseUrl}/api/v1/apps`, { headers: appUserHeaders })
    assert.equal(otherUserBeforeInstall.status, 200)
    assert.equal(((await otherUserBeforeInstall.json()) as { apps: unknown[] }).apps.length, 0)
    const otherUserInstall = await fetch(`${baseUrl}/api/v1/apps/install`, {
      method: 'POST', headers: appUserHeaders, body: JSON.stringify({ appId, version, grants: [] }),
    })
    assert.equal(otherUserInstall.status, 200)
    const otherUserApps = (await (await fetch(`${baseUrl}/api/v1/apps`, { headers: appUserHeaders })).json()) as {
      apps: Array<{ installation: { owner: { userId: string } } }>
    }
    assert.equal(otherUserApps.apps.length, 1)
    assert.equal(otherUserApps.apps[0]?.installation.owner.userId, appUserLogin.user.id)
    const adminUserApps = (await (await fetch(`${baseUrl}/api/v1/apps`, { headers })).json()) as {
      apps: Array<{ installation: { owner: { userId: string } } }>
    }
    assert.equal(adminUserApps.apps.length, 1)
    assert.equal(adminUserApps.apps[0]?.installation.owner.userId, login.user.id)
    assert.equal((await fetch(`${baseUrl}/api/v1/apps?owner_scope=host`, { headers: appUserHeaders })).status, 403)
    assert.equal((await fetch(`${baseUrl}/api/v1/apps?owner_scope=org`, { headers: appUserHeaders })).status, 403)
    const listResponse = await fetch(`${baseUrl}/api/v1/apps?owner_scope=host`, { headers })
    assert.equal(listResponse.status, 200)
    assert.equal(((await listResponse.json()) as { apps: unknown[] }).apps.length, 1)
    const availabilityResponse = await fetch(`${baseUrl}/api/v1/apps/availability`, {
      method: 'POST', headers, body: JSON.stringify({ packages: [
        { appId, version },
        { appId, version: desktopOnlyVersion },
        { appId, version: '9.9.9' },
      ] }),
    })
    assert.equal(availabilityResponse.status, 200)
    assert.deepEqual((await availabilityResponse.json() as { packages: Array<{ available: boolean }> }).packages.map(item => item.available), [true, false, false])
    const desktopOnlyInstallResponse = await fetch(`${baseUrl}/api/v1/apps/install`, {
      method: 'POST', headers, body: JSON.stringify({ appId, version: desktopOnlyVersion }),
    })
    assert.equal(desktopOnlyInstallResponse.status, 400)
    assert.equal((await desktopOnlyInstallResponse.json() as { code: string }).code, 'APP_INVALID_PACKAGE')
    const invalidAvailabilityResponse = await fetch(`${baseUrl}/api/v1/apps/availability`, {
      method: 'POST', headers, body: JSON.stringify({ packages: null }),
    })
    assert.equal(invalidAvailabilityResponse.status, 400)
    const malformedResponse = await fetch(`${baseUrl}/api/v1/apps/install`, {
      method: 'POST', headers, body: '{',
    })
    assert.equal(malformedResponse.status, 400)
    const disableResponse = await fetch(`${baseUrl}/api/v1/apps/${encodeURIComponent(appId)}`, {
      method: 'PATCH', headers, body: JSON.stringify({ enabled: false, ownerScope: 'host' }),
    })
    assert.equal(disableResponse.status, 200)
    assert.equal((await restored.runtime.getApp(appId)).installation.enabled, false)
  } finally {
    await server.stop()
    authDb.close()
  }
  await restored.shutdown()
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
