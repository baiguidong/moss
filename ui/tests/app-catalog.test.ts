import { afterEach, describe, expect, it } from 'bun:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  AppCatalog,
  AppRuntimeHost,
  DirectoryAppCatalogSource,
  createAppSignaturePayload,
  createPackageChecksums,
  validateAppPackage,
  writePackageChecksums,
} from '../../packages/app-runtime/src/index.mjs'

const roots: string[] = []
const fixtureRoot = [path.resolve('ui/tests/fixtures/apps'), path.resolve('tests/fixtures/apps')]
  .find((candidate) => fsSync.existsSync(candidate))!

afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

async function signedFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-catalog-'))
  roots.push(root)
  const packageRoot = path.join(root, 'catalog', 'fixture.ui-only', 'versions', '1.0.0')
  await fs.mkdir(path.dirname(packageRoot), { recursive: true })
  await fs.cp(path.join(fixtureRoot, 'ui-only'), packageRoot, { recursive: true })
  const manifestPath = path.join(packageRoot, 'app.moss.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  manifest.publisher = { id: 'moss.first-party', name: 'Moss' }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const checksums = await writePackageChecksums(packageRoot)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const metadata = { publisherId: 'moss.first-party', keyId: 'release-1' }
  const signature = sign(null, createAppSignaturePayload(manifest, checksums, metadata), privateKey).toString('base64')
  await fs.writeFile(path.join(packageRoot, 'app-signature.json'), `${JSON.stringify({
    schemaVersion: 1,
    algorithm: 'ed25519',
    ...metadata,
    signature,
  }, null, 2)}\n`)
  return { root, packageRoot, publicKey }
}

describe('App Catalog trust', () => {
  it('verifies signed packages and rejects a forged signature for a trusted publisher', async () => {
    const { packageRoot, publicKey } = await signedFixture()
    const trustedPublishers = { 'moss.first-party': { keys: { 'release-1': publicKey } } }
    expect((await validateAppPackage(packageRoot, { trustedPublishers, requireTrustedPublisher: true })).trust)
      .toMatchObject({ status: 'trusted', publisherId: 'moss.first-party', keyId: 'release-1' })
    const signaturePath = path.join(packageRoot, 'app-signature.json')
    const metadata = JSON.parse(await fs.readFile(signaturePath, 'utf8'))
    metadata.signature = Buffer.alloc(64, 7).toString('base64')
    await fs.writeFile(signaturePath, JSON.stringify(metadata))
    await expect(validateAppPackage(packageRoot, { trustedPublishers, requireTrustedPublisher: true }))
      .rejects.toThrow(/signature verification failed/)
  })

  it('discovers and installs a trusted package through a pluggable directory source', async () => {
    const { root, packageRoot, publicKey } = await signedFixture()
    const source = new DirectoryAppCatalogSource({
      id: 'first-party',
      rootDir: path.join(root, 'catalog'),
      trustedPublishers: { 'moss.first-party': { keys: { 'release-1': publicKey } } },
      requireTrustedPublisher: true,
    })
    const catalog = new AppCatalog({ sources: [source] })
    expect(await createPackageChecksums(packageRoot)).not.toHaveProperty('app-signature.json')
    expect(await catalog.list()).toEqual([
      expect.objectContaining({ sourceId: 'first-party', appId: 'fixture.ui-only', version: '1.0.0', trust: expect.objectContaining({ status: 'trusted' }) }),
    ])
    const runtime = await new AppRuntimeHost({
      rootDir: path.join(root, 'runtime'),
      trustedPublishers: { 'moss.first-party': { keys: { 'release-1': publicKey } } },
    }).initialize()
    await catalog.install(runtime, 'fixture.ui-only', '1.0.0')
    expect((await runtime.getApp('fixture.ui-only'))?.trust.status).toBe('trusted')
    await runtime.shutdown()
  })
})
