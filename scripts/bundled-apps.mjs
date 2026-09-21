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
      const fileName = String(entry?.fileName || '').trim()
      const url = new URL(String(entry?.url || ''))
      if (!/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/.test(id)) throw new Error(`Invalid bundled App id: ${id}`)
      if (ids.has(id)) throw new Error(`Duplicate bundled App id: ${id}`)
      ids.add(id)
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid bundled App version: ${version}`)
      if (url.protocol !== 'https:') throw new Error(`Bundled App URL must use HTTPS: ${url}`)
      if (!fileName.endsWith('.zip') || path.basename(fileName) !== fileName) throw new Error(`Invalid bundled App filename: ${fileName}`)
      return {
        id,
        version,
        fileName,
        url: url.toString(),
        sha256: normalizeSha256(entry.sha256, `${id}.sha256`),
        publisherId: String(entry.publisherId || '').trim(),
        keyId: String(entry.keyId || '').trim(),
      }
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
    maxBytes: 250 * 1024 * 1024,
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
  const lockHash = createHash('sha256').update(JSON.stringify({ lock, trustedPublishers })).digest('hex')
  const markerPath = path.join(outputDir, '.prepared.json')
  const marker = fs.existsSync(markerPath) ? readJson(markerPath) : null
  if (!options.force && marker?.lockHash === lockHash) {
    try {
      for (const entry of lock.apps) {
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
    for (const entry of lock.apps) {
      const archive = await readArtifact(entry, { ...options, localArtifactsDir })
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
