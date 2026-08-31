import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import yauzl from 'yauzl'
import {
  createCredentialCipher,
  createCredentialEncryptionHeader,
  createCredentialMasterKeyStore,
  getMossCredentialMasterKeyPaths,
  readPrivateFile,
  withPrivateFileLockSync,
  writePrivateFileAtomic,
} from '../../../shared/security/credential-crypto.mjs'
import { AppRuntimeHost } from '../../../packages/app-runtime/src/index.mjs'

const CREDENTIAL_VERSION = 1

function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }

export class DesktopAppCredentialAdapter {
  constructor(mossHome) {
    this.storagePath = path.join(mossHome, 'credentials', 'app-secrets.json')
    const keyPaths = getMossCredentialMasterKeyPaths(mossHome)
    this.keys = createCredentialMasterKeyStore({ primaryPath: keyPaths.primaryPath, backupPath: keyPaths.backupPath })
    this.identity = 'moss-app-credentials'
    this.scope = 'app-instance-secrets'
  }

  readDocument() {
    if (!fs.existsSync(this.storagePath)) return { values: {}, document: null, masterKey: null }
    const document = JSON.parse(readPrivateFile(this.storagePath).toString('utf8'))
    if (document.version !== CREDENTIAL_VERSION || !isObject(document.values)) throw new Error('Unsupported App credential file')
    const masterKey = this.keys.loadMatching((candidate) => {
      createCredentialCipher({ identity: this.identity, scope: this.scope, masterKey: candidate, header: document.encryption })
      return true
    })
    if (!masterKey) throw new Error('App credential master key is missing')
    const cipher = createCredentialCipher({ identity: this.identity, scope: this.scope, masterKey, header: document.encryption })
    const values = {}
    for (const [scopeKey, records] of Object.entries(document.values)) {
      values[scopeKey] = {}
      for (const [field, envelope] of Object.entries(records || {})) {
        values[scopeKey][field] = cipher.decryptString(envelope, JSON.stringify([scopeKey, field]))
      }
    }
    return { values, document, masterKey }
  }

  update(mutator) {
    return withPrivateFileLockSync(this.storagePath, () => {
      const current = this.readDocument()
      const values = mutator(structuredClone(current.values))
      const masterKey = current.masterKey || this.keys.loadOrCreate()
      const encryption = current.document?.encryption || createCredentialEncryptionHeader({ identity: this.identity, masterKey })
      const cipher = createCredentialCipher({ identity: this.identity, scope: this.scope, masterKey, header: encryption })
      const encrypted = {}
      for (const [scopeKey, records] of Object.entries(values || {})) {
        encrypted[scopeKey] = {}
        for (const [field, value] of Object.entries(records || {})) {
          encrypted[scopeKey][field] = cipher.encryptString(String(value), JSON.stringify([scopeKey, field]))
        }
      }
      writePrivateFileAtomic(this.storagePath, `${JSON.stringify({ version: CREDENTIAL_VERSION, encryption, values: encrypted }, null, 2)}\n`)
      return values
    })
  }

  scopeKey(appId, instanceId) { return `${appId}/${instanceId}` }
  async get(appId, instanceId) { return this.readDocument().values[this.scopeKey(appId, instanceId)] || {} }
  async set(appId, instanceId, values) {
    this.update((all) => { all[this.scopeKey(appId, instanceId)] = { ...(values || {}) }; return all })
  }
  async remove(appId, instanceId) {
    this.update((all) => { delete all[this.scopeKey(appId, instanceId)]; return all })
  }
  async removeApp(appId) {
    this.update((all) => {
      for (const key of Object.keys(all)) if (key.startsWith(`${appId}/`)) delete all[key]
      return all
    })
  }
}

function openZip(zipPath) {
  return new Promise((resolve, reject) => yauzl.open(zipPath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => error ? reject(error) : resolve(zip)))
}

export async function extractAppArchive(zipPath, destination, limits = {}) {
  const maxFiles = limits.maxFiles || 10_000
  const maxFileBytes = limits.maxFileBytes || 50 * 1024 * 1024
  const maxArchiveBytes = limits.maxArchiveBytes || 250 * 1024 * 1024
  const zip = await openZip(zipPath)
  const seen = new Set()
  let count = 0
  let totalBytes = 0
  await fsp.mkdir(destination, { recursive: true })
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      try { zip.close() } catch {}
      reject(error)
    }
    zip.on('error', fail)
    zip.on('entry', (entry) => {
      const normalized = path.posix.normalize(entry.fileName.replaceAll('\\', '/'))
      if (!normalized || normalized.startsWith('../') || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || path.isAbsolute(normalized) || seen.has(normalized)) {
        fail(new Error(`Unsafe or duplicate App archive path: ${entry.fileName}`)); return
      }
      seen.add(normalized)
      count += 1
      totalBytes += entry.uncompressedSize
      const mode = (entry.externalFileAttributes >>> 16) & 0xffff
      if ((mode & 0o170000) === 0o120000) { fail(new Error(`Symbolic links are not allowed: ${entry.fileName}`)); return }
      if (count > maxFiles || entry.uncompressedSize > maxFileBytes || totalBytes > maxArchiveBytes) {
        fail(new Error('App archive exceeds installation limits')); return
      }
      const target = path.resolve(destination, normalized)
      if (!target.startsWith(`${path.resolve(destination)}${path.sep}`)) { fail(new Error(`Archive path escapes staging: ${entry.fileName}`)); return }
      if (normalized.endsWith('/')) {
        fsp.mkdir(target, { recursive: true }).then(() => zip.readEntry(), fail)
        return
      }
      zip.openReadStream(entry, async (error, stream) => {
        if (error) { fail(error); return }
        try {
          await fsp.mkdir(path.dirname(target), { recursive: true })
          const file = fs.createWriteStream(target, { flags: 'wx', mode: 0o600 })
          stream.on('error', (streamError) => { file.destroy(); fail(streamError) })
          stream.pipe(file)
          file.on('finish', () => zip.readEntry())
          file.on('error', fail)
        } catch (writeError) { fail(writeError) }
      })
    })
    zip.on('end', () => {
      if (settled) return
      settled = true
      resolve(destination)
    })
    zip.readEntry()
  })
}

export async function installAppArchive(runtime, archivePath, options = {}) {
  const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-app-install-'))
  try {
    await extractAppArchive(archivePath, staging)
    const entries = await fsp.readdir(staging, { withFileTypes: true })
    const packageRoot = fs.existsSync(path.join(staging, 'app.moss.json'))
      ? staging
      : entries.length === 1 && entries[0].isDirectory()
        ? path.join(staging, entries[0].name)
        : staging
    return options.installPackage
      ? await options.installPackage(packageRoot)
      : await runtime.installFromDirectory(packageRoot)
  } finally {
    await fsp.rm(staging, { recursive: true, force: true })
  }
}

export async function createDesktopAppRuntime(options) {
  const runtime = new AppRuntimeHost({
    rootDir: options.mossHome,
    appsDir: options.appsDir,
    dataDir: path.join(options.mossHome, 'apps-data'),
    runtimeDir: path.join(options.mossHome, 'apps-runtime'),
    target: 'desktop',
    hostId: options.hostId || 'desktop-local',
    nodeExecutable: options.nodeExecutable,
    credentialAdapter: new DesktopAppCredentialAdapter(options.mossHome),
  })
  runtime.events.on('event', (event) => options.onEvent?.(event))
  await runtime.initialize()
  return runtime
}
