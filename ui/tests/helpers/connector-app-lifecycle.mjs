import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import JSZip from 'jszip'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-connector-lifecycle-'))
process.env.MOSS_HOME = path.join(root, 'home')
const hub = await import('../../src/connector-hub-ipc.mjs')
const platform = await import('../../src/app-platform.mjs')
const { createAppRuntime } = await import('../../src/apps/app-runtime.mjs')
const { createConnectorAppHost } = await import('../../src/apps/connector-app-host.mjs')
const { createAppMarketplaceService } = await import('../../src/apps/app-marketplace.mjs')
const { writePackageChecksums, createAppSignaturePayload } = await import('../../../packages/app-runtime/src/packages/index.mjs')
const appId = 'example.team-tools', id = 'fixture-cli'
let runtime, confirm = true, failActivation = false
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const trustedPublishers = { moss: { keys: { fixture: publicKey.export({ type: 'spki', format: 'pem' }).toString() } } }
const payload = path.join(root, 'package')
const createRuntime = () => createAppRuntime({ mossHome: process.env.MOSS_HOME, appsDir: platform.APPS_DIR, nodeExecutable: process.execPath, trustedPublishers })
try {
  const legacyDir = path.join(process.env.MOSS_HOME, 'connectors/installed/legacy-fixture')
  await fs.mkdir(legacyDir, { recursive: true })
  await fs.writeFile(path.join(legacyDir, 'connector.json'), JSON.stringify({ id: 'legacy-fixture', name: 'Old service', enabled: true }))
  await fs.writeFile(path.join(legacyDir, 'mcp.json'), JSON.stringify({ mcpServers: { old: { type: 'http', url: 'https://example.invalid/mcp' } } }))
  runtime = await createRuntime()
  let host = createConnectorAppHost({ getRuntime: () => runtime })
  hub.setConnectorAppLifecycle({ getInstallation: id => runtime.getInstallation(id) })
  await host.refresh()
  assert.equal(runtime.installations.list().length, 0)
  assert.equal(JSON.parse(await fs.readFile(path.join(legacyDir, 'connector.json'), 'utf8')).appId, undefined)
  assert.deepEqual(hub.getConnectorMcpServers(['legacy-fixture']), {})

  await fs.mkdir(path.join(payload, 'connector'), { recursive: true })
  const manifest = { schemaVersion: 2, id: appId, version: '1.0.0', displayName: 'Fixture CLI', category: 'development',
    hostApi: '^3.15.0', publisher: { id: 'moss', name: 'Moss' }, permissions: ['connector:use'], toolScope: 'session',
    navigation: { location: 'none' }, discovery: { group: 'online', authMethods: ['browser'] }, connectorApp: { id, capabilities: ['cli'] } }
  const json = (file, value) => fs.writeFile(path.join(payload, file), JSON.stringify(value))
  await json('connector/connector.json', { id, name: 'Fixture CLI', type: 'cli', hasCli: true, enabled: true, skillNames: [], credentialSchema: { fields: [{ key: 'token', label: 'Token', type: 'password', required: true }] } })
  await json('connector/token-schema.json', { fields: [{ key: 'token', label: 'Token', type: 'password', required: true }] })
  await json('connector/cli.json', { runtime: { type: 'node', version: '>=18' }, init: 'node fixture-cli.mjs init', auth: 'node fixture-cli.mjs auth', status: 'node fixture-cli.mjs status', statusMatch: 'ready' })
  await fs.writeFile(path.join(payload, 'connector/fixture-cli.mjs'), `import fs from 'node:fs'; const a=process.argv[2]; if(a==='init')fs.writeFileSync('local-state.txt','initialized'); if(a==='auth')fs.writeFileSync('auth-state.txt','synthetic'); if(a==='status'){if(fs.existsSync('auth-state.txt'))console.log('ready');else process.exitCode=1;}`)
  await fs.writeFile(path.join(payload, 'connector/obsolete.txt'), 'remove in update')
  const responses = new Map()
  async function release(version) {
    manifest.version = version
    await json('app.moss.json', manifest)
    const checksums = await writePackageChecksums(payload)
    const signature = { schemaVersion: 1, algorithm: 'ed25519', publisherId: 'moss', keyId: 'fixture' }
    await json('app-signature.json', { ...signature, signature: sign(null, createAppSignaturePayload(manifest, checksums, signature), privateKey).toString('base64') })
    const zip = new JSZip()
    async function add(dir, prefix = '') { for (const entry of await fs.readdir(dir, { withFileTypes: true })) { const name = prefix + entry.name; if (entry.isDirectory()) await add(path.join(dir, entry.name), name + '/'); else zip.file(name, await fs.readFile(path.join(dir, entry.name))) } }
    await add(payload)
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    const latest = { version, hostApi: manifest.hostApi, platforms: [`${process.platform}-${process.arch}`], permissions: manifest.permissions, artifact: {
      fileName: `${appId}-${version}.zip`, downloadUrl: 'https://example.invalid/app.zip', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), signed: true, publisherId: 'moss', keyId: 'fixture' } }
    const entry = { ...manifest, summary: 'Fixture service', keywords: [], categories: [], detailUrl: 'https://example.invalid/detail.json', latestVersion: version, latest }
    responses.set('https://example.invalid/index.json', Buffer.from(JSON.stringify({ schemaVersion: 1, catalogId: 'fixture', displayName: 'Fixture', generatedAt: new Date().toISOString(), apps: [entry] })))
    responses.set(entry.detailUrl, Buffer.from(JSON.stringify({ ...entry, schemaVersion: 1, versions: [latest] })))
    responses.set(latest.artifact.downloadUrl, bytes)
  }
  const market = createAppMarketplaceService({ indexUrl: 'https://example.invalid/index.json', cachePath: path.join(root, 'catalog.json'), trustedPublishers,
    getRuntime: () => runtime, getInstalledApps: () => platform.listAppsFromRegistry(), getInstallationRevision: platform.getAppInstallationRevision,
    download: async url => responses.get(url), confirmInstallation: async () => confirm,
    installPackage: (dir, options) => platform.publishAppFromBuild(dir, { ...options, activateInstallation: async app => {
      await runtime.registerInstalled(app.id, app.currentVersion)
      await host.refresh(app.id)
      if (failActivation) { failActivation = false; throw new Error('injected activation failure') }
    } }),
    emitChanged: ({ appId }) => host.refresh(appId),
    rollbackPackage: ({ appId, previousVersion }) => previousVersion ? platform.rollbackAppToVersion(appId, previousVersion) : platform.deleteApp(appId),
  })
  await release('1.0.0')
  assert.equal((await market.list()).apps.length, 1)
  assert.equal(runtime.installations.list().length, 0)
  confirm = false
  assert.equal((await market.install({ appId })).canceled, true)
  assert.equal(runtime.getInstallation(appId), null)
  confirm = true
  assert.equal((await market.install({ appId })).ok, true)
  assert(runtime.getInstallation(appId).grants.includes('connector:use'))
  await hub.saveConnectorCredentials(id, { token: 'synthetic-test-credential' })
  assert.equal((await hub.setupConnectorCli(id)).connected, true)
  await runtime.setAppEnabled(appId, false)
  await assert.rejects(hub.setupConnectorCli(id), /启用并授权/)
  await runtime.setAppEnabled(appId, true)
  await runtime.setAppGrants(appId, [])
  await assert.rejects(hub.saveConnectorCredentials(id, { token: 'x' }), /启用并授权/)
  await runtime.setAppGrants(appId, ['connector:use'])
  await release('1.1.0'); await market.list({ forceRefresh: true })
  failActivation = true
  await assert.rejects(market.install({ appId }), /injected activation failure/)
  assert.equal(runtime.getInstallation(appId).activeVersion, '1.0.0')
  await fs.rm(path.join(payload, 'connector/obsolete.txt'))
  await release('1.2.0'); await market.list({ forceRefresh: true })
  await market.install({ appId })
  const dir = path.join(process.env.MOSS_HOME, 'connectors/installed', id)
  assert.equal(await fs.stat(path.join(dir, 'obsolete.txt')).catch(() => null), null)
  assert.equal(await fs.readFile(path.join(dir, 'local-state.txt'), 'utf8'), 'initialized')
  let uninstalledAppId
  hub.setConnectorAppLifecycle({
    getInstallation: id => runtime.getInstallation(id),
    uninstall: async actualAppId => {
      uninstalledAppId = actualAppId
      await runtime.uninstall(actualAppId)
      await host.remove(actualAppId)
      await platform.deleteApp(actualAppId)
    },
  })
  await hub.uninstallConnector(id)
  assert.equal(uninstalledAppId, appId)
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'connector.json'), 'utf8')).enabled, false)
  await runtime.shutdown(); runtime = await createRuntime(); host = createConnectorAppHost({ getRuntime: () => runtime })
  await host.refresh()
  assert.equal(runtime.installations.list().length, 0)
  console.log(JSON.stringify({ ok: true, checks: ['no-legacy-migration', 'no-auto-install', 'signed-market-install', 'permission-cancel', 'real-local-cli-execution', 'disable', 'grant-revocation', 'activation-rollback', 'obsolete-package-cleanup', 'explicit-app-identity', 'uninstall-restart'] }))
} finally { await runtime?.shutdown(); hub.setConnectorAppLifecycle(null); await fs.rm(root, { recursive: true, force: true }) }
