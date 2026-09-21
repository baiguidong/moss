import { afterEach, describe, expect, it } from 'bun:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { zipSync } from 'fflate'
import { createAppSignaturePayload, writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'
import { prepareBundledApps } from '../../scripts/bundled-apps.mjs'

const roots: string[] = []
const fixtureRoot = path.resolve('tests/fixtures/apps/ui-only')
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

async function signedArtifact(root: string) {
  const packageRoot = path.join(root, 'source')
  await fs.cp(fixtureRoot, packageRoot, { recursive: true })
  const manifestPath = path.join(packageRoot, 'app.moss.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  manifest.publisher = { id: 'moss', name: 'Moss' }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const checksums = await writePackageChecksums(packageRoot)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const metadata = { publisherId: 'moss', keyId: 'release-1' }
  await fs.writeFile(path.join(packageRoot, 'app-signature.json'), `${JSON.stringify({
    schemaVersion: 1,
    algorithm: 'ed25519',
    ...metadata,
    signature: sign(null, createAppSignaturePayload(manifest, checksums, metadata), privateKey).toString('base64'),
  }, null, 2)}\n`)
  const files: Record<string, Uint8Array> = {}
  async function visit(directory: string) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else files[path.relative(packageRoot, absolute).split(path.sep).join('/')] = new Uint8Array(await fs.readFile(absolute))
    }
  }
  await visit(packageRoot)
  return {
    manifest,
    archive: Buffer.from(zipSync(files)),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

describe('bundled App preparation', () => {
  it('verifies the pinned archive hash and publisher before materializing it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-bundled-apps-'))
    roots.push(root)
    const { manifest, archive, publicKey } = await signedArtifact(root)
    const artifactsRoot = path.join(root, 'artifacts')
    const artifactDir = path.join(artifactsRoot, manifest.id, manifest.version)
    await fs.mkdir(artifactDir, { recursive: true })
    await fs.writeFile(path.join(artifactDir, `${manifest.id}-${manifest.version}.zip`), archive)
    const { createHash } = await import('node:crypto')
    const lockPath = path.join(root, 'lock.json')
    await fs.writeFile(lockPath, JSON.stringify({
      schemaVersion: 1,
      apps: [{
        id: manifest.id,
        version: manifest.version,
        fileName: `${manifest.id}-${manifest.version}.zip`,
        url: `https://example.com/${manifest.id}-${manifest.version}.zip`,
        sha256: createHash('sha256').update(archive).digest('hex'),
        publisherId: 'moss',
        keyId: 'release-1',
      }],
    }))
    const resourceDir = path.join(root, 'trust')
    await fs.mkdir(path.join(resourceDir, 'publishers', 'moss'), { recursive: true })
    await fs.writeFile(path.join(resourceDir, 'trusted-publishers.json'), JSON.stringify({
      schemaVersion: 1,
      publishers: { moss: { keys: { 'release-1': 'publishers/moss/release-1.pem' } } },
    }))
    await fs.writeFile(path.join(resourceDir, 'publishers', 'moss', 'release-1.pem'), publicKey)

    const outputDir = path.join(root, 'output')
    await prepareBundledApps({ lockPath, outputDir, resourceDir, localArtifactsDir: artifactsRoot })
    expect(JSON.parse(await fs.readFile(path.join(outputDir, manifest.id, 'app.moss.json'), 'utf8'))).toMatchObject({
      id: manifest.id,
      version: manifest.version,
    })
    expect((await prepareBundledApps({ lockPath, outputDir, resourceDir, localArtifactsDir: artifactsRoot })).cached).toBe(true)

    await fs.writeFile(path.join(outputDir, manifest.id, 'app.moss.json'), '{}\n')
    expect((await prepareBundledApps({ lockPath, outputDir, resourceDir, localArtifactsDir: artifactsRoot })).cached).toBe(false)
    expect(JSON.parse(await fs.readFile(path.join(outputDir, manifest.id, 'app.moss.json'), 'utf8'))).toMatchObject({
      id: manifest.id,
      version: manifest.version,
    })
  })
})
