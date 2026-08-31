import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import semver from 'semver'
import {
  AppPackageStore,
  createPackageChecksums,
  validateAppPackage,
  writePackageChecksums,
} from '../../packages/app-runtime/src/index.mjs'
import { validateAppManifest } from '../../packages/app-sdk/src/index.mjs'

const execFileAsync = promisify(execFile)
const MOSS_HOME = path.join(os.homedir(), '.moss')
export const APPS_DIR = path.join(MOSS_HOME, 'apps')
export const APP_REGISTRY_PATH = path.join(MOSS_HOME, 'app-registry.json')
const WORKSPACE_APPS_SUBDIR = 'apps'
const BUILD_SUBDIR = 'build'

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
async function copyDir(source, destination) {
  await fsp.rm(destination, { recursive: true, force: true })
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  await fsp.cp(source, destination, { recursive: true, errorOnExist: true, force: false })
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
export function getWorkspaceAppDir(workspace, appId) { return path.join(workspace, WORKSPACE_APPS_SUBDIR, slugifyId(appId)) }
export function getAppWorkspaceBuildDir(workspace, appId) { return path.join(getWorkspaceAppDir(workspace, appId), BUILD_SUBDIR) }
export function getAppManifestPath(workspace, appId) { return path.join(getWorkspaceAppDir(workspace, appId), 'app.moss.json') }

export function validateAppManifestV2(rawManifest) { return validateAppManifest(rawManifest) }
export function readAppManifestFromWorkspace(workspace, appId) {
  const manifestPath = getAppManifestPath(workspace, appId)
  const manifest = readJsonFile(manifestPath)
  if (!manifest) throw new Error(`Missing or invalid App manifest: ${manifestPath}`)
  return validateAppManifest(manifest)
}
export function readAppManifestFromDir(rootDir) {
  const manifestPath = path.join(rootDir, 'app.moss.json')
  const manifest = readJsonFile(manifestPath)
  if (!manifest) throw new Error(`Missing or invalid App manifest: ${manifestPath}`)
  return validateAppManifest(manifest)
}

async function runPackageBuild(sourceRoot, report, options) {
  const packagePath = path.join(sourceRoot, 'package.json')
  if (!fs.existsSync(packagePath) || options.runPackageBuild === false) return
  const packageJson = readJsonFile(packagePath, {})
  if (!packageJson?.scripts?.build) return
  try {
    await execFileAsync('npm', ['run', 'build'], { cwd: sourceRoot, timeout: 120_000, maxBuffer: 20 * 1024 * 1024 })
    report.steps.push('npm run build completed')
  } catch (error) {
    report.errors.push(String(error.stderr || error.stdout || error.message))
    throw new Error('App build failed')
  }
}

async function materializeUiFallback(sourceRoot, manifest, report) {
  if (!manifest.ui) return
  const target = path.join(sourceRoot, manifest.ui.entry)
  if (fs.existsSync(target)) return
  const source = [path.join(sourceRoot, 'src/index.html'), path.join(sourceRoot, 'public/index.html'), path.join(sourceRoot, 'index.html')]
    .find((candidate) => fs.existsSync(candidate))
  if (!source) return
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await fsp.copyFile(source, target)
  report.warnings.push(`Used static UI fallback: ${path.relative(sourceRoot, source)}`)
}

export async function buildAppFromWorkspace(workspace, appId, options = {}) {
  const manifestPath = getAppManifestPath(workspace, appId)
  const sourceRoot = path.dirname(manifestPath)
  const manifest = readAppManifestFromWorkspace(workspace, appId)
  const artifactDir = getAppWorkspaceBuildDir(workspace, manifest.id)
  const temporary = `${artifactDir}.${randomUUID()}.tmp`
  const report = { ok: false, kind: 'app', appId: manifest.id, version: manifest.version, steps: [], warnings: [], errors: [] }
  await runPackageBuild(sourceRoot, report, options)
  await materializeUiFallback(sourceRoot, manifest, report)
  await fsp.rm(temporary, { recursive: true, force: true })
  await fsp.mkdir(temporary, { recursive: true })
  try {
    for (const directory of ['dist', 'schemas', 'assets']) {
      const source = path.join(sourceRoot, directory)
      if (fs.existsSync(source)) await fsp.cp(source, path.join(temporary, directory), { recursive: true })
    }
    await fsp.writeFile(path.join(temporary, 'app.moss.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    report.ok = true
    await fsp.writeFile(path.join(temporary, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`)
    await writePackageChecksums(temporary)
    await validateAppPackage(temporary)
    await fsp.rm(artifactDir, { recursive: true, force: true })
    await fsp.rename(temporary, artifactDir)
  } catch (error) {
    await fsp.rm(temporary, { recursive: true, force: true })
    throw error
  }
  return {
    ok: true,
    kind: 'app',
    appId: manifest.id,
    version: manifest.version,
    buildDir: artifactDir,
    filePath: manifest.ui ? path.join(artifactDir, manifest.ui.entry) : null,
    entry: manifest.ui ? path.join(artifactDir, manifest.ui.entry) : null,
    buildReportPath: path.join(artifactDir, 'build-report.json'),
    warnings: report.warnings,
  }
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

async function packageFingerprint(root) {
  const checksums = await createPackageChecksums(root)
  return createHash('sha256').update(JSON.stringify(checksums)).digest('hex')
}

function registryEntryFromPublished(published, previous = {}) {
  const versions = listAppVersions(published.id)
  const latest = versions[0]
  return {
    ...previous,
    id: published.id,
    name: published.id,
    kind: 'app',
    displayName: published.displayName,
    title: published.displayName,
    description: published.description,
    icon: published.icon,
    width: published.width,
    height: published.height,
    resizable: published.resizable,
    hasUi: Boolean(published.manifest.ui),
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
  const resolvedBuildDir = path.resolve(buildDir)
  const source = await validateAppPackage(resolvedBuildDir)
  const store = new AppPackageStore({ appsDir: APPS_DIR })
  await store.installFromDirectory(source.root)
  writeJsonFile(path.join(getAppRoot(source.manifest.id), 'version-metadata', `${source.manifest.version}.json`), {
    reason: options.reason || 'published',
    note: options.note || '',
    publishedAt: now(),
  })
  writeJsonFile(getAppCurrentPath(source.manifest.id), { version: source.manifest.version, updatedAt: now() })
  const sourceRoot = options.sourceRoot
    ? path.resolve(options.sourceRoot)
    : path.dirname(path.resolve(buildDir))
  await fsp.mkdir(path.join(getAppRoot(source.manifest.id), 'sources'), { recursive: true })
  await tarDirectory(sourceRoot, path.join(getAppRoot(source.manifest.id), 'sources', `${source.manifest.version}.tar.gz`))
  const published = getPublishedApp(source.manifest.id)
  return upsertAppRegistryEntry(registryEntryFromPublished(
    published,
    readAppRegistry().apps.find((item) => item.id === source.manifest.id),
  ))
}

export async function installBuiltInAppFromBuild(buildDir, options = {}) {
  const source = await validateAppPackage(path.resolve(buildDir))
  const versions = listAppVersions(source.manifest.id)
  const existing = versions.find((item) => item.version === source.manifest.version)
  if (existing) {
    const currentFingerprint = await packageFingerprint(getAppVersionDir(source.manifest.id, existing.version))
    if (currentFingerprint !== await packageFingerprint(source.root)) {
      throw new Error(`Bundled App version ${source.manifest.version} is immutable and has different contents`)
    }
    if (!readJsonFile(getAppCurrentPath(source.manifest.id), {})?.version) {
      writeJsonFile(getAppCurrentPath(source.manifest.id), { version: existing.version, updatedAt: now() })
    }
    const published = getPublishedApp(source.manifest.id)
    const app = upsertAppRegistryEntry(registryEntryFromPublished(
      published,
      readAppRegistry().apps.find((item) => item.id === source.manifest.id),
    ))
    return { ...app, skipped: true }
  }
  return publishAppFromBuild(source.root, { ...options, reason: options.reason || 'installed', note: options.note || 'bundled' })
}

export function getPublishedApp(appId, version = null) {
  const currentVersion = version || readJsonFile(getAppCurrentPath(appId), {})?.version
  if (!currentVersion) throw new Error(`App has no active version: ${appId}`)
  const versionDir = getAppVersionDir(appId, currentVersion)
  const manifest = readAppManifestFromDir(versionDir)
  if (manifest.id !== appId || manifest.version !== currentVersion) {
    throw new Error(`Stored App package identity mismatch: expected ${appId}@${currentVersion}`)
  }
  const entryPath = manifest.ui ? ensureInsideRoot(versionDir, path.join(versionDir, manifest.ui.entry)) : null
  if (entryPath && !fs.existsSync(entryPath)) throw new Error(`App UI entry is missing: ${manifest.ui.entry}`)
  return {
    id: manifest.id,
    name: manifest.id,
    kind: 'app',
    displayName: manifest.displayName,
    title: manifest.displayName,
    description: manifest.description,
    icon: readAppIconData(versionDir, manifest.icon),
    width: manifest.ui?.window.width || 1100,
    height: manifest.ui?.window.height || 760,
    resizable: manifest.ui?.window.resizable !== false,
    version: currentVersion,
    versionDir,
    bundleRoot: versionDir,
    entryRelativePath: manifest.ui?.entry || null,
    filePath: entryPath,
    entryPath,
    manifest,
  }
}

export function listAppsFromRegistry() {
  return readAppRegistry().apps.flatMap((app) => {
    const versions = listAppVersions(app.id)
    const current = versions.find((item) => item.isCurrent) || null
    const currentVersion = current?.version || app.currentVersion || null
    if (!currentVersion) return []
    let published
    try {
      published = getPublishedApp(app.id, currentVersion)
    } catch {
      return []
    }
    return [{
      ...app,
      ...published,
      kind: 'app',
      name: app.id,
      currentVersion,
      currentVersionId: current?.id || currentVersion,
      latestVersion: versions[0]?.version || app.latestVersion || null,
      latestVersionId: versions[0]?.id || app.latestVersionId || null,
      versionCount: versions.length,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    }]
  })
}

export function getAppRuntimeStatus(appId) {
  try { getPublishedApp(appId); return { state: 'stopped' } }
  catch (error) { return { state: 'error', error: error.message } }
}

export function rollbackAppToVersion(appId, version) {
  const versionDir = getAppVersionDir(appId, version)
  if (!fs.existsSync(versionDir)) throw new Error(`Unknown App version: ${version}`)
  writeJsonFile(getAppCurrentPath(appId), { version, updatedAt: now() })
  const published = getPublishedApp(appId, version)
  return upsertAppRegistryEntry(registryEntryFromPublished(
    published,
    readAppRegistry().apps.find((item) => item.id === appId),
  ))
}

export async function deleteApp(appId) {
  await fsp.rm(getAppRoot(appId), { recursive: true, force: true })
  removeAppRegistryEntry(appId)
}

export async function extractAppToWorkspace(appId, sessionRecord, version = null) {
  if (!sessionRecord?.workspace) throw new Error('Session workspace is required for App extraction')
  const published = getPublishedApp(appId, version)
  const destination = getWorkspaceAppDir(sessionRecord.workspace, appId)
  await fsp.rm(destination, { recursive: true, force: true })
  await fsp.mkdir(destination, { recursive: true })
  const sourceTar = path.join(getAppRoot(appId), 'sources', `${published.version}.tar.gz`)
  if (fs.existsSync(sourceTar)) {
    await execFileAsync('tar', ['-xzf', sourceTar, '-C', destination], { maxBuffer: 20 * 1024 * 1024 })
  } else {
    for (const item of ['dist', 'schemas', 'assets', 'app.moss.json']) {
      const source = path.join(published.versionDir, item)
      if (fs.existsSync(source)) await fsp.cp(source, path.join(destination, item), { recursive: true })
    }
  }
  return {
    app: { id: appId, name: appId, kind: 'app', title: published.displayName, displayName: published.displayName, currentVersion: published.version, extractedVersion: published.version },
    metadataPath: path.join(destination, 'app.moss.json'),
    htmlPath: published.manifest.ui ? path.join(destination, published.manifest.ui.entry) : null,
  }
}

export function createDefaultAppManifest({ id, displayName, description = '' }) {
  const appId = slugifyId(id || displayName || `app-${randomUUID().slice(0, 8)}`)
  return {
    schemaVersion: 2,
    id: appId,
    version: '0.1.0',
    displayName: displayName || appId,
    description,
    hostApi: '^1.0.0',
    ui: { entry: 'dist/ui/index.html', window: { width: 1100, height: 760, resizable: true } },
    permissions: [],
  }
}
