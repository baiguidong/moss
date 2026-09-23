#!/usr/bin/env node
// Exercise a disposable deploy/server installation through its HTTPS gateway.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, open, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { Agent, setGlobalDispatcher } from 'undici'
import { CloudStorageHost } from '../../ui/src/apps/cloud-storage.mjs'

const home = resolve(process.env.MOSS_DEPLOY_TEST_HOME || process.argv[2] || '')
if (!process.env.MOSS_DEPLOY_TEST_HOME && !process.argv[2]) throw new Error('Pass a disposable deployment directory')
const env = Object.fromEntries(readFileSync(join(home, '.env'), 'utf8').split('\n').filter(s => s && !s.startsWith('#')).map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]))
const base = `https://127.0.0.1:${env.MOSS_HTTPS_PORT}`
const prefix = '/api/v1/cloud-storage'
const hostOnly = process.env.MOSS_DEPLOY_TEST_MODE === 'host-only'
const verifyBackup = process.argv.includes('--backup')
const verifyRebuild = process.argv.includes('--rebuild')
const dispatcher = process.versions.electron ? null : new Agent({ connect: { ca: readFileSync(join(home, 'tls/server.crt')) } })
if (dispatcher) setGlobalDispatcher(dispatcher)
const report = { at: new Date().toISOString(), base, electron: process.versions.electron || null, checks: [] }
const passed = (message, data) => { report.checks.push({ message, ...data }); console.log(`PASS ${message}`) }
let token, userId, host
const files = [], folders = [], uploads = []
const temporary = await mkdtemp(join(tmpdir(), 'moss-deploy-verification-'))

async function request(path, { method = 'GET', body, auth = token, status = 200, headers = {} } = {}) {
  const binary = Buffer.isBuffer(body)
  const res = await fetch(`${base}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(15 * 60000),
    headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(body !== undefined && !binary ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
  })
  if (res.status !== status) throw new Error(`${method} ${path}: expected ${status}, got ${res.status}: ${await res.text()}`)
  return res
}
const json = async (path, options) => (await request(path, options)).json()
const cloud = (suffix, options) => json(`${prefix}${suffix}`, options)
const login = async (username, password) => (await json('/api/v1/auth/token', { method: 'POST', auth: null, body: { grant_type: 'password', username, password } })).access_token
async function waitReady() {
  for (let n = 0; n < 90; n++) {
    try {
      await request('/readyz')
      if ((await cloud('/status')).state === 'ready') return
    } catch {}
    await delay(1000)
  }
  throw new Error('Deployment did not become ready')
}
function compose(...args) {
  return execFileSync('docker', ['compose', '--project-directory', home, '--env-file', join(home, '.env'), '-f', join(home, 'compose.yaml'), '--profile', 'cloud', ...args], { encoding: 'utf8', timeout: 120000 })
}
function partData(number, size) {
  const data = Buffer.alloc(size, number % 251)
  if (size >= 4) data.writeUInt32LE(number, 0)
  return data
}
async function hashResponse(response) {
  const hash = createHash('sha256'); let size = 0
  for await (const bytes of response.body) { hash.update(bytes); size += bytes.length }
  return { sha256: hash.digest('hex'), size }
}
async function hashFile(filename) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(filename)) hash.update(bytes)
  return hash.digest('hex')
}

try {
  token = await login(env.MOSS_ADMIN_USERNAME, env.MOSS_ADMIN_PASSWORD)
  await waitReady()
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  passed('HTTPS authentication, MySQL readiness and private S3 readiness')
  if (!hostOnly) {
    const tag = randomUUID(), password = randomBytes(24).toString('hex'), email = `cloud-test-${tag}@example.invalid`
    const user = await json('/api/v1/users', { method: 'POST', body: { email, name: 'Cloud deployment verification', role: 'user', password } })
    userId = user.user.id
    const other = (await json('/api/v1/auth/token', { method: 'POST', auth: null, body: { grant_type: 'password', email, password } })).access_token
    const folder = await cloud('/folders', { method: 'POST', body: { name: `deployment-test-${tag}` }, status: 201 })
    folders.push(folder.id)
    await cloud(`/files/${folder.id}`, { auth: other, status: 404 })
    await cloud('/folders', { method: 'POST', body: { name: 'denied', parentId: folder.id }, auth: other, status: 404 })
    const baseline = await cloud('/quota')
    const size = Number(process.env.MOSS_DEPLOY_TEST_BYTES || 2 * 1024 ** 3 + 101)
    assert.ok(Number.isSafeInteger(size) && size >= 32 * 1024 ** 2)
    const input = { name: 'multipart.bin', parentId: folder.id, size, requestKey: randomUUID() }
    const upload = await cloud('/uploads', { method: 'POST', body: input }); uploads.push(upload.id)
    assert.equal((await cloud('/uploads', { method: 'POST', body: input })).id, upload.id)
    assert.equal((await cloud(`/uploads?requestKey=${input.requestKey}`)).id, upload.id)
    await cloud(`/uploads/${upload.id}`, { auth: other, status: 404 })
    await cloud(`/uploads?requestKey=${input.requestKey}`, { auth: other, status: 404 })
    assert.equal((await cloud('/quota')).reservedBytes, baseline.reservedBytes + size)
    passed('Per-user ownership, idempotent initialization and quota reservation')
    const count = Math.ceil(size / upload.partSize), expected = createHash('sha256')
    for (let number = 1; number <= count; number++) expected.update(partData(number, Math.min(upload.partSize, size - (number - 1) * upload.partSize)))
    const sha256 = expected.digest('hex')
    let next = 1, done = 0
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (next <= count) {
        const number = next++
        await cloud(`/uploads/${upload.id}/parts/${number}`, { method: 'PUT', body: partData(number, Math.min(upload.partSize, size - (number - 1) * upload.partSize)) })
        done++
        if (done % 16 === 0 || done === count) console.log(`Uploaded ${done}/${count} parts`)
      }
    }))
    const file = await cloud(`/uploads/${upload.id}/complete`, { method: 'POST' }); files.push(file.id)
    assert.equal((await cloud(`/uploads/${upload.id}/complete`, { method: 'POST' })).id, file.id)
    assert.equal((await cloud('/quota')).usedBytes, baseline.usedBytes + size)
    assert.equal((await cloud('/quota')).reservedBytes, baseline.reservedBytes)
    await cloud(`/files/${file.id}`, { auth: other, status: 404 })
    await cloud(`/files/${file.id}`, { method: 'DELETE', auth: other, status: 404 })
    await request(`${prefix}/files/${file.id}/content`, { auth: other, status: 404 })
    const head = await request(`${prefix}/files/${file.id}/content`, { method: 'HEAD' })
    assert.equal(Number(head.headers.get('content-length')), size)
    const ranged = await request(`${prefix}/files/${file.id}/content`, { status: 206, headers: { range: 'bytes=0-1023', 'if-match': `"${file.revision}"` } })
    assert.equal(ranged.headers.get('content-range'), `bytes 0-1023/${size}`)
    assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), partData(1, 1024))
    await request(`${prefix}/files/${file.id}/content`, { status: 416, headers: { range: `bytes=${size}-` } })
    await request(`${prefix}/files/${file.id}/content`, { status: 412, headers: { 'if-match': '"obsolete"' } })
    const downloaded = await hashResponse(await request(`${prefix}/files/${file.id}/content`))
    assert.deepEqual(downloaded, { size, sha256 })
    passed('Multipart upload, download SHA-256, HEAD, Range, revision and cross-user denial', downloaded)
    const renamed = await cloud(`/files/${file.id}`, { method: 'PATCH', body: { name: 'renamed.bin' } })
    assert.equal(renamed.revision, file.revision)
    assert.ok((await cloud(`/files?parentId=${folder.id}`)).files.some(v => v.id === file.id && v.name === 'renamed.bin'))
    await cloud(`/files/${folder.id}`, { method: 'DELETE', status: 409 })
    if (process.argv.includes('--restart')) {
      console.log('Restarting this deployment to verify durable metadata and objects')
      compose('stop', 'server')
      compose('restart', 'mysql', 'silo')
      compose('up', '-d', '--wait', 'server', 'nginx')
      await waitReady()
      assert.equal((await cloud(`/files/${file.id}`)).name, 'renamed.bin')
      assert.deepEqual(await hashResponse(await request(`${prefix}/files/${file.id}/content`)), downloaded)
      passed('MySQL, Silo and Server restart persistence with the same content checksum')
    }
    await cloud(`/files/${file.id}`, { method: 'DELETE' }); files.splice(files.indexOf(file.id), 1)
    assert.equal((await cloud('/quota')).usedBytes, baseline.usedBytes)
    passed('Rename, nonempty-directory protection, deletion and quota release')
  }

  // The same Host exercise can run under Electron's net.fetch via cloud-electron.cjs.
  const source = join(temporary, 'source.bin'), destination = join(temporary, 'download.bin')
  const fd = await open(source, 'w')
  try { await fd.truncate(35 * 1024 ** 2 + 101); await fd.write(Buffer.from('moss-deployment-check'), 0, 21, 35 * 1024 ** 2) }
  finally { await fd.close() }
  const settings = { remoteEnabled: false, remoteDirect: { serverUrl: base, credentialMode: 'api-key', apiKey: 'test-binding' } }
  let hold = true, progress = 0, networkCalls = 0
  const parts = []
  const options = {
    directory: join(temporary, 'transfers'), getSettings: () => settings,
    resolveConnection: async () => ({ serverUrl: base, userId: claims.sub, orgId: claims.org_id, authToken: token }),
    fetchImpl: async (url, init) => {
      networkCalls++
      const match = /\/parts\/(\d+)$/.exec(String(url))
      if (match) { if (hold && +match[1] > 1) await delay(60000, undefined, { signal: init.signal }); parts.push(+match[1]) }
      return fetch(url, init)
    },
    pickFiles: async () => [source], pickDestination: async () => destination,
    authorizeApp: async () => true, publish: (_ctx, event) => { if (event === 'transfers.progress') progress++ },
  }
  host = new CloudStorageHost(options)
  const context = { appId: 'com.moss.deployment-test', instanceId: 'default' }
  assert.equal((await host.handle('status.get', {}, context)).state, 'remote_disabled')
  assert.equal(networkCalls, 0)
  settings.remoteEnabled = true
  const picked = await host.handle('local-files.pick', {}, context)
  const task = await host.handle('uploads.start', { handle: picked.files[0].handle, name: `host-${randomUUID()}.bin` }, context)
  let confirmed = false
  for (let n = 0; n < 600; n++) {
    const t = host.tasks.get(task.transferId)
    if (t.uploadId && (await cloud(`/uploads/${t.uploadId}`)).parts.length) { confirmed = true; break }
    if (t.state === 'paused') throw new Error(`Host paused: ${t.error}`)
    await delay(100)
  }
  assert.ok(confirmed, 'First part was confirmed before interruption')
  uploads.push(host.tasks.get(task.transferId).uploadId)
  await host.handle('transfers.pause', { transferId: task.transferId }, context)
  await host.running.get(task.transferId)?.done
  const firstAttempts = parts.filter(n => n === 1).length
  await host.close(); hold = false
  host = new CloudStorageHost(options)
  assert.equal((await host.handle('transfers.get', { transferId: task.transferId }, context)).state, 'paused')
  await host.handle('transfers.resume', { transferId: task.transferId }, context)
  await host.running.get(task.transferId)?.done
  const uploaded = await host.handle('transfers.get', { transferId: task.transferId }, context)
  assert.equal(uploaded.state, 'completed', uploaded.error)
  files.push(uploaded.fileId)
  assert.equal(parts.filter(n => n === 1).length, firstAttempts)
  const download = await host.handle('downloads.start', { fileId: uploaded.fileId }, context)
  await host.running.get(download.transferId)?.done
  const finished = await host.handle('transfers.get', { transferId: download.transferId }, context)
  assert.equal(finished.state, 'completed', finished.error)
  assert.equal((await stat(destination)).size, (await stat(source)).size)
  assert.equal(await hashFile(source), await hashFile(destination))
  assert.ok(progress > 0)
  passed('Host remote-off gate, progress, pause/restart/resume without reuploading confirmed parts, download checksum', { bytes: finished.totalBytes, progressEvents: progress })

  if (verifyRebuild) {
    await host.close(); host = null
    const preservedFiles = ['.env', 'server.json', 'settings.json', 'credentials/.master.key']
    const originalHashes = await Promise.all(preservedFiles.map(path => hashFile(join(home, path))))
    // Probe reencrypts the credential document with fresh nonces. Compare the
    // actual Silo credential fingerprint without logging either credential.
    const credentialFingerprint = () => createHash('sha256').update(compose('exec', '-T', 'server', '/opt/moss/node/bin/node', '/opt/moss/app/bin/moss-server.mjs', 'cloud-storage', 'init-credentials')).digest('hex')
    const originalCredentials = credentialFingerprint()
    execFileSync('bash', [fileURLToPath(new URL('../../deploy/server/local.sh', import.meta.url)), home], { stdio: 'inherit', timeout: 15 * 60000 })
    await waitReady()
    assert.deepEqual(await Promise.all(preservedFiles.map(path => hashFile(join(home, path)))), originalHashes)
    assert.equal(credentialFingerprint(), originalCredentials)
    assert.deepEqual(await hashResponse(await request(`${prefix}/files/${uploaded.fileId}/content`)), { size: finished.totalBytes, sha256: await hashFile(source) })
    passed('Source rebuild and repeated Silo initialization preserve configuration, credentials, metadata and file checksum')
  }

  if (verifyBackup) {
    await host.close(); host = null
    const archive = join(temporary, 'deployment.tar')
    const content = { size: (await stat(source)).size, sha256: await hashFile(source) }
    const preservedFiles = ['.env', 'server.json', 'settings.json', 'tls/server.crt', 'credentials/.master.key', 'credentials/server-secrets.json']
    const originalHashes = await Promise.all(preservedFiles.map(path => hashFile(join(home, path))))
    const stop = () => { compose('stop', 'nginx', 'server'); compose('stop', 'silo', 'mysql') }
    const start = () => compose('up', '-d', '--force-recreate', '--wait', '--wait-timeout', '180', 'mysql', 'silo', 'server', 'nginx')
    console.log('Creating and restoring a stopped backup of this disposable deployment')
    stop()
    try { execFileSync('tar', ['-cf', archive, '-C', home, '.'], { timeout: 120000 }) }
    finally { start(); await waitReady() }
    // Prove restoration, rather than merely reading the unchanged live object.
    await cloud(`/files/${uploaded.fileId}`, { method: 'DELETE' })
    await cloud(`/files/${uploaded.fileId}`, { status: 404 })
    stop()
    const moved = []
    try {
      for (const [index, path] of ['var/lib/mysql', 'silo-data', 'credentials'].entries()) {
        const original = join(home, path), saved = join(temporary, `before-restore-${index}`)
        await rename(original, saved); moved.push({ original, saved })
      }
      execFileSync('tar', ['-xf', archive, '-C', home], { timeout: 120000 })
    } catch (error) {
      for (const { original, saved } of moved) {
        await rm(original, { recursive: true, force: true }); await rename(saved, original)
      }
      throw error
    } finally { start(); await waitReady() }
    assert.deepEqual(await Promise.all(preservedFiles.map(path => hashFile(join(home, path)))), originalHashes)
    assert.deepEqual(await hashResponse(await request(`${prefix}/files/${uploaded.fileId}/content`)), content)
    passed('Stopped MySQL/Silo backup restores deleted metadata and object, encrypted credentials, master key and configuration', content)
  }
} finally {
  await host?.close()
  for (const id of files) await cloud(`/files/${id}`, { method: 'DELETE' }).catch(() => {})
  for (const id of uploads) await cloud(`/uploads/${id}`, { method: 'DELETE', status: 200 }).catch(() => {})
  for (const id of folders.reverse()) await cloud(`/files/${id}`, { method: 'DELETE' }).catch(() => {})
  if (userId) await json(`/api/v1/users/${userId}`, { method: 'PATCH', body: { status: 'disabled' } }).catch(() => {})
  await rm(temporary, { recursive: true, force: true })
  await dispatcher?.close()
}
await mkdir(join(home, 'verification'), { recursive: true, mode: 0o700 })
const reportPath = join(home, 'verification', process.versions.electron ? 'electron.json' : verifyBackup ? 'backup.json' : verifyRebuild ? 'rebuild.json' : 'deployment.json')
await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
console.log(`Report: ${reportPath}`)
