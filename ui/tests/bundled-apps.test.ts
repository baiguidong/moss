import { afterEach, describe, expect, it } from 'bun:test'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
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
  it('resolves release metadata for the pinned version before materializing it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-bundled-apps-'))
    roots.push(root)
    const { manifest, archive, publicKey } = await signedArtifact(root)
    const artifactsRoot = path.join(root, 'artifacts')
    const artifactDir = path.join(artifactsRoot, manifest.id, manifest.version)
    await fs.mkdir(artifactDir, { recursive: true })
    await fs.writeFile(path.join(artifactDir, `${manifest.id}-${manifest.version}.zip`), archive)
    const lockPath = path.join(root, 'lock.json')
    await fs.writeFile(lockPath, JSON.stringify({
      schemaVersion: 1,
      apps: [{
        id: manifest.id,
        version: manifest.version,
      }],
    }))
    const resourceDir = path.join(root, 'trust')
    await fs.mkdir(path.join(resourceDir, 'publishers', 'moss'), { recursive: true })
    await fs.writeFile(path.join(resourceDir, 'trusted-publishers.json'), JSON.stringify({
      schemaVersion: 1,
      publishers: { moss: { keys: { 'release-1': 'publishers/moss/release-1.pem' } } },
    }))
    await fs.writeFile(path.join(resourceDir, 'publishers', 'moss', 'release-1.pem'), publicKey)
    const indexUrl = 'https://example.com/v1/index.json'
    const detailUrl = `https://example.com/v1/apps/${manifest.id}.json`
    const artifactUrl = `https://example.com/releases/${manifest.id}-${manifest.version}.zip`
    await fs.writeFile(path.join(resourceDir, 'catalog.json'), JSON.stringify({
      schemaVersion: 1,
      indexUrl,
    }))
    const responses = new Map([
      [indexUrl, {
        schemaVersion: 1,
        apps: [{ id: manifest.id, detailUrl }],
      }],
      [detailUrl, {
        schemaVersion: 1,
        id: manifest.id,
        publisher: { id: 'moss', name: 'Moss' },
        versions: [{
          version: manifest.version,
          artifact: {
            fileName: `${manifest.id}-${manifest.version}.zip`,
            downloadUrl: artifactUrl,
            sha256: createHash('sha256').update(archive).digest('hex'),
            size: archive.length,
            signed: true,
            publisherId: 'moss',
            keyId: 'release-1',
          },
        }],
      }],
    ])
    const downloaded: string[] = []
    const download = async (url: string) => {
      downloaded.push(url)
      const response = responses.get(url)
      if (!response) throw new Error(`Unexpected URL: ${url}`)
      return Buffer.from(JSON.stringify(response))
    }

    const outputDir = path.join(root, 'output')
    await prepareBundledApps({ lockPath, outputDir, resourceDir, localArtifactsDir: artifactsRoot, download })
    expect(downloaded).toEqual([indexUrl, detailUrl])
    expect(JSON.parse(await fs.readFile(path.join(outputDir, manifest.id, 'app.moss.json'), 'utf8'))).toMatchObject({
      id: manifest.id,
      version: manifest.version,
    })
    expect((await prepareBundledApps({ lockPath, outputDir, resourceDir, localArtifactsDir: artifactsRoot, download })).cached).toBe(true)
    expect(downloaded).toEqual([indexUrl, detailUrl, indexUrl, detailUrl])

    await fs.writeFile(path.join(outputDir, manifest.id, 'app.moss.json'), '{}\n')
    expect((await prepareBundledApps({ lockPath, outputDir, resourceDir, localArtifactsDir: artifactsRoot, download })).cached).toBe(false)
    expect(JSON.parse(await fs.readFile(path.join(outputDir, manifest.id, 'app.moss.json'), 'utf8'))).toMatchObject({
      id: manifest.id,
      version: manifest.version,
    })
  })

  it('fails when the pinned version is absent from the published App details', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-bundled-apps-missing-'))
    roots.push(root)
    const lockPath = path.join(root, 'lock.json')
    const resourceDir = path.join(root, 'resources')
    const indexUrl = 'https://example.com/v1/index.json'
    const detailUrl = 'https://example.com/v1/apps/example.app.json'
    await fs.mkdir(path.join(resourceDir, 'publishers', 'moss'), { recursive: true })
    await fs.writeFile(lockPath, JSON.stringify({
      schemaVersion: 1,
      apps: [{ id: 'example.app', version: '9.9.9' }],
    }))
    await fs.writeFile(path.join(resourceDir, 'catalog.json'), JSON.stringify({ schemaVersion: 1, indexUrl }))
    await fs.writeFile(path.join(resourceDir, 'trusted-publishers.json'), JSON.stringify({
      schemaVersion: 1,
      publishers: { moss: { keys: { 'release-1': 'publishers/moss/release-1.pem' } } },
    }))
    await fs.writeFile(path.join(resourceDir, 'publishers', 'moss', 'release-1.pem'), 'unused')
    const responses = new Map([
      [indexUrl, { schemaVersion: 1, apps: [{ id: 'example.app', detailUrl }] }],
      [detailUrl, { schemaVersion: 1, id: 'example.app', versions: [] }],
    ])

    await expect(prepareBundledApps({
      lockPath,
      outputDir: path.join(root, 'output'),
      resourceDir,
      download: async (url: string) => Buffer.from(JSON.stringify(responses.get(url))),
    })).rejects.toThrow('Bundled App version is not published: example.app@9.9.9')
  })
})
