import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'
import { validateAppPackage } from '../packages/app-runtime/src/index.mjs'
import { downloadFileBuffer } from '../ui/src/download-utils.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const BUNDLED_APPS_LOCK_PATH = path.join(repoRoot, 'config', 'bundled-apps.lock.json')
export const BUNDLED_APPS_OUTPUT_DIR = path.join(repoRoot, 'ui', 'dist', 'bundled-apps')
export const APP_MARKET_RESOURCES_DIR = path.join(repoRoot, 'ui', 'resources', 'app-market')
const MAX_MARKETPLACE_BYTES = 5 * 1024 * 1024
const MAX_APP_BYTES = 250 * 1024 * 1024

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function normalizeSha256(value, fieldName) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${fieldName} must be a SHA-256 hex digest`)
  return normalized
}

export function readBundledAppsLock(lockPath = BUNDLED_APPS_LOCK_PATH) {
  const raw = readJson(lockPath)
  if (raw?.schemaVersion !== 1 || !Array.isArray(raw.apps)) throw new Error(`Invalid bundled App lock: ${lockPath}`)
  const ids = new Set()
  return {
    schemaVersion: 1,
    apps: raw.apps.map((entry) => {
      const id = String(entry?.id || '').trim()
      const version = String(entry?.version || '').trim()
      if (!/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/.test(id)) throw new Error(`Invalid bundled App id: ${id}`)
      if (ids.has(id)) throw new Error(`Duplicate bundled App id: ${id}`)
      ids.add(id)
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid bundled App version: ${version}`)
      return { id, version }
    }),
  }
}

export function loadTrustedAppPublishers(resourceDir = APP_MARKET_RESOURCES_DIR) {
  const configPath = path.join(resourceDir, 'trusted-publishers.json')
  const config = readJson(configPath)
  if (config?.schemaVersion !== 1 || !config.publishers || typeof config.publishers !== 'object') {
    throw new Error(`Invalid trusted publisher configuration: ${configPath}`)
  }
  return Object.fromEntries(Object.entries(config.publishers).map(([publisherId, publisher]) => [publisherId, {
    name: String(publisher?.name || publisherId),
    keys: Object.fromEntries(Object.entries(publisher?.keys || {}).map(([keyId, relativePath]) => {
      const keyPath = path.resolve(resourceDir, String(relativePath))
      const relative = path.relative(path.resolve(resourceDir), keyPath)
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Publisher key escapes resource directory: ${relativePath}`)
      return [keyId, fs.readFileSync(keyPath, 'utf8')]
    })),
  }]))
}

function normalizeHttpsUrl(value, baseUrl, fieldName) {
  let url
  try { url = new URL(String(value || ''), baseUrl) }
  catch { throw new Error(`Invalid bundled App marketplace URL: ${fieldName}`) }
  if (url.protocol !== 'https:') throw new Error(`Bundled App marketplace URL must use HTTPS: ${fieldName}`)
  return url.toString()
}

async function downloadJson(url, download) {
  const buffer = await download(url, {
    userAgent: 'Moss-BundledApps/1.0',
    maxBytes: MAX_MARKETPLACE_BYTES,
  })
  try { return JSON.parse(Buffer.from(buffer).toString('utf8')) }
  catch (error) { throw new Error(`Invalid bundled App marketplace JSON at ${url}: ${error.message}`) }
}

export async function resolveBundledApps(lock, options = {}) {
  const resourceDir = path.resolve(options.resourceDir || APP_MARKET_RESOURCES_DIR)
  const catalog = readJson(path.join(resourceDir, 'catalog.json'))
  if (catalog?.schemaVersion !== 1 || typeof catalog.indexUrl !== 'string') {
    throw new Error(`Invalid bundled App marketplace configuration: ${path.join(resourceDir, 'catalog.json')}`)
  }
  const indexUrl = normalizeHttpsUrl(options.indexUrl || catalog.indexUrl, undefined, 'indexUrl')
  const download = options.download || downloadFileBuffer
  const index = await downloadJson(indexUrl, download)
  if (index?.schemaVersion !== 1 || !Array.isArray(index.apps)) {
    throw new Error(`Invalid bundled App marketplace index: ${indexUrl}`)
  }

  return Promise.all(lock.apps.map(async (pin) => {
    const summary = index.apps.find((entry) => entry?.id === pin.id)
    if (!summary) throw new Error(`Bundled App is not published: ${pin.id}`)
    const detailUrl = normalizeHttpsUrl(summary.detailUrl, indexUrl, `${pin.id}.detailUrl`)
    const detail = await downloadJson(detailUrl, download)
    if (detail?.schemaVersion !== 1 || detail.id !== pin.id || !Array.isArray(detail.versions)) {
      throw new Error(`Invalid bundled App marketplace detail: ${pin.id}`)
    }
    const release = detail.versions.find((entry) => entry?.version === pin.version)
    if (!release) throw new Error(`Bundled App version is not published: ${pin.id}@${pin.version}`)
    const artifact = release.artifact
    if (!artifact || typeof artifact !== 'object') throw new Error(`Missing bundled App artifact: ${pin.id}@${pin.version}`)
    const fileName = String(artifact.fileName || '').trim()
    if (!fileName.endsWith('.zip') || path.basename(fileName) !== fileName) {
      throw new Error(`Invalid bundled App filename: ${fileName}`)
    }
    const size = Number(artifact.size)
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_APP_BYTES) {
      throw new Error(`Invalid bundled App size: ${pin.id}@${pin.version}`)
    }
    if (artifact.signed !== true) throw new Error(`Bundled App release is not signed: ${pin.id}@${pin.version}`)
    const publisherId = String(artifact.publisherId || '').trim()
    const keyId = String(artifact.keyId || '').trim()
    if (!publisherId || !keyId || String(detail.publisher?.id || '').trim() !== publisherId) {
      throw new Error(`Invalid bundled App publisher metadata: ${pin.id}@${pin.version}`)
    }
    return {
      ...pin,
      fileName,
      url: normalizeHttpsUrl(artifact.downloadUrl, detailUrl, `${pin.id}@${pin.version}.downloadUrl`),
      sha256: normalizeSha256(artifact.sha256, `${pin.id}@${pin.version}.sha256`),
      size,
      publisherId,
      keyId,
    }
  }))
}

function safeArchivePath(value) {
  const portable = String(value || '').replaceAll('\\', '/')
  const normalized = path.posix.normalize(portable).replace(/^\.\/+/, '')
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Unsafe App archive path: ${value}`)
  }
  return normalized
}

export async function extractBundledAppArchive(buffer, destination, limits = {}) {
  const maxFiles = limits.maxFiles || 10_000
  const maxFileBytes = limits.maxFileBytes || 50 * 1024 * 1024
  const maxPackageBytes = limits.maxPackageBytes || 250 * 1024 * 1024
  const archive = unzipSync(new Uint8Array(buffer))
  const entries = Object.entries(archive)
  if (entries.length > maxFiles) throw new Error('App archive contains too many files')
  let totalBytes = 0
  const names = new Set()
  for (const [rawName, bytes] of entries) {
    const name = safeArchivePath(rawName)
    if (names.has(name)) throw new Error(`Duplicate App archive path: ${name}`)
    names.add(name)
    if (bytes.byteLength > maxFileBytes) throw new Error(`App archive file is too large: ${name}`)
    totalBytes += bytes.byteLength
    if (totalBytes > maxPackageBytes) throw new Error('App archive exceeds the total size limit')
    const target = path.resolve(destination, name)
    const relative = path.relative(path.resolve(destination), target)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`App archive escapes destination: ${name}`)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, bytes, { mode: 0o600 })
  }
}

async function readArtifact(entry, options) {
  const localRoot = options.localArtifactsDir
  if (localRoot) {
    const candidates = [
      path.join(localRoot, entry.id, entry.version, entry.fileName),
      path.join(localRoot, entry.fileName),
    ]
    const localPath = candidates.find((candidate) => fs.existsSync(candidate))
    if (!localPath) throw new Error(`Local bundled App artifact not found: ${entry.fileName}`)
    return fsp.readFile(localPath)
  }
  return (options.download || downloadFileBuffer)(entry.url, {
    userAgent: 'Moss-BundledApps/1.0',
    maxBytes: MAX_APP_BYTES,
  })
}

export async function prepareBundledApps(options = {}) {
  const lockPath = path.resolve(options.lockPath || BUNDLED_APPS_LOCK_PATH)
  const outputDir = path.resolve(options.outputDir || BUNDLED_APPS_OUTPUT_DIR)
  const resourceDir = path.resolve(options.resourceDir || APP_MARKET_RESOURCES_DIR)
  const localArtifactsDir = options.localArtifactsDir
    || process.env.MOSS_BUNDLED_APPS_ARTIFACTS_DIR
    || ''
  const lock = readBundledAppsLock(lockPath)
  const trustedPublishers = loadTrustedAppPublishers(resourceDir)
  const resolvedApps = await resolveBundledApps(lock, {
    resourceDir,
    indexUrl: options.indexUrl,
    download: options.download,
  })
  const lockHash = createHash('sha256')
    .update(JSON.stringify({ lock, resolvedApps, trustedPublishers }))
    .digest('hex')
  const markerPath = path.join(outputDir, '.prepared.json')
  const marker = fs.existsSync(markerPath) ? readJson(markerPath) : null
  if (!options.force && marker?.lockHash === lockHash) {
    try {
      for (const entry of resolvedApps) {
        const packageInfo = await validateAppPackage(path.join(outputDir, entry.id), {
          trustedPublishers,
          requireTrustedPublisher: true,
        })
        if (
          packageInfo.manifest.id !== entry.id
          || packageInfo.manifest.version !== entry.version
          || packageInfo.trust.publisherId !== entry.publisherId
          || packageInfo.trust.keyId !== entry.keyId
        ) throw new Error(`Cached bundled App identity mismatch: ${entry.id}@${entry.version}`)
      }
      return { outputDir, apps: lock.apps, cached: true }
    } catch {
      // Recreate a missing or modified cache from the immutable archive below.
    }
  }

  const stagingRoot = `${outputDir}.${process.pid}.${randomUUID()}.tmp`
  await fsp.rm(stagingRoot, { recursive: true, force: true })
  await fsp.mkdir(stagingRoot, { recursive: true })
  try {
    for (const entry of resolvedApps) {
      const archive = await readArtifact(entry, { ...options, localArtifactsDir })
      if (archive.length !== entry.size) throw new Error(`Bundled App size mismatch: ${entry.id}@${entry.version}`)
      const actualHash = createHash('sha256').update(archive).digest('hex')
      if (actualHash !== entry.sha256) throw new Error(`Bundled App checksum mismatch: ${entry.id}@${entry.version}`)
      const extracted = path.join(stagingRoot, `.extract-${entry.id}`)
      await extractBundledAppArchive(archive, extracted)
      const children = await fsp.readdir(extracted, { withFileTypes: true })
      const packageRoot = fs.existsSync(path.join(extracted, 'app.moss.json'))
        ? extracted
        : children.length === 1 && children[0].isDirectory()
          ? path.join(extracted, children[0].name)
          : extracted
      const packageInfo = await validateAppPackage(packageRoot, {
        trustedPublishers,
        requireTrustedPublisher: true,
      })
      if (packageInfo.manifest.id !== entry.id || packageInfo.manifest.version !== entry.version) {
        throw new Error(`Bundled App identity mismatch: expected ${entry.id}@${entry.version}`)
      }
      if (packageInfo.trust.publisherId !== entry.publisherId || packageInfo.trust.keyId !== entry.keyId) {
        throw new Error(`Bundled App signer mismatch: ${entry.id}@${entry.version}`)
      }
      await fsp.cp(packageRoot, path.join(stagingRoot, entry.id), { recursive: true })
      await fsp.rm(extracted, { recursive: true, force: true })
    }
    await fsp.writeFile(path.join(stagingRoot, '.prepared.json'), `${JSON.stringify({ schemaVersion: 1, lockHash }, null, 2)}\n`)
    await fsp.rm(outputDir, { recursive: true, force: true })
    await fsp.mkdir(path.dirname(outputDir), { recursive: true })
    await fsp.rename(stagingRoot, outputDir)
  } catch (error) {
    await fsp.rm(stagingRoot, { recursive: true, force: true })
    throw error
  }
  return { outputDir, apps: lock.apps, cached: false }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await prepareBundledApps({ force: process.argv.includes('--force') })
  console.log(`prepared ${result.apps.length} bundled App(s) in ${result.outputDir}${result.cached ? ' (cached)' : ''}`)
}
