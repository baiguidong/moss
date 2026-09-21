import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import semver from 'semver'
import { APP_HOST_API_VERSION } from '../../../packages/app-sdk/src/index.mjs'
import { validateAppPackage } from '../../../packages/app-runtime/src/index.mjs'
import { downloadFileBuffer } from '../download-utils.mjs'
import { installAppArchive } from './desktop-app-runtime.mjs'

const MARKET_CACHE_VERSION = 1
const MARKET_CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CATALOG_BYTES = 5 * 1024 * 1024
const MAX_APP_BYTES = 250 * 1024 * 1024
const SUPPORTED_PLATFORMS = new Set([
  'darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64',
])

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeString(value, fieldName, options = {}) {
  const result = String(value || '').trim()
  if (!result && options.required !== false) throw new Error(`App marketplace field is required: ${fieldName}`)
  if (options.maxLength && result.length > options.maxLength) throw new Error(`App marketplace field is too long: ${fieldName}`)
  return result
}

function safeHttpsUrl(value, baseUrl, fieldName) {
  let url
  try { url = new URL(safeString(value, fieldName), baseUrl) }
  catch { throw new Error(`Invalid App marketplace URL: ${fieldName}`) }
  const allowHttpForTests = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !allowHttpForTests) throw new Error(`App marketplace URL must use HTTPS: ${fieldName}`)
  return url.toString()
}

function normalizeStringArray(value, fieldName, options = {}) {
  if (!Array.isArray(value)) throw new Error(`App marketplace field must be an array: ${fieldName}`)
  const result = [...new Set(value.map((item) => safeString(item, fieldName, { maxLength: options.maxLength || 160 })))]
  if (options.required && result.length === 0) throw new Error(`App marketplace field cannot be empty: ${fieldName}`)
  return result
}

export function normalizeMarketplaceVersion(raw, baseUrl) {
  if (!isObject(raw)) throw new Error('Invalid App marketplace version')
  const version = safeString(raw.version, 'version')
  const hostApi = safeString(raw.hostApi, 'hostApi')
  if (!semver.valid(version)) throw new Error(`Invalid App marketplace version: ${version}`)
  if (!semver.validRange(hostApi)) throw new Error(`Invalid App Host API range: ${hostApi}`)
  const platforms = normalizeStringArray(raw.platforms, 'platforms', { required: true })
  const unsupported = platforms.find((platform) => !SUPPORTED_PLATFORMS.has(platform))
  if (unsupported) throw new Error(`Unsupported App marketplace platform: ${unsupported}`)
  const artifact = raw.artifact
  if (!isObject(artifact)) throw new Error(`Missing App artifact for version ${version}`)
  const sha256 = safeString(artifact.sha256, 'artifact.sha256').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Invalid App artifact SHA-256 for version ${version}`)
  const fileName = safeString(artifact.fileName, 'artifact.fileName')
  if (path.basename(fileName) !== fileName || !fileName.endsWith('.zip')) {
    throw new Error(`Invalid App artifact filename for version ${version}`)
  }
  const size = Number(artifact.size)
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_APP_BYTES) {
    throw new Error(`Invalid App artifact size for version ${version}`)
  }
  return {
    version,
    hostApi,
    platforms,
    permissions: normalizeStringArray(raw.permissions || [], 'permissions'),
    publishedAt: safeString(raw.publishedAt, 'publishedAt', { required: false }),
    releaseNotes: safeString(raw.releaseNotes, 'releaseNotes', { required: false, maxLength: 20_000 }),
    artifact: {
      fileName,
      downloadUrl: safeHttpsUrl(artifact.downloadUrl, baseUrl, 'artifact.downloadUrl'),
      sha256,
      size,
      signed: artifact.signed === true,
      publisherId: safeString(artifact.publisherId, 'artifact.publisherId', { required: false }),
      keyId: safeString(artifact.keyId, 'artifact.keyId', { required: false }),
    },
  }
}

function normalizePublisher(raw) {
  if (!isObject(raw)) return null
  const id = safeString(raw.id, 'publisher.id')
  const name = safeString(raw.name, 'publisher.name')
  return { id, name }
}

function normalizeMarketplaceSummary(raw, indexUrl) {
  if (!isObject(raw)) throw new Error('Invalid App marketplace entry')
  const id = safeString(raw.id, 'app.id')
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/.test(id)) throw new Error(`Invalid App id: ${id}`)
  const latest = normalizeMarketplaceVersion(raw.latest, indexUrl)
  if (raw.latestVersion !== latest.version) throw new Error(`Latest version mismatch for ${id}`)
  return {
    id,
    displayName: safeString(raw.displayName, 'app.displayName'),
    summary: safeString(raw.summary, 'app.summary', { maxLength: 160 }),
    publisher: normalizePublisher(raw.publisher),
    categories: normalizeStringArray(raw.categories || [], 'app.categories'),
    featured: raw.featured === true,
    iconUrl: raw.iconUrl ? safeHttpsUrl(raw.iconUrl, indexUrl, 'app.iconUrl') : '',
    detailUrl: safeHttpsUrl(raw.detailUrl, indexUrl, 'app.detailUrl'),
    latestVersion: latest.version,
    latest,
  }
}

export function normalizeMarketplaceIndex(raw, indexUrl) {
  if (raw?.schemaVersion !== 1 || !Array.isArray(raw.apps)) throw new Error('Invalid Moss App marketplace index')
  if (raw.apps.length > 1_000) throw new Error('Moss App marketplace contains too many entries')
  const apps = raw.apps.map((entry) => normalizeMarketplaceSummary(entry, indexUrl))
  if (new Set(apps.map((entry) => entry.id)).size !== apps.length) throw new Error('Moss App marketplace contains duplicate App ids')
  return {
    schemaVersion: 1,
    catalogId: safeString(raw.catalogId, 'catalogId'),
    displayName: safeString(raw.displayName, 'displayName'),
    generatedAt: safeString(raw.generatedAt, 'generatedAt'),
    apps,
  }
}

export function normalizeMarketplaceDetail(raw, detailUrl, expectedAppId) {
  if (raw?.schemaVersion !== 1 || raw.id !== expectedAppId || !Array.isArray(raw.versions)) {
    throw new Error(`Invalid marketplace detail for ${expectedAppId}`)
  }
  if (raw.versions.length > 100) throw new Error(`Too many marketplace versions for ${expectedAppId}`)
  const versions = raw.versions.map((entry) => normalizeMarketplaceVersion(entry, detailUrl))
    .sort((left, right) => semver.rcompare(left.version, right.version))
  if (!versions.some((entry) => entry.version === raw.latestVersion)) {
    throw new Error(`Marketplace detail is missing latest version ${raw.latestVersion}`)
  }
  return {
    schemaVersion: 1,
    id: expectedAppId,
    displayName: safeString(raw.displayName, 'app.displayName'),
    summary: safeString(raw.summary, 'app.summary', { maxLength: 160 }),
    description: safeString(raw.description, 'app.description', { required: false, maxLength: 8_000 }),
    publisher: normalizePublisher(raw.publisher),
    categories: normalizeStringArray(raw.categories || [], 'app.categories'),
    keywords: normalizeStringArray(raw.keywords || [], 'app.keywords'),
    homepage: raw.homepage ? safeHttpsUrl(raw.homepage, detailUrl, 'app.homepage') : '',
    repository: raw.repository ? safeHttpsUrl(raw.repository, detailUrl, 'app.repository') : '',
    license: safeString(raw.license, 'app.license', { required: false }),
    featured: raw.featured === true,
    iconUrl: raw.iconUrl ? safeHttpsUrl(raw.iconUrl, detailUrl, 'app.iconUrl') : '',
    latestVersion: raw.latestVersion,
    versions,
  }
}

function readCache(cachePath, indexUrl) {
  try {
    const value = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    return value?.schemaVersion === MARKET_CACHE_VERSION && value.indexUrl === indexUrl ? value : null
  } catch { return null }
}

async function writeCache(cachePath, value) {
  await fsp.mkdir(path.dirname(cachePath), { recursive: true })
  const temporary = `${cachePath}.${process.pid}.${randomUUID()}.tmp`
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await fsp.rename(temporary, cachePath)
}

function platformCompatibility(version, platform) {
  return {
    platformCompatible: version.platforms.includes(platform),
    hostCompatible: semver.satisfies(APP_HOST_API_VERSION, version.hostApi),
  }
}

function enrichSummary(summary, installedApps, platform) {
  const installed = installedApps.find((entry) => (entry.id || entry.name) === summary.id)
  const compatibility = platformCompatibility(summary.latest, platform)
  return {
    ...summary,
    ...compatibility,
    installedVersion: installed?.currentVersion || null,
    updateAvailable: Boolean(installed?.currentVersion && semver.gt(summary.latestVersion, installed.currentVersion)),
  }
}

export function createAppMarketplaceService(options = {}) {
  const indexUrl = safeHttpsUrl(options.indexUrl, undefined, 'indexUrl')
  const cachePath = path.resolve(options.cachePath || path.join(os.homedir(), '.moss', 'app-market', 'catalog-v1.json'))
  const platform = options.platform || `${process.platform}-${process.arch}`
  const download = options.download || downloadFileBuffer
  const archiveInstaller = options.installArchive || installAppArchive
  const packageValidator = options.validatePackage || validateAppPackage
  const trustedPublishers = options.trustedPublishers || {}
  let memoryCache = readCache(cachePath, indexUrl)
  const installLocks = new Map()
  const enrichDetail = (detail) => ({
    ...detail,
    versions: detail.versions.map((version) => ({ ...version, ...platformCompatibility(version, platform) })),
  })

  async function downloadJson(url) {
    const buffer = await download(url, { userAgent: 'Moss-AppMarket/1.0', maxBytes: MAX_CATALOG_BYTES })
    try { return JSON.parse(Buffer.from(buffer).toString('utf8')) }
    catch (error) { throw new Error(`Invalid App marketplace JSON: ${error.message}`) }
  }

  async function persist(index, details = memoryCache?.details || {}) {
    memoryCache = { schemaVersion: MARKET_CACHE_VERSION, indexUrl, fetchedAt: Date.now(), index, details }
    await writeCache(cachePath, memoryCache)
  }

  async function loadIndex({ forceRefresh = false } = {}) {
    if (!forceRefresh && memoryCache?.index && Date.now() - Number(memoryCache.fetchedAt || 0) < MARKET_CACHE_TTL_MS) {
      return { index: memoryCache.index, cached: true, warning: '' }
    }
    try {
      const index = normalizeMarketplaceIndex(await downloadJson(indexUrl), indexUrl)
      await persist(index)
      return { index, cached: false, warning: '' }
    } catch (error) {
      if (!memoryCache?.index) throw error
      return { index: memoryCache.index, cached: true, warning: `市场连接失败，正在显示缓存：${error.message}` }
    }
  }

  async function list(input = {}) {
    const result = await loadIndex(input)
    const installedApps = await options.getInstalledApps()
    return {
      ...result.index,
      sourceUrl: indexUrl,
      fetchedAt: memoryCache?.fetchedAt || Date.now(),
      cached: result.cached,
      warning: result.warning,
      platform,
      hostApiVersion: APP_HOST_API_VERSION,
      apps: result.index.apps.map((entry) => enrichSummary(entry, installedApps, platform)),
    }
  }

  async function getDetails(appId, input = {}) {
    const { index } = await loadIndex({ forceRefresh: input.forceRefresh === true })
    const summary = index.apps.find((entry) => entry.id === appId)
    if (!summary) throw new Error(`App is not present in the marketplace: ${appId}`)
    if (!input.forceRefresh && memoryCache?.details?.[appId]) return enrichDetail(memoryCache.details[appId])
    try {
      const normalized = normalizeMarketplaceDetail(await downloadJson(summary.detailUrl), summary.detailUrl, appId)
      await persist(index, { ...(memoryCache?.details || {}), [appId]: normalized })
      return enrichDetail(normalized)
    } catch (error) {
      if (memoryCache?.details?.[appId]) return { ...enrichDetail(memoryCache.details[appId]), warning: `详情更新失败，正在显示缓存：${error.message}` }
      throw error
    }
  }

  async function install({ appId, version: requestedVersion, acceptPermissions = false } = {}) {
    if (installLocks.has(appId)) return installLocks.get(appId)
    const operation = (async () => {
      const detail = await getDetails(appId)
      const version = detail.versions.find((entry) => entry.version === (requestedVersion || detail.latestVersion))
      if (!version) throw new Error(`Marketplace version not found: ${appId}@${requestedVersion}`)
      const compatibility = platformCompatibility(version, platform)
      if (!compatibility.platformCompatible) throw new Error(`App ${appId}@${version.version} does not support ${platform}`)
      if (!compatibility.hostCompatible) throw new Error(`App ${appId}@${version.version} requires Host API ${version.hostApi}`)
      if (!version.artifact.signed) throw new Error(`App ${appId}@${version.version} is not signed`)

      const runtime = options.getRuntime()
      const installed = await runtime.getApp(appId)
      const previousVersion = installed?.installation?.activeVersion || null
      if (installed?.installation?.activeVersion === version.version) {
        return { ok: true, alreadyInstalled: true, appId, version: version.version }
      }
      const currentGrants = installed?.installation?.grants || []
      const addedPermissions = version.permissions.filter((permission) => !currentGrants.includes(permission))
      if (addedPermissions.length && !acceptPermissions) {
        return { ok: false, requiresPermissionApproval: true, appId, version: version.version, permissions: addedPermissions }
      }

      const archive = await download(version.artifact.downloadUrl, {
        userAgent: 'Moss-AppMarket/1.0',
        maxBytes: MAX_APP_BYTES,
      })
      if (version.artifact.size && archive.length !== version.artifact.size) {
        throw new Error(`App download size mismatch: ${appId}@${version.version}`)
      }
      const checksum = createHash('sha256').update(archive).digest('hex')
      if (checksum !== version.artifact.sha256) throw new Error(`App download checksum mismatch: ${appId}@${version.version}`)

      const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-market-app-'))
      const archivePath = path.join(temporaryRoot, version.artifact.fileName)
      let packageInstallStarted = false
      let activationCompleted = false
      try {
        await fsp.writeFile(archivePath, archive, { mode: 0o600 })
        const app = await archiveInstaller(runtime, archivePath, {
          installPackage: async (packageRoot) => {
            const packageInfo = await packageValidator(packageRoot, { trustedPublishers, requireTrustedPublisher: true })
            if (packageInfo.manifest.id !== appId || packageInfo.manifest.version !== version.version) {
              throw new Error(`Downloaded App identity mismatch: expected ${appId}@${version.version}`)
            }
            if (packageInfo.trust.publisherId !== detail.publisher?.id) {
              throw new Error(`Downloaded App publisher mismatch: ${appId}@${version.version}`)
            }
            if (
              packageInfo.trust.publisherId !== version.artifact.publisherId
              || packageInfo.trust.keyId !== version.artifact.keyId
            ) {
              throw new Error(`Downloaded App signer mismatch: ${appId}@${version.version}`)
            }
            packageInstallStarted = true
            return options.installPackage(packageRoot, {
              trustedPublishers,
              requireTrustedPublisher: true,
              marketplaceSource: { catalogUrl: indexUrl, appId, version: version.version },
            })
          },
        })
        const grants = [...new Set([...currentGrants, ...addedPermissions])]
        await runtime.registerInstalled(appId, version.version, { grants })
        activationCompleted = true
        await options.emitChanged?.({ action: installed ? 'marketplace-updated' : 'marketplace-installed', appId })
        return { ok: true, appId, version: version.version, app }
      } catch (error) {
        if (packageInstallStarted && !activationCompleted) {
          try {
            await options.rollbackPackage?.({ appId, previousVersion, failedVersion: version.version })
          } catch (rollbackError) {
            throw new Error(`${error.message}; package registry rollback also failed: ${rollbackError.message}`)
          }
        }
        throw error
      } finally {
        await fsp.rm(temporaryRoot, { recursive: true, force: true })
      }
    })().finally(() => installLocks.delete(appId))
    installLocks.set(appId, operation)
    return operation
  }

  return { list, getDetails, install }
}

export function registerAppMarketplaceIpc({ ipcMain, service }) {
  ipcMain.handle('app-market:list', (_event, payload = {}) => service.list(payload))
  ipcMain.handle('app-market:get-details', (_event, payload = {}) => service.getDetails(payload.appId, payload))
  ipcMain.handle('app-market:install', (_event, payload = {}) => service.install(payload))
}
