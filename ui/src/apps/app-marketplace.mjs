import { normalizeAppDiscovery } from '../../../packages/app-sdk/src/discovery.mjs'
import { assertReviewedPackage, packageReviewRevision } from './app-package-review.mjs'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import semver from 'semver'
import { APP_HOST_API_VERSION } from '../../../packages/app-sdk/src/index.mjs'
import { getAppCategory } from '../../../packages/app-sdk/src/categories.mjs'
import { validateAppPackage } from '../../../packages/app-runtime/src/index.mjs'
import { downloadFileBuffer } from '../download-utils.mjs'
import { MOSS_HOME } from '../moss-home.mjs'
import { installAppArchive } from './app-runtime.mjs'
import { appCapabilityDeclarationChanged, describeAppTools, describePreviousAppCapabilities } from './app-tool-disclosure.mjs'

const INSTALL_CANCELED = 'MOSS_APP_MARKET_INSTALL_CANCELED'
const MARKET_CACHE_VERSION = 2
const MARKET_CACHE_TTL_MS = 5 * 60 * 1000
const MARKET_REQUEST_TIMEOUT_MS = 15_000
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
  const normalizeArtifact = (artifact) => {
    if (!isObject(artifact)) throw new Error(`Missing App artifact for version ${version}`)
    const sha256 = safeString(artifact.sha256, 'artifact.sha256').toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Invalid App artifact SHA-256 for version ${version}`)
    const fileName = safeString(artifact.fileName, 'artifact.fileName')
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*\.zip$/.test(fileName)) throw new Error(`Invalid App artifact filename for version ${version}`)
    const size = Number(artifact.size)
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_APP_BYTES) throw new Error(`Invalid App artifact size for version ${version}`)
    return { ...artifact, fileName, downloadUrl: safeHttpsUrl(artifact.downloadUrl, baseUrl, 'artifact.downloadUrl'), sha256, size,
      signed: artifact.signed === true,
      publisherId: safeString(artifact.publisherId, 'artifact.publisherId', { required: false }),
      keyId: safeString(artifact.keyId, 'artifact.keyId', { required: false }) }
  }
  let delivery
  if (raw.artifacts !== undefined) {
    if (!isObject(raw.artifacts)) throw new Error('Invalid artifact platform map')
    if (!semver.subset(hostApi, '>=3.3.0')) throw new Error('Platform artifacts require Host API >=3.3.0')
    const keys = Object.keys(raw.artifacts)
    if (keys.length !== platforms.length || keys.some(key => !platforms.includes(key))) throw new Error('Artifact platforms must exactly match version platforms')
    delivery = { artifacts: Object.fromEntries(keys.map(key => [key, normalizeArtifact(raw.artifacts[key])])) }
  } else delivery = { artifact: normalizeArtifact(raw.artifact) }
  return { version, hostApi, platforms,
    permissions: normalizeStringArray(raw.permissions || [], 'permissions'),
    publishedAt: safeString(raw.publishedAt, 'publishedAt', { required: false }),
    releaseNotes: safeString(raw.releaseNotes, 'releaseNotes', { required: false, maxLength: 20_000 }),
    ...delivery }
}

export function selectMarketplaceArtifact(version, platform) {
  return version.platforms.includes(platform) ? (version.artifacts?.[platform] || version.artifact || null) : null
}
const forPlatform = (version, platform) => ({ ...version, artifact: selectMarketplaceArtifact(version, platform) })

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
    category: getAppCategory(raw.category).id,
    keywords: normalizeStringArray(raw.keywords || [], 'app.keywords'),
    categories: normalizeStringArray(raw.categories || [], 'app.categories'),
    featured: raw.featured === true,
    ...(normalizeAppDiscovery(raw.discovery) ? { discovery: normalizeAppDiscovery(raw.discovery) } : {}),
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
    category: getAppCategory(raw.category).id,
    categories: normalizeStringArray(raw.categories || [], 'app.categories'),
    keywords: normalizeStringArray(raw.keywords || [], 'app.keywords'),
    homepage: raw.homepage ? safeHttpsUrl(raw.homepage, detailUrl, 'app.homepage') : '',
    repository: raw.repository ? safeHttpsUrl(raw.repository, detailUrl, 'app.repository') : '',
    license: safeString(raw.license, 'app.license', { required: false }),
    featured: raw.featured === true,
    ...(normalizeAppDiscovery(raw.discovery) ? { discovery: normalizeAppDiscovery(raw.discovery) } : {}),
    iconUrl: raw.iconUrl ? safeHttpsUrl(raw.iconUrl, detailUrl, 'app.iconUrl') : '',
    latestVersion: raw.latestVersion,
    versions,
  }
}

function detailMatchesSummary(detail, summary) {
  return Boolean(
    detail
    && summary
    && detail.id === summary.id
    && detail.latestVersion === summary.latestVersion
    && Array.isArray(detail.versions)
    && detail.versions.some((version) => version.version === summary.latestVersion),
  )
}

function retainCurrentDetails(index, details = {}) {
  const summaries = new Map(index.apps.map((summary) => [summary.id, summary]))
  return Object.fromEntries(Object.entries(details).filter(([appId, detail]) => (
    detailMatchesSummary(detail, summaries.get(appId))
  )))
}

function versionedDetailUrl(detailUrl, version, generatedAt) {
  const url = new URL(detailUrl)
  url.searchParams.set('_moss_version', version)
  if (generatedAt) url.searchParams.set('_moss_catalog', generatedAt)
  return url.toString()
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
    platformCompatible: Boolean(selectMarketplaceArtifact(version, platform)),
    hostCompatible: semver.satisfies(APP_HOST_API_VERSION, version.hostApi),
  }
}

function enrichSummary(summary, installedApps, platform) {
  const installed = installedApps.find((entry) => (entry.id || entry.name) === summary.id)
  const compatibility = platformCompatibility(summary.latest, platform)
  return {
    ...summary,
    latest: forPlatform(summary.latest, platform),
    ...compatibility,
    installedVersion: installed?.currentVersion || null,
    localModification: Boolean(installed?.localModification),
    updateAvailable: Boolean(installed?.currentVersion && semver.gt(summary.latestVersion, installed.currentVersion)),
  }
}

export function createAppMarketplaceService(options = {}) {
  const indexUrl = safeHttpsUrl(options.indexUrl, undefined, 'indexUrl')
  const cachePath = path.resolve(options.cachePath || path.join(MOSS_HOME, 'app-market', 'catalog-v1.json'))
  const platform = options.platform || `${process.platform}-${process.arch}`
  const download = options.download || downloadFileBuffer
  const requestTimeoutMs = options.requestTimeoutMs ?? MARKET_REQUEST_TIMEOUT_MS
  const archiveInstaller = options.installArchive || installAppArchive
  const packageValidator = options.validatePackage || validateAppPackage
  const trustedPublishers = options.trustedPublishers || {}
  let memoryCache = readCache(cachePath, indexUrl)
  const installLocks = new Map()
  const enrichDetail = (detail) => ({
    ...detail,
    versions: detail.versions.map((version) => ({ ...forPlatform(version, platform), ...platformCompatibility(version, platform) })),
  })

  async function downloadJson(url) {
    // Bound the entire request, including DNS, redirects and a stalled response body.
    const signal = AbortSignal.timeout(requestTimeoutMs)
    let buffer
    try {
      buffer = await download(url, {
        userAgent: 'Moss-AppMarket/1.0', maxBytes: MAX_CATALOG_BYTES,
        timeoutMs: requestTimeoutMs, signal,
      })
    } catch (error) {
      if (signal.aborted || /timeout/i.test(error.message || '')) {
        throw new Error(`应用市场请求超时（${requestTimeoutMs / 1000} 秒），请检查网络后重试`, { cause: error })
      }
      throw new Error(`应用市场请求失败：${error.message || String(error)}`, { cause: error })
    }
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
      await persist(index, retainCurrentDetails(index, memoryCache?.details))
      return { index, cached: false, warning: '' }
    } catch (error) {
      if (!memoryCache?.index) throw error
      return { index: memoryCache.index, cached: true, warning: `市场刷新失败，正在显示缓存：${error.message}` }
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
      // The Host owns the target platform. A browser's OS is unrelated to the
      // Linux computer where its Apps execute. Keep the shared cache complete.
      apps: result.index.apps
        .filter((entry) => selectMarketplaceArtifact(entry.latest, platform))
        .map((entry) => enrichSummary(entry, installedApps, platform)),
    }
  }

  async function getDetails(appId, input = {}) {
    const { index } = await loadIndex({ forceRefresh: input.forceRefresh === true })
    const summary = index.apps.find((entry) => entry.id === appId)
    if (!summary) throw new Error(`App is not present in the marketplace: ${appId}`)
    const cachedDetail = memoryCache?.details?.[appId]
    if (!input.forceRefresh && detailMatchesSummary(cachedDetail, summary)) return enrichDetail(cachedDetail)
    try {
      let normalized = normalizeMarketplaceDetail(await downloadJson(summary.detailUrl), summary.detailUrl, appId)
      if (!detailMatchesSummary(normalized, summary)) {
        const freshUrl = versionedDetailUrl(summary.detailUrl, summary.latestVersion, index.generatedAt)
        normalized = normalizeMarketplaceDetail(await downloadJson(freshUrl), summary.detailUrl, appId)
      }
      if (!detailMatchesSummary(normalized, summary)) {
        throw new Error(`Marketplace detail version mismatch: ${appId}@${summary.latestVersion}`)
      }
      await persist(index, { ...(memoryCache?.details || {}), [appId]: normalized })
      return enrichDetail(normalized)
    } catch (error) {
      if (detailMatchesSummary(cachedDetail, summary)) {
        return { ...enrichDetail(cachedDetail), warning: `详情更新失败，正在显示缓存：${error.message}` }
      }
      throw error
    }
  }

  async function install({ appId, version: requestedVersion, acceptPermissions = false } = {}) {
    if (installLocks.has(appId)) return installLocks.get(appId)
    let progress = { source: 'marketplace', appId, version: requestedVersion || '' }
    const report = (patch) => {
      progress = { ...progress, ...patch }
      options.emitProgress?.(progress)
    }
    const operation = (async () => {
      const detail = await getDetails(appId)
      const version = detail.versions.find((entry) => entry.version === (requestedVersion || detail.latestVersion))
      if (!version) throw new Error(`Marketplace version not found: ${appId}@${requestedVersion}`)
      const compatibility = platformCompatibility(version, platform)
      if (!compatibility.platformCompatible) throw new Error(`App ${appId}@${version.version} does not support ${platform}`)
      if (!compatibility.hostCompatible) throw new Error(`App ${appId}@${version.version} requires Host API ${version.hostApi}`)
      if (!version.artifact.signed) throw new Error(`App ${appId}@${version.version} is not signed`)

      const runtime = options.getRuntime()
      const installationRevision = options.getInstallationRevision?.(appId)
      const installedEntry = (await options.getInstalledApps()).find(entry => (entry.id || entry.name) === appId)
      const localVersion = installedEntry?.localModification ? installedEntry.currentVersion : null
      // Different immutable versions can coexist, including their source packages.
      // Replacing the contents of the same version still requires an explicit uninstall.
      if (installedEntry?.localModification && (!localVersion || localVersion === version.version)) {
        throw new Error('此 App 的本地版本与市场版本号冲突。请保留源码并卸载本地版本后，再安装市场版本。')
      }
      if (localVersion && !options.confirmInstallation) throw new Error('此 App 包含本地修改，需要确认后才能安装市场版本。')
      const installation = runtime.getInstallation(appId)
      const previousVersion = installedEntry?.currentVersion || null
      const previousRuntimeVersion = installation?.activeVersion || null
      let previousManifest = installedEntry?.manifest || null
      try { previousManifest = (await runtime.getApp?.(appId))?.manifest || previousManifest } catch {}
      const previousCapabilitiesUnknown = Boolean((previousVersion || previousRuntimeVersion) && !previousManifest)
      if (!localVersion && installation?.activeVersion === version.version) {
        return { ok: true, alreadyInstalled: true, appId, version: version.version }
      }
      const installationSnapshot = (entry) => JSON.stringify([entry?.currentVersion, entry?.localModification])
      const initialInstallationSnapshot = installationSnapshot(installedEntry)
      const grantsSnapshot = JSON.stringify([...(installation?.grants || [])].sort())
      const assertInstallationUnchanged = async () => {
        const current = (await options.getInstalledApps()).find(entry => (entry.id || entry.name) === appId)
        if (JSON.stringify([...(runtime.getInstallation(appId)?.grants || [])].sort()) !== grantsSnapshot || installationSnapshot(current) !== initialInstallationSnapshot
          || (installationRevision !== undefined && options.getInstallationRevision(appId) !== installationRevision)) {
          throw new Error('此 App 的安装状态已变化，请重试安装市场版本。')
        }
      }
      const currentGrants = [...(installation?.grants || [])]
      const declaredPermissions = new Set(version.permissions)
      const retainedGrants = currentGrants.filter((permission) => declaredPermissions.has(permission))
      const addedPermissions = version.permissions.filter((permission) => !currentGrants.includes(permission))
      const grants = [...new Set([...retainedGrants, ...addedPermissions])]
      if (addedPermissions.length && !acceptPermissions && !options.confirmInstallation) {
        return { ok: false, requiresPermissionApproval: true, appId, version: version.version, permissions: addedPermissions }
      }

      report({ phase: 'downloading', version: version.version, receivedBytes: 0, totalBytes: version.artifact.size })
      const archive = await download(version.artifact.downloadUrl, {
        userAgent: 'Moss-AppMarket/1.0',
        maxBytes: MAX_APP_BYTES,
        onProgress: ({ receivedBytes }) => report({ phase: 'downloading', receivedBytes }),
      })
      report({ phase: 'verifying', receivedBytes: archive.length })
      if (version.artifact.size && archive.length !== version.artifact.size) {
        throw new Error(`App download size mismatch: ${appId}@${version.version}`)
      }
      const checksum = createHash('sha256').update(archive).digest('hex')
      if (checksum !== version.artifact.sha256) throw new Error(`App download checksum mismatch: ${appId}@${version.version}`)

      const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-market-app-'))
      const archivePath = path.join(temporaryRoot, version.artifact.fileName)
      let packageInstallStarted = false
      let activationCompleted = false
      let commitRevision
      try {
        await fsp.writeFile(archivePath, archive, { mode: 0o600 })
        const app = await archiveInstaller(runtime, archivePath, {
          onProgress: report,
          installPackage: async (packageRoot) => {
            report({ phase: 'validating' })
            const packageInfo = await packageValidator(packageRoot, { trustedPublishers, requireTrustedPublisher: true, platform })
            if (packageInfo.manifest.id !== appId || packageInfo.manifest.version !== version.version) {
              throw new Error(`Downloaded App identity mismatch: expected ${appId}@${version.version}`)
            }
            if (version.artifacts && (!packageInfo.manifest.platforms || packageInfo.manifest.platforms.length !== 1 || packageInfo.manifest.platforms[0] !== platform)) {
              throw new Error(`Downloaded App platform mismatch: expected ${platform}`)
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
            if (JSON.stringify([...(packageInfo.manifest.permissions || [])].sort()) !== JSON.stringify([...version.permissions].sort())) throw new Error('市场权限清单与安装包不一致，请联系发布者。')
            const pendingPermissions = options.confirmInstallation ? addedPermissions : acceptPermissions ? [] : addedPermissions
            const capabilityChange = previousCapabilitiesUnknown || appCapabilityDeclarationChanged(previousManifest, packageInfo.manifest)
            await assertInstallationUnchanged()
            if (localVersion || pendingPermissions.length || describeAppTools(packageInfo.manifest).length || packageInfo.manifest.contributes?.skills?.length
              || packageInfo.manifest.nativeAdapter || packageInfo.manifest.appCapabilities?.requires?.length
              || packageInfo.manifest.appCapabilities?.provides?.length
              || packageInfo.manifest.appCapabilities?.usesTools?.length || capabilityChange) {
              report({ phase: 'awaiting-permission' })
              if (!options.confirmInstallation) throw new Error('安装此 App 前需要确认其权限和能力')
              const replacementDetails = localVersion
                ? `当前使用的是本地修改版本 ${localVersion}。安装后将切换到市场版本 ${version.version}。\n本地版本及其源码会保留在版本历史中，可通过回滚重新使用；现有 App 配置和数据会保留。`
                : ''
              const previousCapabilities = previousCapabilitiesUnknown
                ? '无法读取原版本的跨 App 能力声明，请确认新版本的能力。'
                : describePreviousAppCapabilities(previousManifest, packageInfo.manifest)
              if (!await options.confirmInstallation(packageInfo.manifest, pendingPermissions,
                [replacementDetails, previousCapabilities, `安装包摘要：${packageReviewRevision(packageInfo)}`].filter(Boolean).join('\n\n'))) {
                throw Object.assign(new Error('App installation was canceled'), { code: INSTALL_CANCELED })
              }
            }
            await assertInstallationUnchanged()
            assertReviewedPackage(packageInfo, await packageValidator(packageRoot, { trustedPublishers, requireTrustedPublisher: true, platform }))
            report({ phase: 'installing' })
            packageInstallStarted = true
            return options.installPackage(packageRoot, {
              trustedPublishers,
              activateInstallation: app => options.emitChanged?.({ action: 'install', app, grants }),
              onCommit: state => { commitRevision = state.installationRevision },
              validateCommit: assertInstallationUnchanged, expectedPackageChecksums: packageInfo.checksums,
              requireTrustedPublisher: true,
              marketplaceSource: { catalogUrl: indexUrl, appId, version: version.version },
              ...(installationRevision !== undefined ? {
                expectedInstallationRevision: installationRevision,
                expectedBaseVersion: installedEntry?.currentVersion || null,
              } : {}),
            })
          },
        })
        report({ phase: 'activating' })
        await runtime.registerInstalled(appId, version.version, { grants })
        await options.emitChanged?.({ action: installation ? 'marketplace-updated' : 'marketplace-installed', appId })
        activationCompleted = true
        return { ok: true, appId, version: version.version, app }
      } catch (error) {
        if (packageInstallStarted && commitRevision !== undefined && !activationCompleted) {
          try {
            const restore = async () => {
              // A failed pre-commit install may have staged an immutable version,
              // but it did not replace the active registry entry.
              if (options.getInstallationRevision && options.getInstallationRevision(appId) !== commitRevision) return
              const published = (await options.getInstalledApps()).find(entry => (entry.id || entry.name) === appId)
              if (published?.currentVersion !== version.version) return
              const rolledBack = await options.rollbackPackage?.({ appId, previousVersion, failedVersion: version.version,
                expectedInstallationRevision: commitRevision })
              if (rolledBack !== true) return
              report({ phase: 'rolling-back' })
              // Commit owns the installation queue. Acquire the Runtime lock only
              // after that queue has finished, then check for another commit.
              const rollbackRevision = options.getInstallationRevision?.(appId)
              const restoreRuntime = async () => {
                if (rollbackRevision !== undefined && options.getInstallationRevision?.(appId) !== rollbackRevision) return false
                const currentPublished = (await options.getInstalledApps()).find(entry => (entry.id || entry.name) === appId)
                if ((currentPublished?.currentVersion || null) !== previousVersion) return false
                const current = runtime.getInstallation(appId)
                if (current?.activeVersion === version.version) {
                  // Publishing may activate the package before returning. Restore
                  // the previous grants when activation replaced them, while
                  // retaining grants changed after this installation started.
                  const activeGrants = current.grants || []
                  const grantsUnchanged = JSON.stringify([...activeGrants].sort()) === JSON.stringify([...grants].sort())
                  const restoreOptions = grantsUnchanged ? { grants: currentGrants } : {}
                  if (previousRuntimeVersion) await (runtime.registerInstalledNow || runtime.registerInstalled).call(runtime, appId, previousRuntimeVersion, restoreOptions)
                  else await (runtime.uninstallNow || runtime.uninstall).call(runtime, appId)
                }
                return true
              }
              const stillCurrent = runtime.transitionApp
                ? await runtime.transitionApp(appId, restoreRuntime) : await restoreRuntime()
              if (stillCurrent) await options.emitChanged?.({ action: 'marketplace-rollback', appId })
            }
            await restore()
          } catch (rollbackError) {
            throw new Error(`${error.message}; package registry rollback also failed: ${rollbackError.message}`)
          }
        }
        throw error
      } finally {
        await fsp.rm(temporaryRoot, { recursive: true, force: true })
      }
    })().then((result) => {
      if (result.ok) report({ phase: 'completed', version: result.version })
      return result
    }).catch((error) => {
      if (error?.code === INSTALL_CANCELED) {
        report({ phase: 'canceled' })
        return { ok: false, canceled: true, appId, version: progress.version }
      }
      report({ phase: 'error', error: error.message || String(error) })
      throw error
    }).finally(() => installLocks.delete(appId))
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
