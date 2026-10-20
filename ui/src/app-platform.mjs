import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import semver from 'semver'
import {
  AppPackageStore,
} from '../../packages/app-runtime/src/index.mjs'
import { APP_ERROR_CODES, validateAppManifest } from '../../packages/app-sdk/src/index.mjs'
import { MOSS_HOME } from './moss-home.mjs'

const execFileAsync = promisify(execFile)
export const APPS_DIR = path.join(MOSS_HOME, 'apps')
export const APP_REGISTRY_PATH = path.join(MOSS_HOME, 'app-registry.json')
const revisionsPath = path.join(MOSS_HOME, 'app-installation-revisions.json')
const installationQueues = new Map()
let listedRegistryCache = null
let activateInstallation = null
export function setAppInstallationActivation(handler) { activateInstallation = handler }
export function getAppInstallationRevision(appId) { return Number(readJsonFile(revisionsPath, {})[appId]) || 0 }
function advanceInstallationRevision(appId) {
  const revisions = readJsonFile(revisionsPath, {})
  revisions[appId] = (Number(revisions[appId]) || 0) + 1
  writeJsonFile(revisionsPath, revisions)
  return revisions[appId]
}

export const APP_KINDS = Object.freeze({ app: 'app' })

function now() { return Date.now() }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); return dir }
function readJsonFile(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return fallback }
}
function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath))
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}
function slugifyId(input) {
  return String(input || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}
function ensureInsideRoot(rootPath, targetPath) {
  const root = path.resolve(rootPath)
  const target = path.resolve(targetPath)
  const relative = path.relative(root, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path is outside the App package')
  return target
}
function readAppIconData(packageRoot, relativePath) {
  if (!relativePath) return ''
  const iconPath = ensureInsideRoot(packageRoot, path.join(packageRoot, relativePath))
  const extension = path.extname(iconPath).toLowerCase()
  const mime = ({
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  })[extension]
  if (!mime || !fs.existsSync(iconPath) || !fs.statSync(iconPath).isFile()) return ''
  return `data:${mime};base64,${fs.readFileSync(iconPath).toString('base64')}`
}
async function tarDirectory(sourceDir, outPath) {
  await fsp.rm(outPath, { force: true })
  try {
    await execFileAsync('tar', ['-czf', outPath, '-C', sourceDir, '.'], { maxBuffer: 20 * 1024 * 1024 })
    return true
  } catch { return false }
}

export function readAppRegistry() {
  const parsed = readJsonFile(APP_REGISTRY_PATH, {})
  return { version: 2, apps: Array.isArray(parsed?.apps) ? parsed.apps : [] }
}
export function writeAppRegistry(registry) {
  writeJsonFile(APP_REGISTRY_PATH, { version: 2, apps: Array.isArray(registry?.apps) ? registry.apps : [] })
  listedRegistryCache = null
}
export function upsertAppRegistryEntry(entry) {
  const registry = readAppRegistry()
  const existing = registry.apps.find((item) => item.id === entry.id)
  const apps = registry.apps.filter((item) => item.id !== entry.id)
  const next = { ...existing, ...entry, id: entry.id, kind: 'app', updatedAt: Number(entry.updatedAt) || now() }
  apps.push(next)
  apps.sort((a, b) => b.updatedAt - a.updatedAt)
  writeAppRegistry({ apps })
  return next
}
export function removeAppRegistryEntry(appId) {
  writeAppRegistry({ apps: readAppRegistry().apps.filter((item) => item.id !== appId) })
}

export function getAppRoot(appId) {
  const id = slugifyId(appId)
  if (!id) throw new Error('App id is required')
  return path.join(APPS_DIR, id)
}
export function getAppVersionDir(appId, version) {
  if (!semver.valid(String(version || ''))) throw new Error(`Invalid App version: ${version}`)
  return path.join(getAppRoot(appId), 'versions', version)
}
export function getAppCurrentPath(appId) { return path.join(getAppRoot(appId), 'current.json') }
export function readAppManifestFromDir(rootDir) {
  const manifestPath = path.join(rootDir, 'app.moss.json')
  const manifest = readJsonFile(manifestPath)
  if (!manifest) throw new Error(`Missing or invalid App manifest: ${manifestPath}`)
  return validateAppManifest(manifest)
}

export function listAppVersions(appId) {
  const versionsDir = path.join(getAppRoot(appId), 'versions')
  if (!fs.existsSync(versionsDir)) return []
  const current = readJsonFile(getAppCurrentPath(appId), {})?.version || null
  return fs.readdirSync(versionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && semver.valid(entry.name))
    .map((entry) => {
      const root = path.join(versionsDir, entry.name)
      const manifest = readJsonFile(path.join(root, 'app.moss.json'), {})
      const report = {
        ...readJsonFile(path.join(root, 'build-report.json'), {}),
        ...readJsonFile(path.join(getAppRoot(appId), 'version-metadata', `${entry.name}.json`), {}),
      }
      const stat = fs.statSync(root)
      return {
        id: entry.name,
        version: entry.name,
        createdAt: Number(report.completedAt || report.publishedAt) || stat.birthtimeMs || stat.ctimeMs,
        reason: String(report.reason || 'published'),
        note: String(report.note || ''),
        marketplaceSource: report.marketplaceSource || null,
        description: String(manifest.description || ''),
        width: Number(manifest.ui?.window?.width) || 1100,
        height: Number(manifest.ui?.window?.height) || 760,
        resizable: manifest.ui?.window?.resizable !== false,
        hasUi: Boolean(manifest.ui),
        hasBackend: Boolean(manifest.backend),
        isCurrent: entry.name === current,
        isLatest: false,
        kind: 'app',
        checksumStatus: fs.existsSync(path.join(root, 'checksums.json')) ? 'present' : 'missing',
      }
    })
    .sort((a, b) => semver.rcompare(a.version, b.version))
    .map((entry, index) => ({ ...entry, isLatest: index === 0 }))
}

function registryEntryFromPublished(published, previous = {}) {
  const versions = listAppVersions(published.id)
  const latest = versions[0]
  const metadata = readJsonFile(path.join(getAppRoot(published.id), 'version-metadata', `${published.version}.json`), {})
  return {
    ...previous,
    localModification: metadata.localModification || null,
    marketplaceSource: metadata.marketplaceSource || previous.marketplaceSource || null,
    id: published.id,
    name: published.id,
    kind: 'app',
    displayName: published.displayName,
    title: published.displayName,
    description: published.description,
    category: published.manifest.category,
    discovery: published.manifest.discovery,
    connectorApp: published.manifest.connectorApp,
    keywords: published.manifest.keywords,
    icon: published.icon,
    width: published.width,
    height: published.height,
    resizable: published.resizable,
    hasUi: Boolean(published.manifest.ui),
    hasSettings: Boolean(published.manifest.contributes?.settings?.length),
    navigation: published.manifest.navigation,
    uiContributes: { views: published.manifest.contributes?.views || [], settings: published.manifest.contributes?.settings || [] },
    hasBackend: Boolean(published.manifest.backend),
    backend: published.manifest.backend || null,
    permissions: published.manifest.permissions,
    createdAt: previous.createdAt || now(),
    updatedAt: now(),
    currentVersion: published.version,
    currentVersionId: published.version,
    latestVersion: latest?.version || published.version,
    latestVersionId: latest?.id || published.version,
    versionCount: versions.length,
    publishedVersion: published.version,
  }
}

export async function publishAppFromBuild(buildDir, options = {}) {
  const manifest = readAppManifestFromDir(buildDir)
  const previous = installationQueues.get(manifest.id) || Promise.resolve()
  const task = previous.then(() => publishAppFromBuildNow(buildDir, options), () => publishAppFromBuildNow(buildDir, options))
  installationQueues.set(manifest.id, task)
  try { return await task } finally { if (installationQueues.get(manifest.id) === task) installationQueues.delete(manifest.id) }
}

export function refreshAppRegistryFromCurrent(appId) {
  return upsertAppRegistryEntry(registryEntryFromPublished(
    getPublishedApp(appId), readAppRegistry().apps.find(item => item.id === appId),
  ))
}

async function publishAppFromBuildNow(buildDir, options = {}) {
  const resolvedBuildDir = path.resolve(buildDir)
  const validationOptions = {
    trustedPublishers: options.trustedPublishers,
    requireTrustedPublisher: options.requireTrustedPublisher,
  }
  const source = { root: resolvedBuildDir, manifest: readAppManifestFromDir(resolvedBuildDir) }
  const store = new AppPackageStore({ appsDir: APPS_DIR, ...validationOptions })
  const installedPackage = await store.installFromDirectory(source.root, validationOptions)
  if (options.expectedPackageChecksums && JSON.stringify(Object.entries(installedPackage.checksums).sort()) !== JSON.stringify(Object.entries(options.expectedPackageChecksums).sort())) throw new Error('Reviewed App package changed before commit')
  writeJsonFile(path.join(getAppRoot(source.manifest.id), 'version-metadata', `${source.manifest.version}.json`), {
    reason: options.reason || 'published',
    note: options.note || '',
    publishedAt: now(),
    localModification: options.localModification || null,
    ...(options.marketplaceSource ? { marketplaceSource: options.marketplaceSource, localModification: null } : {}),
  })
  // Modern packages retain their authoritative source in versions/<version>.
  // Preserve explicitly supplied legacy sources only; a runtime archive is not source.
  if (options.sourceRoot && !fs.existsSync(path.join(resolvedBuildDir, 'source-manifest.json'))) {
    await fsp.mkdir(path.join(getAppRoot(source.manifest.id), 'sources'), { recursive: true })
    await tarDirectory(path.resolve(options.sourceRoot), path.join(getAppRoot(source.manifest.id), 'sources', `${source.manifest.version}.tar.gz`))
  }
  await options.validateCommit?.(installedPackage)
  if (options.expectedInstallationRevision !== undefined
    && (getAppInstallationRevision(source.manifest.id) !== options.expectedInstallationRevision
      || (readJsonFile(getAppCurrentPath(source.manifest.id), {})?.version || null) !== options.expectedBaseVersion)) {
    throw Object.assign(new Error('App installation changed before commit'), { code: 'MOSS_APP_INSTALLATION_CHANGED' })
  }
  const installationRevision = advanceInstallationRevision(source.manifest.id)
  writeJsonFile(getAppCurrentPath(source.manifest.id), { version: source.manifest.version, installationRevision, updatedAt: now() })
  const published = getPublishedApp(source.manifest.id)
  const registryEntry = registryEntryFromPublished(
    published,
    readAppRegistry().apps.find((item) => item.id === source.manifest.id),
  )
  const entry = upsertAppRegistryEntry({
    ...registryEntry,
    ...(options.marketplaceSource ? { marketplaceSource: options.marketplaceSource, localModification: null } : {}),
    ...(options.localModification ? { localModification: options.localModification } : {}),
  })
  options.onCommit?.({ installationRevision, app: entry })
  const activate = options.activateInstallation || activateInstallation
  if (activate) await activate(entry)
  return entry
}

export function getPublishedApp(appId, version = null) {
  const currentVersion = version || readJsonFile(getAppCurrentPath(appId), {})?.version
  if (!currentVersion) throw new Error(`App has no active version: ${appId}`)
  const versionDir = getAppVersionDir(appId, currentVersion)
  const manifest = readAppManifestFromDir(versionDir)
  if (manifest.id !== appId || manifest.version !== currentVersion) {
    throw new Error(`Stored App package identity mismatch: expected ${appId}@${currentVersion}`)
  }
  const uiRoot = manifest.ui?.builtin === 'mcp'
    ? fileURLToPath(new URL('../dist/mcp-app/', import.meta.url)) : versionDir
  const entryRelativePath = manifest.ui?.builtin === 'mcp' ? 'index.html' : manifest.ui?.entry || null
  const entryPath = entryRelativePath ? ensureInsideRoot(uiRoot, path.join(uiRoot, entryRelativePath)) : null
  if (entryPath && !fs.existsSync(entryPath)) throw new Error(`App UI entry is missing: ${entryRelativePath}`)
  return {
    id: manifest.id,
    name: manifest.id,
    kind: 'app',
    displayName: manifest.displayName,
    title: manifest.displayName,
    description: manifest.description,
    category: manifest.category,
    discovery: manifest.discovery,
    connectorApp: manifest.connectorApp,
    keywords: manifest.keywords,
    icon: readAppIconData(versionDir, manifest.icon),
    width: manifest.ui?.window.width || 1100,
    height: manifest.ui?.window.height || 760,
    resizable: manifest.ui?.window.resizable !== false,
    version: currentVersion,
    versionDir,
    bundleRoot: uiRoot,
    entryRelativePath,
    filePath: entryPath,
    entryPath,
    manifest,
  }
}

export function listAppsFromRegistry() {
  const stat = fs.statSync(APP_REGISTRY_PATH, { throwIfNoEntry: false })
  const revision = `${stat?.mtimeMs || 0}:${stat?.size || 0}`
  if (listedRegistryCache?.revision === revision) return listedRegistryCache.apps.map(app => ({ ...app }))
  const apps = readAppRegistry().apps.flatMap((app) => {
    const currentVersion = readJsonFile(getAppCurrentPath(app.id), {})?.version || app.currentVersion || null
    if (!currentVersion) return []
    let published
    try {
      published = getPublishedApp(app.id, currentVersion)
    } catch (error) {
      const packageError = error instanceof Error ? error.message : String(error)
      let requiredHostApi = null
      try {
        const rawHostApi = readJsonFile(path.join(getAppVersionDir(app.id, currentVersion), 'app.moss.json'), {})?.hostApi
        requiredHostApi = typeof rawHostApi === 'string' ? rawHostApi : null
      } catch {}
      return [{
        ...app,
        id: app.id,
        name: app.id,
        kind: 'app',
        displayName: app.displayName || app.title || app.id,
        title: app.title || app.displayName || app.id,
        description: app.description || '',
        icon: app.icon || '',
        width: Number(app.width) || 1100,
        height: Number(app.height) || 760,
        resizable: app.resizable !== false,
        manifest: null,
        // Keep only display metadata for the same installed version; this never authorizes launch.
        navigation: app.currentVersion === currentVersion ? app.navigation : undefined,
        uiContributes: app.currentVersion === currentVersion ? app.uiContributes : undefined,
        filePath: null,
        entryPath: null,
        currentVersion,
        currentVersionId: currentVersion,
        latestVersion: app.latestVersion || currentVersion,
        latestVersionId: app.latestVersionId || currentVersion,
        versionCount: app.versionCount || 1,
        packageStatus: error?.code === APP_ERROR_CODES.incompatibleHost ? 'incompatible' : 'invalid',
        packageError,
        requiredHostApi,
      }]
    }
    return [{
      ...app,
      ...published,
      kind: 'app',
      name: app.id,
      currentVersion,
      currentVersionId: currentVersion,
      latestVersion: app.latestVersion || currentVersion,
      latestVersionId: app.latestVersionId || currentVersion,
      versionCount: app.versionCount || 1,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
      packageStatus: 'ready',
      packageError: null,
      requiredHostApi: published.manifest.hostApi,
    }]
  })
  listedRegistryCache = { revision, apps }
  return apps.map(app => ({ ...app }))
}

export function getAppRuntimeStatus(appId) {
  try { getPublishedApp(appId); return { state: 'stopped' } }
  catch (error) { return { state: 'error', error: error.message } }
}

export function rollbackAppToVersion(appId, version) {
  const versionDir = getAppVersionDir(appId, version)
  if (!fs.existsSync(versionDir)) throw new Error(`Unknown App version: ${version}`)
  writeJsonFile(getAppCurrentPath(appId), { version, installationRevision: advanceInstallationRevision(appId), updatedAt: now() })
  const published = getPublishedApp(appId, version)
  return upsertAppRegistryEntry(registryEntryFromPublished(
    published,
    readAppRegistry().apps.find((item) => item.id === appId),
  ))
}

export async function deleteApp(appId) {
  advanceInstallationRevision(appId)
  await fsp.rm(getAppRoot(appId), { recursive: true, force: true })
  removeAppRegistryEntry(appId)
}
