import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import semver from 'semver'

const execFileAsync = promisify(execFile)

const MOSS_HOME = path.join(os.homedir(), '.moss')
export const APPS_DIR = path.join(MOSS_HOME, 'apps')
export const PLUGIN_APPS_DIR = APPS_DIR
export const APP_REGISTRY_PATH = path.join(MOSS_HOME, 'app-registry.json')
export const EXTENSIONS_DIR = path.join(MOSS_HOME, 'extensions')
const WORKSPACE_APPS_SUBDIR = 'apps'
const PLUGIN_BUILD_SUBDIR = 'build'

export const APP_KINDS = Object.freeze({
  pluginApp: 'plugin-app',
})

function now() {
  return Date.now()
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function slugifyId(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function ensureRelativeSafe(relativePath, fieldName) {
  const value = String(relativePath || '').trim()
  if (!value) throw new Error(`${fieldName} is required`)
  const normalized = path.normalize(value)
  if (!normalized || normalized === '.' || path.isAbsolute(normalized) || normalized.startsWith('..')) {
    throw new Error(`${fieldName} must be a relative path inside the app bundle`)
  }
  return normalized
}

function ensureInsideRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath)
  const resolvedTarget = path.resolve(targetPath)
  const relative = path.relative(resolvedRoot, resolvedTarget)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path is outside the allowed root.')
  }
  return resolvedTarget
}

function sha256File(filePath) {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return `sha256-${hash.digest('base64')}`
}

function listFilesRecursive(rootDir) {
  const result = []
  if (!fs.existsSync(rootDir)) return result
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(fullPath)
      } else if (entry.isFile()) {
        result.push(fullPath)
      }
    }
  }
  visit(rootDir)
  return result.sort()
}

async function copyDir(src, dest) {
  await fsp.rm(dest, { recursive: true, force: true })
  await fsp.mkdir(dest, { recursive: true })
  await fsp.cp(src, dest, { recursive: true })
}

async function tarDirectory(sourceDir, outPath) {
  await fsp.rm(outPath, { force: true })
  try {
    await execFileAsync('tar', ['-czf', outPath, '-C', sourceDir, '.'], {
      maxBuffer: 10 * 1024 * 1024,
    })
    return true
  } catch {
    return false
  }
}

export function readAppRegistry() {
  const parsed = readJsonFile(APP_REGISTRY_PATH, { version: 1, apps: [] })
  return {
    version: 1,
    apps: Array.isArray(parsed?.apps) ? parsed.apps : [],
  }
}

export function writeAppRegistry(registry) {
  writeJsonFile(APP_REGISTRY_PATH, {
    version: 1,
    apps: Array.isArray(registry?.apps) ? registry.apps : [],
  })
}

export function upsertAppRegistryEntry(entry) {
  const registry = readAppRegistry()
  const apps = registry.apps.filter(app => app.id !== entry.id)
  apps.push({
    ...entry,
    updatedAt: Number(entry.updatedAt) || now(),
  })
  apps.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  writeAppRegistry({ version: 1, apps })
  return entry
}

export function removeAppRegistryEntry(id) {
  const registry = readAppRegistry()
  writeAppRegistry({
    version: 1,
    apps: registry.apps.filter(app => app.id !== id),
  })
}

export function getPluginAppRoot(appId) {
  const normalizedId = slugifyId(appId)
  if (!normalizedId) throw new Error('App id is required')
  return path.join(APPS_DIR, normalizedId)
}

export function getPluginAppVersionDir(appId, version) {
  return path.join(getPluginAppRoot(appId), 'versions', version)
}

export function getPluginAppCurrentPath(appId) {
  return path.join(getPluginAppRoot(appId), 'current.json')
}

export function getWorkspacePluginAppDir(workspace, appId) {
  const normalizedId = slugifyId(appId)
  if (!normalizedId) throw new Error('App name/id is required for workspace paths')
  return path.join(workspace, WORKSPACE_APPS_SUBDIR, normalizedId)
}

export function getPluginAppWorkspaceBuildDir(workspace, appId) {
  if (appId) return path.join(getWorkspacePluginAppDir(workspace, appId), PLUGIN_BUILD_SUBDIR)
  throw new Error('App name/id is required for workspace build paths')
}

export function getPluginAppManifestPath(workspace, appId) {
  if (appId) {
    const nextPath = path.join(getWorkspacePluginAppDir(workspace, appId), 'app.moss.json')
    if (fs.existsSync(nextPath)) return nextPath
    return nextPath
  }
  throw new Error('App name/id is required for manifest lookup')
}

export function validatePluginAppManifest(rawManifest) {
  const errors = []
  const manifest = rawManifest && typeof rawManifest === 'object' ? rawManifest : {}
  const id = slugifyId(manifest.id)
  if (!id) errors.push('id is required and must contain a-z, 0-9, dot, underscore, or dash')
  if (manifest.kind !== APP_KINDS.pluginApp) errors.push('kind must be "plugin-app"')
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  const entry = String(manifest.entry || '').trim()
  if (!entry) errors.push('entry is required')
  else {
    try {
      ensureRelativeSafe(entry, 'entry')
    } catch (error) {
      errors.push(error.message)
    }
  }
  if (!manifest.displayName && !manifest.name) errors.push('displayName is required')
  const deps = manifest.extensionDependencies || {}
  if (deps && (typeof deps !== 'object' || Array.isArray(deps))) errors.push('extensionDependencies must be an object')
  const capabilities = manifest.capabilities || {}
  if (capabilities && (typeof capabilities !== 'object' || Array.isArray(capabilities))) errors.push('capabilities must be an object')

  if (errors.length > 0) {
    const error = new Error(`Invalid app.moss.json: ${errors.join('; ')}`)
    error.validationErrors = errors
    throw error
  }

  return {
    schemaVersion: 1,
    id,
    kind: APP_KINDS.pluginApp,
    displayName: String(manifest.displayName || manifest.name || id).trim(),
    description: String(manifest.description || '').trim(),
    icon: String(manifest.icon || '').trim(),
    entry: ensureRelativeSafe(entry, 'entry'),
    window: {
      width: Number(manifest.window?.width) || Number(manifest.width) || 900,
      height: Number(manifest.window?.height) || Number(manifest.height) || 700,
      resizable: manifest.window?.resizable !== false && manifest.resizable !== false,
    },
    capabilities,
    extensionDependencies: deps || {},
  }
}

export function readPluginAppManifestFromWorkspace(workspace, appId = '') {
  const manifestPath = getPluginAppManifestPath(workspace, appId)
  const parsed = readJsonFile(manifestPath)
  if (!parsed) throw new Error(`Missing or invalid app manifest: ${manifestPath}`)
  return validatePluginAppManifest(parsed)
}

export function readPluginAppManifestFromDir(rootDir) {
  const manifestPath = path.join(rootDir, 'app.moss.json')
  const parsed = readJsonFile(manifestPath)
  if (!parsed) throw new Error(`Missing or invalid app manifest: ${manifestPath}`)
  return validatePluginAppManifest(parsed)
}

export function listInstalledExtensions() {
  const extensions = []
  if (!fs.existsSync(EXTENSIONS_DIR)) return extensions
  for (const idEntry of fs.readdirSync(EXTENSIONS_DIR, { withFileTypes: true })) {
    if (!idEntry.isDirectory()) continue
    const extensionId = idEntry.name
    const idDir = path.join(EXTENSIONS_DIR, extensionId)
    for (const versionEntry of fs.readdirSync(idDir, { withFileTypes: true })) {
      if (!versionEntry.isDirectory()) continue
      const root = path.join(idDir, versionEntry.name)
      const manifest = readJsonFile(path.join(root, 'extension.moss.json'))
      if (!manifest) continue
      extensions.push({
        id: String(manifest.id || extensionId),
        version: String(manifest.version || versionEntry.name),
        root,
        manifest,
      })
    }
  }
  return extensions
}

export function resolveExtensionDependencies(dependencies = {}) {
  const installed = listInstalledExtensions()
  const lock = {}
  const warnings = []

  for (const [extensionId, range] of Object.entries(dependencies || {})) {
    const candidates = installed
      .filter(ext => ext.id === extensionId && semver.valid(ext.version))
      .filter(ext => semver.satisfies(ext.version, String(range || '*')))
      .sort((a, b) => semver.rcompare(a.version, b.version))
    const selected = candidates[0]
    if (!selected) {
      warnings.push(`Missing extension ${extensionId}@${range}`)
      continue
    }
    const manifestPath = path.join(selected.root, 'extension.moss.json')
    lock[extensionId] = {
      version: selected.version,
      root: selected.root,
      integrity: fs.existsSync(manifestPath) ? sha256File(manifestPath) : null,
    }
  }

  return { lock, warnings }
}

function detectPluginAppDist(buildRoot) {
  const candidates = [
    path.join(buildRoot, 'dist'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate
  }
  return null
}

async function runPackageBuild(buildRoot, report, options = {}) {
  const packagePath = path.join(buildRoot, 'package.json')
  if (!fs.existsSync(packagePath)) {
    report.warnings.push('package.json not found; using existing dist or static src/public HTML fallback')
    return
  }
  if (options.runPackageBuild === false) {
    report.warnings.push('package.json found; skipped package build for startup initialization')
    return
  }
  const pkg = readJsonFile(packagePath, {})
  if (!pkg?.scripts?.build) {
    report.warnings.push('package.json has no build script; using existing dist or static src/public HTML fallback')
    return
  }
  try {
    await execFileAsync('npm', ['run', 'build'], {
      cwd: buildRoot,
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    })
    report.steps.push('npm run build completed')
  } catch (error) {
    report.errors.push(`npm run build failed: ${error.stderr || error.stdout || error.message}`)
    throw new Error('App frontend build failed')
  }
}

async function materializeFallbackDist(buildRoot, distDir, report) {
  const candidates = [
    path.join(buildRoot, 'src', 'index.html'),
    path.join(buildRoot, 'public', 'index.html'),
    path.join(buildRoot, 'index.html'),
  ]
  const sourceHtml = candidates.find(candidate => fs.existsSync(candidate))
  if (!sourceHtml) {
    throw new Error('No dist directory or fallback index.html found for App')
  }
  await fsp.rm(distDir, { recursive: true, force: true })
  await fsp.mkdir(distDir, { recursive: true })
  await fsp.copyFile(sourceHtml, path.join(distDir, 'index.html'))
  report.warnings.push(`Used static HTML fallback: ${path.relative(buildRoot, sourceHtml)}`)
}

function validatePluginAppEntryHtml(entryPath, report) {
  const html = fs.readFileSync(entryPath, 'utf8')
  if (!html.trim()) {
    throw new Error('Built entry is empty: dist/index.html')
  }
  if (!/<body[\s>]/i.test(html)) {
    throw new Error('Built entry must include a <body> element')
  }
  const hasScript = /<script\b/i.test(html)
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)
  const bodyText = String(bodyMatch?.[1] || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, '')
    .trim()
  const hasRootMount = /\bid=["']root["']/i.test(html) || /\bid=["']app["']/i.test(html)
  if (!hasScript && !bodyText && !hasRootMount) {
    throw new Error('Built entry has no visible content or script mount point')
  }
  if (hasRootMount && !hasScript) {
    report.warnings.push('Built entry has a root mount point but no script tag; the app may render blank')
  }
}

export async function buildPluginAppFromWorkspace(workspace, appId = '', options = {}) {
  const manifest = readPluginAppManifestFromWorkspace(workspace, appId)
  const manifestPath = getPluginAppManifestPath(workspace, appId || manifest.id)
  const buildRoot = path.dirname(manifestPath)
  const artifactDir = getPluginAppWorkspaceBuildDir(workspace, manifest.id)
  const report = {
    ok: false,
    kind: APP_KINDS.pluginApp,
    appId: manifest.id,
    startedAt: now(),
    completedAt: null,
    steps: [],
    warnings: [],
    errors: [],
  }

  await runPackageBuild(buildRoot, report, options)

  await fsp.rm(artifactDir, { recursive: true, force: true })
  await fsp.mkdir(artifactDir, { recursive: true })

  let sourceDist = detectPluginAppDist(buildRoot)
  if (!sourceDist) {
    sourceDist = path.join(artifactDir, 'dist')
    await materializeFallbackDist(buildRoot, sourceDist, report)
  }

  const artifactDist = path.join(artifactDir, 'dist')
  if (path.resolve(sourceDist) !== path.resolve(artifactDist)) {
    await copyDir(sourceDist, artifactDist)
  }

  const entryPath = ensureInsideRoot(artifactDir, path.join(artifactDir, manifest.entry))
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Built entry does not exist: ${manifest.entry}`)
  }
  validatePluginAppEntryHtml(entryPath, report)

  const { lock, warnings } = resolveExtensionDependencies(manifest.extensionDependencies)
  report.warnings.push(...warnings)
  if (warnings.length > 0) {
    report.errors.push(...warnings)
    report.completedAt = now()
    await fsp.mkdir(artifactDir, { recursive: true })
    writeJsonFile(path.join(artifactDir, 'build-report.json'), report)
    throw new Error(`App extension dependencies are not satisfied: ${warnings.join('; ')}`)
  }

  const checksums = {}
  for (const filePath of listFilesRecursive(artifactDist)) {
    checksums[path.relative(artifactDir, filePath)] = sha256File(filePath)
  }

  writeJsonFile(path.join(artifactDir, 'app.moss.json'), manifest)
  writeJsonFile(path.join(artifactDir, 'extension-lock.json'), lock)
  writeJsonFile(path.join(artifactDir, 'checksums.json'), checksums)
  report.ok = true
  report.completedAt = now()
  writeJsonFile(path.join(artifactDir, 'build-report.json'), report)

  return {
    ok: true,
    kind: APP_KINDS.pluginApp,
    appId: manifest.id,
    buildDir: artifactDir,
    filePath: entryPath,
    entry: entryPath,
    extensionLockPath: path.join(artifactDir, 'extension-lock.json'),
    buildReportPath: path.join(artifactDir, 'build-report.json'),
    warnings: report.warnings,
  }
}

function getNextVersion(existingVersions) {
  const patch = existingVersions
    .map(version => semver.valid(version) ? semver.parse(version).patch : 0)
    .reduce((max, value) => Math.max(max, value), 0) + 1
  return `0.0.${patch}`
}

export function listPluginAppVersions(appId) {
  const versionsDir = path.join(getPluginAppRoot(appId), 'versions')
  if (!fs.existsSync(versionsDir)) return []
  const current = readJsonFile(getPluginAppCurrentPath(appId), {})?.version || null
  return fs.readdirSync(versionsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const version = entry.name
      const dir = path.join(versionsDir, version)
      const manifest = readJsonFile(path.join(dir, 'app.moss.json'), {})
      const report = readJsonFile(path.join(dir, 'build-report.json'), {})
      const stat = fs.statSync(dir)
      return {
        id: version,
        version,
        createdAt: Number(report.completedAt) || stat.birthtimeMs || stat.ctimeMs || now(),
        reason: String(report.reason || 'published'),
        note: String(report.note || ''),
        description: String(manifest.description || ''),
        width: Number(manifest.window?.width) || 900,
        height: Number(manifest.window?.height) || 700,
        resizable: manifest.window?.resizable !== false,
        isCurrent: version === current,
        isLatest: false,
        kind: APP_KINDS.pluginApp,
        extensionLock: readJsonFile(path.join(dir, 'extension-lock.json'), {}),
        checksumStatus: fs.existsSync(path.join(dir, 'checksums.json')) ? 'present' : 'missing',
      }
    })
    .sort((a, b) => semver.rcompare(a.version, b.version))
    .map((entry, index) => ({ ...entry, isLatest: index === 0 }))
}

function readBuildFingerprint(buildDir) {
  const fingerprint = {
    manifest: readJsonFile(path.join(buildDir, 'app.moss.json'), {}),
    checksums: readJsonFile(path.join(buildDir, 'checksums.json'), {}),
    extensionLock: readJsonFile(path.join(buildDir, 'extension-lock.json'), {}),
  }
  return createHash('sha256')
    .update(JSON.stringify(fingerprint))
    .digest('hex')
}

function getPublishedAppFingerprint(appId, version) {
  try {
    return readBuildFingerprint(getPluginAppVersionDir(appId, version))
  } catch {
    return ''
  }
}

export async function publishPluginAppFromBuild(buildDir, options = {}) {
  const resolvedBuildDir = path.resolve(buildDir)
  const manifest = readPluginAppManifestFromDir(resolvedBuildDir)
  const distDir = path.join(resolvedBuildDir, 'dist')
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    throw new Error(`App build is missing dist directory: ${resolvedBuildDir}`)
  }
  const versions = listPluginAppVersions(manifest.id).map(entry => entry.version)
  const version = getNextVersion(versions)
  const versionDir = getPluginAppVersionDir(manifest.id, version)
  const report = readJsonFile(path.join(resolvedBuildDir, 'build-report.json'), {})
  report.reason = options.reason || 'published'
  report.note = options.note || ''
  report.publishedAt = now()
  report.version = version

  await fsp.rm(versionDir, { recursive: true, force: true })
  await fsp.mkdir(versionDir, { recursive: true })
  await copyDir(distDir, path.join(versionDir, 'dist'))
  for (const file of ['app.moss.json', 'extension-lock.json', 'checksums.json']) {
    await fsp.copyFile(path.join(resolvedBuildDir, file), path.join(versionDir, file))
  }
  writeJsonFile(path.join(versionDir, 'build-report.json'), report)

  const sourceTarPath = path.join(versionDir, 'source.tar.gz')
  const buildRoot = path.dirname(resolvedBuildDir)
  await tarDirectory(buildRoot, sourceTarPath)

  writeJsonFile(getPluginAppCurrentPath(manifest.id), { version, updatedAt: now() })
  const app = {
    id: manifest.id,
    name: manifest.id,
    kind: APP_KINDS.pluginApp,
    displayName: manifest.displayName,
    title: manifest.displayName,
    description: options.description || manifest.description,
    icon: manifest.icon,
    width: manifest.window.width,
    height: manifest.window.height,
    resizable: manifest.window.resizable,
    createdAt: now(),
    updatedAt: now(),
    currentVersion: version,
    currentVersionId: version,
    latestVersion: version,
    latestVersionId: version,
    versionCount: versions.length + 1,
    publishedVersion: version,
    extensionDependencies: manifest.extensionDependencies,
    capabilitySummary: Object.keys(manifest.capabilities || {}),
    runtimeStatus: { state: 'ready' },
  }
  upsertAppRegistryEntry(app)
  return app
}

export async function installBuiltInAppFromBuild(buildDir, options = {}) {
  const resolvedBuildDir = path.resolve(buildDir)
  const manifest = readPluginAppManifestFromDir(resolvedBuildDir)
  const fingerprint = readBuildFingerprint(resolvedBuildDir)
  const versions = listPluginAppVersions(manifest.id)
  const existingVersion = versions.find(version =>
    getPublishedAppFingerprint(manifest.id, version.version) === fingerprint
  )

  if (existingVersion) {
    const existingEntry = readAppRegistry().apps.find(app => app.id === manifest.id) || {}
    let currentVersion = readJsonFile(getPluginAppCurrentPath(manifest.id), {})?.version || ''
    if (!currentVersion) {
      currentVersion = existingVersion.version
      writeJsonFile(getPluginAppCurrentPath(manifest.id), {
        version: currentVersion,
        updatedAt: now(),
      })
    }
    const published = getPublishedPluginApp(manifest.id, currentVersion)
    const app = {
      id: manifest.id,
      name: manifest.id,
      kind: APP_KINDS.pluginApp,
      displayName: published.displayName,
      title: published.displayName,
      description: options.description || published.description,
      icon: published.icon,
      width: published.width,
      height: published.height,
      resizable: published.resizable,
      createdAt: Number(existingEntry.createdAt) || now(),
      updatedAt: now(),
      currentVersion,
      currentVersionId: currentVersion,
      latestVersion: versions[0]?.version || existingVersion.version,
      latestVersionId: versions[0]?.id || existingVersion.version,
      versionCount: versions.length,
      publishedVersion: currentVersion,
      extensionDependencies: published.manifest.extensionDependencies,
      capabilitySummary: Object.keys(published.manifest.capabilities || {}),
      runtimeStatus: getPluginAppRuntimeStatus(manifest.id),
    }
    upsertAppRegistryEntry(app)
    return { ...app, skipped: true }
  }

  return publishPluginAppFromBuild(resolvedBuildDir, {
    description: options.description || manifest.description,
    reason: options.reason || 'installed',
    note: options.note || 'bundled',
  })
}

export function getPublishedPluginApp(appId, version = null) {
  const currentVersion = version || readJsonFile(getPluginAppCurrentPath(appId), {})?.version
  if (!currentVersion) throw new Error(`App has no current version: ${appId}`)
  const versionDir = getPluginAppVersionDir(appId, currentVersion)
  const manifest = readPluginAppManifestFromDir(versionDir)
  const entryPath = ensureInsideRoot(versionDir, path.join(versionDir, manifest.entry))
  if (!fs.existsSync(entryPath)) throw new Error(`App entry missing: ${manifest.entry}`)
  return {
    id: manifest.id,
    name: manifest.id,
    kind: APP_KINDS.pluginApp,
    displayName: manifest.displayName,
    title: manifest.displayName,
    description: manifest.description,
    icon: manifest.icon,
    width: manifest.window.width,
    height: manifest.window.height,
    resizable: manifest.window.resizable,
    version: currentVersion,
    versionDir,
    filePath: entryPath,
    entryPath,
    manifest,
    extensionLock: readJsonFile(path.join(versionDir, 'extension-lock.json'), {}),
  }
}

export function listPluginAppsFromRegistry() {
  const registry = readAppRegistry()
  return registry.apps
    .filter(app => app.kind === APP_KINDS.pluginApp)
    .map(app => {
      const versions = listPluginAppVersions(app.id)
      const current = versions.find(version => version.isCurrent) || versions[0] || null
      const latest = versions[0] || null
      return {
        ...app,
        name: app.id,
        title: app.displayName || app.title || app.id,
        currentVersion: current?.version || app.currentVersion || null,
        currentVersionId: current?.id || app.currentVersionId || null,
        latestVersion: latest?.version || app.latestVersion || null,
        latestVersionId: latest?.id || app.latestVersionId || null,
        versionCount: versions.length,
        runtimeStatus: getPluginAppRuntimeStatus(app.id),
      }
    })
}

export function getPluginAppRuntimeStatus(appId) {
  try {
    const published = getPublishedPluginApp(appId)
    const missing = Object.entries(published.manifest.extensionDependencies || {})
      .filter(([extensionId]) => !published.extensionLock?.[extensionId])
      .map(([extensionId]) => extensionId)
    if (missing.length > 0) {
      return { state: 'missing-extension', missingExtensions: missing }
    }
    return { state: 'ready' }
  } catch (error) {
    return { state: 'error', error: error.message }
  }
}

export function rollbackPluginAppToVersion(appId, version) {
  const versionDir = getPluginAppVersionDir(appId, version)
  if (!fs.existsSync(versionDir)) throw new Error(`Unknown App version: ${version}`)
  writeJsonFile(getPluginAppCurrentPath(appId), { version, updatedAt: now() })
  const published = getPublishedPluginApp(appId, version)
  const versions = listPluginAppVersions(appId)
  const app = {
    id: appId,
    name: appId,
    kind: APP_KINDS.pluginApp,
    displayName: published.displayName,
    title: published.displayName,
    description: published.description,
    icon: published.icon,
    width: published.width,
    height: published.height,
    resizable: published.resizable,
    updatedAt: now(),
    currentVersion: version,
    currentVersionId: version,
    latestVersion: versions[0]?.version || version,
    latestVersionId: versions[0]?.id || version,
    versionCount: versions.length,
    extensionDependencies: published.manifest.extensionDependencies,
    capabilitySummary: Object.keys(published.manifest.capabilities || {}),
    runtimeStatus: getPluginAppRuntimeStatus(appId),
  }
  upsertAppRegistryEntry(app)
  return app
}

export async function deletePluginApp(appId) {
  await fsp.rm(getPluginAppRoot(appId), { recursive: true, force: true })
  removeAppRegistryEntry(appId)
}

export async function extractPluginAppToWorkspace(appId, sessionRecord, version = null) {
  if (!sessionRecord?.workspace) throw new Error('Session workspace is required for App extraction')
  const published = getPublishedPluginApp(appId, version)
  const buildRoot = getWorkspacePluginAppDir(sessionRecord.workspace, appId)
  await fsp.rm(buildRoot, { recursive: true, force: true })
  await fsp.mkdir(buildRoot, { recursive: true })

  const sourceTar = path.join(published.versionDir, 'source.tar.gz')
  if (fs.existsSync(sourceTar)) {
    try {
      await execFileAsync('tar', ['-xzf', sourceTar, '-C', buildRoot], { maxBuffer: 10 * 1024 * 1024 })
    } catch {
      await copyDir(path.join(published.versionDir, 'dist'), path.join(buildRoot, 'dist'))
    }
  } else {
    await copyDir(path.join(published.versionDir, 'dist'), path.join(buildRoot, 'dist'))
  }
  await fsp.copyFile(path.join(published.versionDir, 'app.moss.json'), path.join(buildRoot, 'app.moss.json'))
  const htmlCandidates = [
    path.join(buildRoot, 'src', 'index.html'),
    path.join(buildRoot, 'public', 'index.html'),
    path.join(buildRoot, 'index.html'),
    path.join(buildRoot, published.manifest.entry),
    path.join(buildRoot, PLUGIN_BUILD_SUBDIR, published.manifest.entry),
  ]
  const htmlPath = htmlCandidates.find(candidate => fs.existsSync(candidate)) ||
    path.join(buildRoot, published.manifest.entry)
  return {
    app: {
      id: appId,
      name: appId,
      kind: APP_KINDS.pluginApp,
      title: published.displayName,
      displayName: published.displayName,
      currentVersion: published.version,
      extractedVersion: published.version,
    },
    metadataPath: path.join(buildRoot, 'app.moss.json'),
    htmlPath,
  }
}

export function createDefaultPluginAppManifest({ id, displayName, description = '' }) {
  const appId = slugifyId(id || displayName || `app-${randomUUID().slice(0, 8)}`)
  return {
    schemaVersion: 1,
    id: appId,
    kind: APP_KINDS.pluginApp,
    displayName: displayName || appId,
    description,
    entry: 'dist/index.html',
    window: {
      width: 1100,
      height: 760,
      resizable: true,
    },
    capabilities: {
      storage: true,
      commands: [],
      tools: [],
    },
    extensionDependencies: {},
  }
}
