import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  AppPackageStore,
  DeploymentStore,
  JsonAppStateStore,
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
})
