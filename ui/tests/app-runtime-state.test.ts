import { afterEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  AppPackageStore,
  AppRuntimeHost,
  DeploymentStore,
  InstallationStore,
  InstanceStore,
  JsonAppStateStore,
  normalizeAppOwner,
  validateAppPackage,
  writePackageChecksums,
} from '../../packages/app-runtime/src/index.mjs'

const temporaryRoots: string[] = []
const fixtureRoot = [path.resolve('ui/tests/fixtures/apps'), path.resolve('tests/fixtures/apps')]
  .find((candidate) => fsSync.existsSync(candidate))!
async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-runtime-'))
  temporaryRoots.push(root)
  return root
}
afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

describe('App package and state stores', () => {
  it('installs an immutable validated package atomically and rejects tampering', async () => {
    const root = await tempRoot()
    const source = path.join(root, 'source')
    await fs.cp(path.join(fixtureRoot, 'ui-only'), source, { recursive: true })
    await writePackageChecksums(source)
    const store = new AppPackageStore({ appsDir: path.join(root, 'apps') })
    const installed = await store.installFromDirectory(source)
    expect(installed.manifest.id).toBe('fixture.ui-only')
    await fs.writeFile(path.join(source, 'dist/ui/index.html'), 'tampered')
    await expect(store.installFromDirectory(source)).rejects.toThrow(/Checksum mismatch/)
  })

  it('coalesces concurrent installs of the same immutable version', async () => {
    const root = await tempRoot()
    const source = path.join(root, 'source')
    await fs.cp(path.join(fixtureRoot, 'ui-only'), source, { recursive: true })
    await writePackageChecksums(source)
    const store = new AppPackageStore({ appsDir: path.join(root, 'apps') })
    const results = await Promise.all(Array.from({ length: 4 }, () => store.installFromDirectory(source)))
    expect(results.filter((item) => item.installed)).toHaveLength(1)
    expect(results.every((item) => item.manifest.id === 'fixture.ui-only')).toBe(true)
  })

  it('rejects symbolic links and package limits before exposing a version', async () => {
    const root = await tempRoot()
    const source = path.join(root, 'source')
    await fs.cp(path.join(fixtureRoot, 'ui-only'), source, { recursive: true })
    await writePackageChecksums(source)
    await fs.symlink(path.join(root, 'outside'), path.join(source, 'unsafe-link'))
    const store = new AppPackageStore({ appsDir: path.join(root, 'apps') })
    await expect(store.installFromDirectory(source)).rejects.toThrow(/Symbolic links are not allowed/)
    await expect(fs.stat(store.versionRoot('fixture.ui-only', '1.0.0'))).rejects.toMatchObject({ code: 'ENOENT' })

    await fs.rm(path.join(source, 'unsafe-link'))
    await writePackageChecksums(source)
    await expect(validateAppPackage(source, { limits: { maxFileBytes: 1 } })).rejects.toThrow(/too large/)

    const linkedRoot = path.join(root, 'linked-root')
    await fs.symlink(source, linkedRoot)
    await expect(store.installFromDirectory(linkedRoot)).rejects.toThrow(/real directory/)
  })

  it('does not leave a partial destination when a new version is invalid', async () => {
    const root = await tempRoot()
    const source = path.join(root, 'source')
    await fs.cp(path.join(fixtureRoot, 'ui-only'), source, { recursive: true })
    const manifestPath = path.join(source, 'app.moss.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    manifest.version = '2.0.0'
    manifest.ui.entry = 'dist/ui/missing.html'
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await writePackageChecksums(source)
    const store = new AppPackageStore({ appsDir: path.join(root, 'apps') })
    await expect(store.installFromDirectory(source)).rejects.toThrow(/does not exist/)
    await expect(fs.stat(store.versionRoot('fixture.ui-only', '2.0.0'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enforces package identity and version-store boundaries while allowing full SemVer', async () => {
    const root = await tempRoot()
    const source = path.join(root, 'source')
    await fs.cp(path.join(fixtureRoot, 'ui-only'), source, { recursive: true })
    const manifestPath = path.join(source, 'app.moss.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    manifest.version = '1.0.0-beta.1+build.7'
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await writePackageChecksums(source)
    const store = new AppPackageStore({ appsDir: path.join(root, 'apps') })
    await store.installFromDirectory(source)
    expect((await store.get(manifest.id, manifest.version)).manifest.version).toBe(manifest.version)
    await expect(store.get(manifest.id, '../../../other.app/versions/1.0.0')).rejects.toThrow(/Invalid App package version/)

    const mismatched = store.versionRoot('other.app', manifest.version)
    await fs.mkdir(path.dirname(mismatched), { recursive: true })
    await fs.cp(source, mismatched, { recursive: true })
    await expect(store.get('other.app', manifest.version)).rejects.toThrow(/identity mismatch/)
  })

  it('applies caller package limits during atomic installation', async () => {
    const root = await tempRoot()
    const source = path.join(root, 'source')
    await fs.cp(path.join(fixtureRoot, 'ui-only'), source, { recursive: true })
    await writePackageChecksums(source)
    const store = new AppPackageStore({ appsDir: path.join(root, 'apps') })
    await expect(store.installFromDirectory(source, { limits: { maxFileBytes: 1 } })).rejects.toThrow(/too large/)
    await expect(fs.stat(store.versionRoot('fixture.ui-only', '1.0.0'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('requires generic configuration and secret schemas to use supported object shapes', async () => {
    const root = await tempRoot()
    const source = path.join(root, 'source')
    await fs.cp(path.join(fixtureRoot, 'persistent-multiple'), source, { recursive: true })
    await fs.writeFile(path.join(source, 'schemas/secrets.schema.json'), JSON.stringify({
      type: 'object', properties: { token: { type: 'object' } },
    }))
    await writePackageChecksums(source)
    const store = new AppPackageStore({ appsDir: path.join(root, 'apps') })
    await expect(store.installFromDirectory(source)).rejects.toThrow(/must be a string secret/)

    await fs.writeFile(path.join(source, 'schemas/secrets.schema.json'), JSON.stringify({
      type: 'object', properties: { token: { type: 'string' } },
    }))
    await fs.writeFile(path.join(source, 'schemas/config.schema.json'), JSON.stringify({ type: 'array', items: { type: 'string' } }))
    await writePackageChecksums(source)
    await expect(store.installFromDirectory(source)).rejects.toThrow(/must describe an object/)
  })

  it('requires App Tool input schemas to describe objects', async () => {
    const root = await tempRoot()
    const source = path.join(root, 'source')
    await fs.cp(path.join(fixtureRoot, 'persistent-multiple'), source, { recursive: true })
    const manifestPath = path.join(source, 'app.moss.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    manifest.backend.actions[0].inputSchema = 'schemas/tool-input.schema.json'
    manifest.contributes = {
      tools: [{
        id: 'echo',
        title: 'Echo',
        description: 'Echo a value.',
        action: 'echo',
        inputSchema: 'schemas/tool-input.schema.json',
        effect: 'read',
      }],
    }
    await fs.writeFile(
      path.join(source, 'schemas/tool-input.schema.json'),
      JSON.stringify({ type: 'array', items: { type: 'string' } }),
    )
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await writePackageChecksums(source)

    await expect(validateAppPackage(source)).rejects.toThrow(
      /tool echo inputSchema must describe an object/,
    )
  })

  it('fences an active Server lease and permits takeover after expiry', async () => {
    const root = await tempRoot()
    const state = await new JsonAppStateStore(path.join(root, 'state.json')).initialize()
    const deployments = new DeploymentStore(state)
    const deployment = await deployments.upsert({
      appId: 'example.app', instanceId: 'instance-1', targetType: 'server', targetId: 'cluster', generation: 1,
    })
    expect((await deployments.acquireLease(deployment.key, 'node-a', 1000, 100))?.leaseOwner).toBe('node-a')
    expect(await deployments.acquireLease(deployment.key, 'node-b', 1000, 500)).toBeNull()
    const takeover = await deployments.acquireLease(deployment.key, 'node-b', 1000, 1200)
    expect(takeover?.leaseOwner).toBe('node-b')
    expect(takeover?.generation).toBe(2)
    await deployments.releaseLease(deployment.key, 'node-b')
    const released = deployments.get(deployment.key)
    expect(released?.leaseOwner).toBeNull()
    expect(released?.generation).toBe(3)
    const gracefulTakeover = await deployments.acquireLease(deployment.key, 'node-c', 1000, 1300)
    expect(gracefulTakeover?.generation).toBe(3)
  })

  it('isolates identical App and instance ids by owner', async () => {
    const root = await tempRoot()
    const state = await new JsonAppStateStore(path.join(root, 'state.json')).initialize()
    const owners: { current: ReturnType<typeof normalizeAppOwner> } = {
      current: normalizeAppOwner({ scope: 'user', orgId: 'org-1', userId: 'user-a' }),
    }
    const options = { ownerResolver: () => owners.current }
    const installations = new InstallationStore(state, options)
    const instances = new InstanceStore(state, options)
    const deployments = new DeploymentStore(state, options)
    await installations.upsert('example.app', { activeVersion: '1.0.0', grants: ['example:read'] })
    const firstInstance = await instances.create('example.app', {}, { single: true })
    const firstDeployment = await deployments.upsert({
      appId: 'example.app', instanceId: firstInstance.id, targetType: 'server', targetId: 'cluster',
    })

    owners.current = normalizeAppOwner({ scope: 'user', orgId: 'org-1', userId: 'user-b' })
    expect(installations.get('example.app')).toBeNull()
    expect(instances.get(firstInstance.id)).toBeNull()
    expect(deployments.get(firstDeployment.key)).toBeNull()
    await installations.upsert('example.app', { activeVersion: '2.0.0', grants: [] })
    const secondInstance = await instances.create('example.app', {}, { single: true })
    const secondDeployment = await deployments.upsert({
      appId: 'example.app', instanceId: secondInstance.id, targetType: 'server', targetId: 'cluster',
    })
    expect(secondDeployment.key).not.toBe(firstDeployment.key)
    expect(installations.get('example.app')?.activeVersion).toBe('2.0.0')

    owners.current = normalizeAppOwner({ scope: 'user', orgId: 'org-1', userId: 'user-a' })
    expect(installations.get('example.app')?.activeVersion).toBe('1.0.0')
    expect(deployments.get(firstDeployment.key)?.owner.userId).toBe('user-a')
  })

  it('releases Server deployment leases for every App owner on shutdown', async () => {
    const root = await tempRoot()
    const runtime = await new AppRuntimeHost({
      rootDir: root,
      target: 'server',
      hostId: 'server-owner-test',
      leaseTtlMs: 60_000,
    }).initialize()
    const owners = [
      normalizeAppOwner({ scope: 'user', orgId: 'org-1', userId: 'user-a' }),
      normalizeAppOwner({ scope: 'user', orgId: 'org-1', userId: 'user-b' }),
    ]
    for (const owner of owners) {
      await runtime.withOwner(owner, async () => {
        await runtime.installations.upsert('example.app', { activeVersion: '1.0.0' })
        const instance = await runtime.instances.create('example.app', {}, { single: true })
        const deployment = await runtime.deployments.upsert({
          appId: 'example.app',
          instanceId: instance.id,
          targetType: 'server',
          targetId: 'server-default',
        })
        await runtime.deployments.acquireLease(deployment.key, runtime.hostId, 60_000)
      })
    }

    await runtime.shutdown()

    for (const owner of owners) {
      const deployment = runtime.withOwner(owner, () => runtime.deployments.list()[0])
      expect(deployment.leaseOwner).toBeNull()
      expect(deployment.leaseExpiresAt).toBeNull()
    }
  })

  it('migrates legacy SQLite App state into the host owner without data loss', async () => {
    const root = await tempRoot()
    const databasePath = path.join(root, 'legacy.sqlite')
    const stateModuleUrl = new URL('../../packages/app-runtime/src/state/index.mjs', import.meta.url).href
    const script = `
      import assert from 'node:assert/strict';
      import { DatabaseSync } from 'node:sqlite';
      import { SqliteAppStateStore, InstallationStore, InstanceStore, DeploymentStore } from ${JSON.stringify(stateModuleUrl)};
      const databasePath = ${JSON.stringify(databasePath)};
      const legacy = new DatabaseSync(databasePath);
      legacy.exec(\`
      CREATE TABLE app_installations (
        app_id TEXT PRIMARY KEY, active_version TEXT, enabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE app_instances (
        id TEXT PRIMARY KEY, app_id TEXT NOT NULL, display_name TEXT NOT NULL,
        config_json TEXT NOT NULL, secret_refs_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE app_deployments (
        deployment_key TEXT PRIMARY KEY, app_id TEXT NOT NULL, instance_id TEXT NOT NULL,
        target_type TEXT NOT NULL, target_id TEXT NOT NULL, desired_state TEXT NOT NULL,
        generation INTEGER NOT NULL, lease_owner TEXT, lease_expires_at INTEGER, updated_at INTEGER NOT NULL
      );
      INSERT INTO app_installations VALUES ('example.app', '1.0.0', 1, 1, 1);
      INSERT INTO app_instances VALUES ('example.app--default', 'example.app', 'Default', '{}', '{}', 1, 1, 1);
      INSERT INTO app_deployments VALUES ('example.app--default@server:cluster', 'example.app', 'example.app--default', 'server', 'cluster', 'running', 2, NULL, NULL, 1);
      \`);
      legacy.close();
      const state = await new SqliteAppStateStore(databasePath).initialize();
      const installations = new InstallationStore(state);
      const instances = new InstanceStore(state);
      const deployments = new DeploymentStore(state);
      assert.deepEqual(installations.get('example.app').owner, { scope: 'host', orgId: null, userId: null, key: 'host' });
      assert.equal(installations.get('example.app').activeVersion, '1.0.0');
      assert.deepEqual(installations.get('example.app').grants, []);
      assert.equal(instances.get('example.app--default').owner.scope, 'host');
      assert.equal(deployments.list('example.app')[0].generation, 2);
      state.close();
    `
    const nodeExecutable = execFileSync('which', ['node'], { encoding: 'utf8' }).trim()
    expect(() => execFileSync(nodeExecutable, ['--no-warnings', '--input-type=module', '-e', script], { stdio: 'pipe' })).not.toThrow()
  })

  it('keeps a shared package while another owner still has it installed', async () => {
    const root = await tempRoot()
    const source = path.join(root, 'source')
    await fs.cp(path.join(fixtureRoot, 'ui-only'), source, { recursive: true })
    await writePackageChecksums(source)
    const runtime = await new AppRuntimeHost({ rootDir: root, target: 'server', hostId: 'server-test' }).initialize()
    const ownerA = normalizeAppOwner({ scope: 'user', orgId: 'org-1', userId: 'user-a' })
    const ownerB = normalizeAppOwner({ scope: 'user', orgId: 'org-1', userId: 'user-b' })
    await runtime.withOwner(ownerA, () => runtime.installFromDirectory(source))
    await runtime.withOwner(ownerB, () => runtime.installFromDirectory(source))
    expect(await runtime.withOwner(ownerA, () => runtime.listApps())).toHaveLength(1)
    expect(await runtime.withOwner(ownerB, () => runtime.listApps())).toHaveLength(1)
    await runtime.withOwner(ownerA, () => runtime.uninstall('fixture.ui-only'))
    expect(await runtime.withOwner(ownerA, () => runtime.listApps())).toHaveLength(0)
    expect((await runtime.withOwner(ownerB, () => runtime.getApp('fixture.ui-only')))?.manifest.id).toBe('fixture.ui-only')
    await runtime.shutdown()
  })
})
