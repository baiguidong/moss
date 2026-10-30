import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import JSZip from 'jszip'
import { createBuiltinDownloader, selectBuiltinVersion, stageBuiltinArchive } from '../scripts/download-builtin-app.mjs'
import { prepareBuiltinApps } from '../scripts/prepare-builtin-apps.mjs'
import { attachSourcePackage } from '../../packages/app-runtime/src/packages/source.mjs'
import { createAppSignaturePayload, writePackageChecksums } from '../../packages/app-runtime/src/packages/index.mjs'

test('only the pinned version is selected; missing and incompatible releases fail without fallback', () => {
  const version = (value, hostApi = '^3.6.0', platforms = ['darwin-arm64']) => ({ version: value, hostApi, platforms, artifact: {} })
  const detail = { id: 'moss.buddy', versions: [version('1.0.0'), version('3.0.0-beta.1'), version('2.0.0', '^99.0.0'), version('1.2.0'), version('1.3.0', '^3.6.0', ['win32-x64'])] }
  assert.equal(selectBuiltinVersion(detail, 'darwin-arm64', '1.0.0', '3.22.0').version, '1.0.0')
  assert.equal(selectBuiltinVersion(detail, 'win32-x64', '1.3.0', '3.22.0').version, '1.3.0')
  assert.equal(selectBuiltinVersion(detail, 'linux-x64', '1.0.0', '3.22.0'), null)
  assert.throws(() => selectBuiltinVersion(detail, 'darwin-arm64', '2.0.0', '3.22.0'), /No compatible builtin/)
  assert.throws(() => selectBuiltinVersion(detail, 'darwin-arm64', '9.0.0'), /not published/)
  assert.throws(() => selectBuiltinVersion(detail, 'darwin-arm64', '^1.0.0'), /exact builtin App version/)
})

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-builtin-download-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const pkg = path.join(root, 'package'), source = path.join(root, 'source'), output = path.join(root, 'output')
  for (const dir of [pkg, source, output]) await fs.mkdir(dir)
  const manifest = { schemaVersion: 2, id: 'moss.buddy', version: '1.0.0', displayName: 'Buddy', hostApi: '^3.22.0', publisher: { id: 'moss', name: 'Moss' }, permissions: [], ui: { entry: 'index.html' }, navigation: { location: 'details' } }
  for (const dir of [pkg, source]) await fs.writeFile(path.join(dir, 'app.moss.json'), JSON.stringify(manifest))
  await fs.writeFile(path.join(pkg, 'index.html'), '<h1>Buddy</h1>')
  await fs.writeFile(path.join(source, 'index.html'), '<h1>Buddy</h1>')
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'buddy-test', packageManager: 'npm@10.9.0', scripts: { build: 'node build.mjs' } }))
  await fs.writeFile(path.join(source, 'build.mjs'), 'console.log("build")')
  await attachSourcePackage(pkg, source)
  const checksums = await writePackageChecksums(pkg)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const metadata = { schemaVersion: 1, algorithm: 'ed25519', publisherId: 'moss', keyId: 'test' }
  await fs.writeFile(path.join(pkg, 'app-signature.json'), JSON.stringify({ ...metadata, signature: sign(null, createAppSignaturePayload(manifest, checksums, metadata), privateKey).toString('base64') }))
  const zip = new JSZip()
  for (const name of await fs.readdir(pkg, { recursive: true })) if ((await fs.stat(path.join(pkg, name))).isFile()) zip.file(name.split(path.sep).join('/'), await fs.readFile(path.join(pkg, name)))
  const bytes = await zip.generateAsync({ type: 'nodebuffer' })
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const trustedPublishers = { moss: { test: publicKey.export({ type: 'spki', format: 'pem' }) } }
  const artifact = { fileName: 'moss.buddy-1.0.0.zip', downloadUrl: 'https://example.com/app.zip', sha256, size: bytes.length, signed: true, publisherId: 'moss', keyId: 'test' }
  const version = { version: '1.0.0', hostApi: manifest.hostApi, platforms: ['darwin-arm64'], permissions: [], artifact }
  const summary = { id: 'moss.buddy', displayName: 'Buddy', summary: 'Buddy guide', publisher: manifest.publisher, detailUrl: 'https://example.com/detail.json', latestVersion: version.version, latest: version }
  const detail = { schemaVersion: 1, ...summary, versions: [version] }
  const index = { schemaVersion: 1, catalogId: 'test', displayName: 'Test', generatedAt: new Date().toISOString(), apps: [summary] }
  return { output, bytes, sha256, trustedPublishers, index, detail }
}

test('marketplace download validates identity, rebuildable source and trusted signature and preserves archive bytes', async t => {
  const f = await fixture(t), requests = []
  const download = async url => {
    requests.push(url)
    const name = new URL(url).pathname
    return name === '/app.zip' ? f.bytes : Buffer.from(JSON.stringify(name === '/index.json' ? f.index : f.detail))
  }
  const fetch = createBuiltinDownloader({ download, indexUrl: 'https://example.com/index.json', trustedPublishers: f.trustedPublishers })
  const entry = await fetch('moss.buddy', f.output, 'darwin-arm64', '1.0.0')
  assert.equal(entry.version, '1.0.0')
  assert.equal(entry.sha256, f.sha256)
  assert.deepEqual(await fs.readFile(path.join(f.output, entry.archive)), f.bytes)
  assert.equal(requests.length, 3)
  assert.ok(new URL(requests[0]).searchParams.has('_moss_build'))
  assert.ok(new URL(requests[1]).searchParams.has('_moss_build'))
  assert.equal(await fetch('moss.buddy', f.output, 'linux-x64', '1.0.0'), null)
  f.detail.latestVersion = '2.0.0'
  f.detail.versions.push({ ...f.detail.versions[0], version: '2.0.0' })
  assert.equal((await fetch('moss.buddy', f.output, 'darwin-arm64', '1.0.0')).version, '1.0.0')
  await assert.rejects(fetch('moss.buddy', f.output, 'darwin-arm64', '9.0.0'), /not published/)
})

test('bundling downloads pinned signed packages without App sources and preserves prior output on failure', async t => {
  const f = await fixture(t)
  const selection = { apps: ['moss.buddy'], versions: { 'moss.buddy': '1.0.0' } }
  let corrupt = false
  const download = async url => {
    const name = new URL(url).pathname
    return name === '/app.zip' ? (corrupt ? Buffer.from('corrupt') : f.bytes)
      : Buffer.from(JSON.stringify(name.endsWith('/index.json') ? f.index : f.detail))
  }
  const options = { output: f.output, platform: 'darwin-arm64', selection, download, trustedPublishers: f.trustedPublishers }
  const entries = await prepareBuiltinApps(options)
  assert.equal(entries[0].version, '1.0.0')
  assert.deepEqual(await fs.readFile(path.join(f.output, entries[0].archive)), f.bytes)
  const before = await fs.readFile(path.join(f.output, 'manifest.json'), 'utf8')
  corrupt = true
  await assert.rejects(prepareBuiltinApps(options), /checksum/)
  assert.equal(await fs.readFile(path.join(f.output, 'manifest.json'), 'utf8'), before)
  await assert.rejects(prepareBuiltinApps({ ...options, selection: { apps: ['moss.buddy'] } }), /exact builtin App version/)
  corrupt = false
  assert.deepEqual(await prepareBuiltinApps({ ...options, platform: 'win32-x64' }), [])
  const manifest = JSON.parse(await fs.readFile(path.join(f.output, 'manifest.json'), 'utf8'))
  assert.equal(manifest.omitted[0].version, '1.0.0')
})

test('corrupt, mismatched and untrusted downloads are rejected without staging a package', async t => {
  const f = await fixture(t)
  const options = { bytes: f.bytes, directory: f.output, id: 'moss.buddy', version: '1.0.0', platform: 'darwin-arm64', sha256: f.sha256, size: f.bytes.length, trustedPublishers: f.trustedPublishers }
  await assert.rejects(stageBuiltinArchive({ ...options, bytes: Buffer.concat([f.bytes, Buffer.from('bad')]) }), /checksum/)
  await assert.rejects(stageBuiltinArchive({ ...options, id: 'moss.computer-use' }), /identity/)
  await assert.rejects(stageBuiltinArchive({ ...options, version: '2.0.0' }), /identity/)
  await assert.rejects(stageBuiltinArchive({ ...options, trustedPublishers: {} }), /not trusted/)
  assert.deepEqual(await fs.readdir(f.output), [])
})
