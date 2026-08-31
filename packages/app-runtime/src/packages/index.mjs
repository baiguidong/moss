import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import semver from 'semver'
import {
  APP_ERROR_CODES,
  AppServiceError,
  loadJsonSchema,
  validateAppManifest,
} from '../../../app-sdk/src/index.mjs'

export const DEFAULT_PACKAGE_LIMITS = Object.freeze({
  maxFileBytes: 50 * 1024 * 1024,
  maxPackageBytes: 250 * 1024 * 1024,
  maxFiles: 10_000,
})

function sha256(buffer) {
  return `sha256-${createHash('sha256').update(buffer).digest('base64')}`
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

export async function listPackageFiles(packageRoot, options = {}) {
  const limits = { ...DEFAULT_PACKAGE_LIMITS, ...options }
  const root = path.resolve(packageRoot)
  const files = []
  let totalBytes = 0
  async function visit(dir) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name)
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/')
      const stat = await fsp.lstat(absolutePath)
      if (stat.isSymbolicLink()) {
        throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `Symbolic links are not allowed: ${relativePath}`)
      }
      if (stat.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!stat.isFile()) {
        throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `Unsupported package entry: ${relativePath}`)
      }
      if (stat.size > limits.maxFileBytes) {
        throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `Package file is too large: ${relativePath}`)
      }
      totalBytes += stat.size
      if (totalBytes > limits.maxPackageBytes) {
        throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'App package exceeds the total size limit')
      }
      files.push({ relativePath, absolutePath, size: stat.size })
      if (files.length > limits.maxFiles) {
        throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'App package contains too many files')
      }
    }
  }
  await visit(root)
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

async function ensureDeclaredFile(packageRoot, relativePath, fieldName) {
  if (!relativePath) return null
  const absolutePath = path.resolve(packageRoot, relativePath)
  if (!isInside(packageRoot, absolutePath)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `${fieldName} escapes the App package`)
  }
  let realRoot
  let realPath
  try {
    realRoot = await fsp.realpath(packageRoot)
    realPath = await fsp.realpath(absolutePath)
  } catch {
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `${fieldName} does not exist: ${relativePath}`)
  }
  const stat = await fsp.stat(realPath)
  if (!isInside(realRoot, realPath) || !stat.isFile()) {
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `${fieldName} must reference a package file`)
  }
  return { realPath, stat }
}

function ensureConfigurationSchemaShape(schema, fieldName, options = {}) {
  if (schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `${fieldName} must describe an object with named properties`)
  }
  if (!options.secrets) return
  for (const [name, field] of Object.entries(schema.properties)) {
    const types = Array.isArray(field?.type) ? field.type : [field?.type]
    if (!types.includes('string') || types.some((type) => type !== 'string' && type !== 'null')) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `${fieldName} property ${name} must be a string secret`)
    }
    if (field.default !== undefined) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `${fieldName} property ${name} cannot declare a default secret`)
    }
  }
}

export async function createPackageChecksums(packageRoot) {
  const checksums = {}
  for (const file of await listPackageFiles(packageRoot)) {
    if (file.relativePath === 'checksums.json') continue
    checksums[file.relativePath] = sha256(await fsp.readFile(file.absolutePath))
  }
  return checksums
}

export async function writePackageChecksums(packageRoot) {
  const checksums = await createPackageChecksums(packageRoot)
  await fsp.writeFile(path.join(packageRoot, 'checksums.json'), `${JSON.stringify(checksums, null, 2)}\n`, 'utf8')
  return checksums
}

export async function validateAppPackage(packageRoot, options = {}) {
  const root = path.resolve(packageRoot)
  let rootStat
  try {
    rootStat = await fsp.lstat(root)
  } catch (error) {
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `App package root is unavailable: ${error.message}`)
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'App package root must be a real directory')
  }
  const files = await listPackageFiles(root, options.limits)
  const manifestPath = path.join(root, 'app.moss.json')
  let rawManifest
  try {
    rawManifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `Cannot read app.moss.json: ${error.message}`)
  }
  const manifest = validateAppManifest(rawManifest, { hostApiVersion: options.hostApiVersion })
  const icon = await ensureDeclaredFile(root, manifest.icon, 'icon')
  if (icon) {
    if (!['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'].includes(path.extname(icon.realPath).toLowerCase())) {
      throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'icon must use a supported image format')
    }
    if (icon.stat.size > 2 * 1024 * 1024) {
      throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'icon exceeds the 2 MiB size limit')
    }
  }
  await ensureDeclaredFile(root, manifest.ui?.entry, 'ui.entry')
  await ensureDeclaredFile(root, manifest.backend?.entry, 'backend.entry')
  for (const action of manifest.backend?.actions || []) {
    if (action.inputSchema) loadJsonSchema(root, action.inputSchema, `action ${action.name} inputSchema`)
    if (action.outputSchema) loadJsonSchema(root, action.outputSchema, `action ${action.name} outputSchema`)
  }
  if (manifest.backend?.configuration?.schema) {
    ensureConfigurationSchemaShape(
      loadJsonSchema(root, manifest.backend.configuration.schema, 'configuration schema'),
      'configuration schema',
    )
  }
  if (manifest.backend?.configuration?.secrets) {
    ensureConfigurationSchemaShape(
      loadJsonSchema(root, manifest.backend.configuration.secrets, 'secrets schema'),
      'secrets schema',
      { secrets: true },
    )
  }

  const checksumsPath = path.join(root, 'checksums.json')
  let declaredChecksums
  try {
    declaredChecksums = JSON.parse(await fsp.readFile(checksumsPath, 'utf8'))
  } catch (error) {
    if (options.requireChecksums !== false) {
      throw new AppServiceError(APP_ERROR_CODES.integrityFailed, `Cannot read checksums.json: ${error.message}`)
    }
    declaredChecksums = await createPackageChecksums(root)
  }
  if (!declaredChecksums || typeof declaredChecksums !== 'object' || Array.isArray(declaredChecksums)) {
    throw new AppServiceError(APP_ERROR_CODES.integrityFailed, 'checksums.json must be an object')
  }
  const actualChecksums = await createPackageChecksums(root)
  const actualNames = Object.keys(actualChecksums).sort()
  const declaredNames = Object.keys(declaredChecksums).sort()
  if (JSON.stringify(actualNames) !== JSON.stringify(declaredNames)) {
    throw new AppServiceError(APP_ERROR_CODES.integrityFailed, 'checksums.json does not cover every packaged file')
  }
  for (const relativePath of actualNames) {
    if (actualChecksums[relativePath] !== declaredChecksums[relativePath]) {
      throw new AppServiceError(APP_ERROR_CODES.integrityFailed, `Checksum mismatch: ${relativePath}`)
    }
  }
  return deepFreeze({ root, manifest, checksums: actualChecksums, files })
}

export class AppPackageStore {
  constructor(options) {
    this.appsDir = path.resolve(options.appsDir)
    this.hostApiVersion = options.hostApiVersion
  }

  appRoot(appId) {
    const value = String(appId || '')
    if (!/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/.test(value)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `Invalid App package id: ${value}`)
    }
    return path.join(this.appsDir, value)
  }

  versionRoot(appId, version) {
    const value = String(version || '')
    if (!semver.valid(value)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `Invalid App package version: ${value}`)
    }
    const root = path.join(this.appRoot(appId), 'versions')
    const target = path.resolve(root, value)
    const relative = path.relative(path.resolve(root), target)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'App package version escapes its version store')
    }
    return target
  }

  async get(appId, version) {
    const packageInfo = await validateAppPackage(this.versionRoot(appId, version), { hostApiVersion: this.hostApiVersion })
    if (packageInfo.manifest.id !== appId || packageInfo.manifest.version !== version) {
      throw new AppServiceError(
        APP_ERROR_CODES.integrityFailed,
        `Stored App package identity mismatch: expected ${appId}@${version}`,
      )
    }
    return packageInfo
  }

  async installFromDirectory(sourceDir, options = {}) {
    const source = await validateAppPackage(sourceDir, { hostApiVersion: this.hostApiVersion, limits: options.limits })
    const destination = this.versionRoot(source.manifest.id, source.manifest.version)
    try {
      const current = await validateAppPackage(destination, { hostApiVersion: this.hostApiVersion })
      if (JSON.stringify(current.checksums) !== JSON.stringify(source.checksums)) {
        throw new AppServiceError(APP_ERROR_CODES.integrityFailed, 'An immutable App version already exists with different contents')
      }
      return { ...current, installed: false }
    } catch (error) {
      if (fs.existsSync(destination) || error?.code === APP_ERROR_CODES.integrityFailed) throw error
    }
    const stagingRoot = path.join(this.appRoot(source.manifest.id), '.staging')
    const stagingDir = path.join(stagingRoot, randomUUID())
    await fsp.mkdir(stagingRoot, { recursive: true })
    try {
      await fsp.cp(source.root, stagingDir, { recursive: true, errorOnExist: true, force: false })
      await validateAppPackage(stagingDir, { hostApiVersion: this.hostApiVersion, limits: options.limits })
      await fsp.mkdir(path.dirname(destination), { recursive: true })
      try {
        await fsp.rename(stagingDir, destination)
      } catch (error) {
        if (!fs.existsSync(destination)) throw error
        const current = await validateAppPackage(destination, { hostApiVersion: this.hostApiVersion })
        if (JSON.stringify(current.checksums) !== JSON.stringify(source.checksums)) {
          throw new AppServiceError(APP_ERROR_CODES.integrityFailed, 'An immutable App version was installed concurrently with different contents')
        }
        return { ...current, installed: false }
      }
    } finally {
      await fsp.rm(stagingDir, { recursive: true, force: true })
    }
    return { ...(await this.get(source.manifest.id, source.manifest.version)), installed: true }
  }

  async removeVersion(appId, version) {
    await fsp.rm(this.versionRoot(appId, version), { recursive: true, force: true })
  }

  async removeApp(appId) {
    await fsp.rm(this.appRoot(appId), { recursive: true, force: true })
  }
}
