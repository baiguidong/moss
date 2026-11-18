import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { downloadOfflineKit, verifyOfflineKit } from '../src/apps/offline-kit-download.mjs'

test('an offline signature binds the App, target, online digest and kit bytes', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const kit = {
    publisherId: 'moss',
    keyId: 'release-1',
    fileName: 'test.zip',
    appSha256: 'a'.repeat(64),
    sha256: 'b'.repeat(64),
    size: 12,
  }
  const identity = ['moss.example', '1.0.0', 'darwin-arm64']
  const payload = JSON.stringify([
    'moss.offline-kit/v1',
    ...identity,
    kit.publisherId,
    kit.keyId,
    kit.fileName,
    kit.appSha256,
    kit.sha256,
    kit.size,
  ])
  kit.signature = sign(null, Buffer.from(payload), privateKey).toString('base64')
  const publisher = { keys: { 'release-1': publicKey } }
  verifyOfflineKit(...identity, kit, publisher)
  assert.throws(() => verifyOfflineKit(identity[0], identity[1], 'linux-x64', kit, publisher), /签名/)
  assert.throws(() => verifyOfflineKit(...identity, { ...kit, appSha256: 'c'.repeat(64) }, publisher), /签名/)
})

test('a failed offline download preserves an existing ZIP and cleans the partial file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-kit-test-'))
  const server = createServer((_request, response) => response.end('different'))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const destination = path.join(root, 'kit.zip')
    await fs.writeFile(destination, 'previous')
    const kit = {
      downloadUrl: 'http://127.0.0.1:' + server.address().port,
      size: 9,
      sha256: createHash('sha256').update('expected!').digest('hex'),
    }
    await assert.rejects(
      downloadOfflineKit(kit, destination, { validateUrl: (url) => url, onProgress: () => {} }),
      /SHA-256/,
    )
    assert.equal(await fs.readFile(destination, 'utf8'), 'previous')
    assert.deepEqual(await fs.readdir(root), ['kit.zip'])
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})
