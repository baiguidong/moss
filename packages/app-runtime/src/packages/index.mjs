import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID, verify as verifySignature } from 'node:crypto'
import semver from 'semver'
import { validateSourcePackage } from './source.mjs'
import { readMcpAppConfig } from './mcp-app.mjs'
import { readConnectorAppPackage } from './connector-app.mjs'
import {
  APP_ERROR_CODES,
  AppServiceError,
  loadJsonSchema,
  validateAppManifest,
  validateAppToolInputSchema,
} from '../../../app-sdk/src/index.mjs'

export const DEFAULT_PACKAGE_LIMITS = Object.freeze({
  maxFileBytes: 128 * 1024 * 1024,
  maxPackageBytes: 512 * 1024 * 1024,
  maxFiles: 10_000,
})

function sha256(buffer) {
  return `sha256-${createHash('sha256').update(buffer).digest('base64')}`
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function canonicalChecksums(checksums) {
  return Object.fromEntries(Object.entries(checksums || {}).sort(([left], [right]) => left.localeCompare(right)))
}

export function createAppSignaturePayload(manifest, checksums, metadata) {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    appId: manifest.id,
    version: manifest.version,
    publisherId: metadata.publisherId,
    keyId: metadata.keyId,
    checksums: canonicalChecksums(checksums),
  }), 'utf8')
}

function trustedPublisherKey(trustedPublishers, publisherId, keyId) {
  const publisher = trustedPublishers instanceof Map
    ? trustedPublishers.get(publisherId)
    : trustedPublishers?.[publisherId]
  if (!publisher) return null
  if (typeof publisher === 'string' || Buffer.isBuffer(publisher)) return publisher
  return publisher.keys?.[keyId] || publisher[keyId] || null
}

async function validatePackageSignature(root, manifest, checksums, options) {
  const signaturePath = path.join(root, 'app-signature.json')
  let raw
  try {
    raw = JSON.parse(await fsp.readFile(signaturePath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    if (error instanceof SyntaxError) {
      throw new AppServiceError(APP_ERROR_CODES.integrityFailed, `Invalid app-signature.json: ${error.message}`)
    }
    if (options.requireTrustedPublisher || options.requireSignature) {
      throw new AppServiceError(APP_ERROR_CODES.integrityFailed, 'App package signature is required')
    }
    return Object.freeze({ status: 'unsigned', publisher: manifest.publisher || null })
  }
  if (
    raw?.schemaVersion !== 1
    || raw.algorithm !== 'ed25519'
    || typeof raw.publisherId !== 'string'
    || typeof raw.keyId !== 'string'
    || typeof raw.signature !== 'string'
    || !raw.publisherId
    || !raw.keyId
  ) {
    throw new AppServiceError(APP_ERROR_CODES.integrityFailed, 'Invalid App signature metadata')
  }
  if (!manifest.publisher || manifest.publisher.id !== raw.publisherId) {
    throw new AppServiceError(APP_ERROR_CODES.integrityFailed, 'App signature publisher does not match the Manifest')
  }
  const signature = Buffer.from(raw.signature, 'base64')
  if (signature.length !== 64) throw new AppServiceError(APP_ERROR_CODES.integrityFailed, 'App signature is malformed')
  const publicKey = trustedPublisherKey(options.trustedPublishers, raw.publisherId, raw.keyId)
  if (!publicKey) {
    if (options.requireTrustedPublisher) {
      throw new AppServiceError(APP_ERROR_CODES.permissionDenied, `App publisher is not trusted: ${raw.publisherId}`)
    }
    return Object.freeze({
      status: 'untrusted',
      publisher: manifest.publisher,
      publisherId: raw.publisherId,
      keyId: raw.keyId,
      algorithm: raw.algorithm,
    })
  }
  let valid = false
  try {
    valid = verifySignature(
      null,
      createAppSignaturePayload(manifest, checksums, raw),
      publicKey,
      signature,
    )
  } catch {}
  if (!valid) throw new AppServiceError(APP_ERROR_CODES.integrityFailed, 'App package signature verification failed')
  return Object.freeze({
    status: 'trusted',
    publisher: manifest.publisher,
    publisherId: raw.publisherId,
    keyId: raw.keyId,
    algorithm: raw.algorithm,
  })
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
    if (file.relativePath === 'checksums.json' || file.relativePath === 'app-signature.json') continue
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
  const platform = options.platform || `${process.platform}-${process.arch}`
  if (manifest.platforms && !manifest.platforms.includes(platform)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `App ${manifest.id}@${manifest.version} does not support ${platform}; package supports ${manifest.platforms.join(', ')}`)
  }
  const icon = await ensureDeclaredFile(root, manifest.icon, 'icon')
  if (icon) {
    if (!['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'].includes(path.extname(icon.realPath).toLowerCase())) {
      throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'icon must use a supported image format')
    }
    if (icon.stat.size > 2 * 1024 * 1024) {
      throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'icon exceeds the 2 MiB size limit')
    }
  }
  if (!manifest.mcpApp || manifest.ui?.entry) await ensureDeclaredFile(root, manifest.ui?.entry, 'ui.entry')
  if (manifest.mcpApp) {
    await ensureDeclaredFile(root, manifest.mcpApp.config, 'mcpApp.config')
    const mcp = await readMcpAppConfig(root, manifest)
    const bundledPaths = Object.values(mcp.mcpServers).flatMap(server => [server.command, ...(server.args || [])])
      .filter(value => typeof value === 'string' && value.startsWith('@app/'))
    for (const reference of bundledPaths) {
      const relative = reference.slice(5)
      if (!relative.startsWith('runtime/')) throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'Bundled MCP files must be inside runtime/')
      await ensureDeclaredFile(root, relative, 'bundled MCP file')
    }
    const uiRoot = manifest.ui?.entry ? path.posix.dirname(manifest.ui.entry) + '/' : null
    if (uiRoot && !uiRoot.startsWith('dist/ui/')) throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'Custom MCP UI must be inside dist/ui/')
    if (files.some(file => !file.relativePath.startsWith('source/')
      && !(bundledPaths.length && file.relativePath.startsWith('runtime/'))
      && !(uiRoot && file.relativePath.startsWith(uiRoot) && /\.(html|js|mjs|css|json|svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf)$/i.test(file.relativePath))
      && !/\.(json|svg|png|jpg|jpeg|gif|webp|ico|md|txt)$/i.test(file.relativePath))) {
      throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'MCP configuration Apps contain only configuration and resources')
    }
  }
  await ensureDeclaredFile(root, manifest.backend?.entry, 'backend.entry')
  if (manifest.connectorApp) await readConnectorAppPackage(root, manifest)
  await ensureDeclaredFile(root, manifest.nativeAdapter?.entry, 'nativeAdapter.entry')
  for (const action of manifest.backend?.actions || []) {
    if (action.inputSchema) loadJsonSchema(root, action.inputSchema, `action ${action.name} inputSchema`)
    if (action.outputSchema) loadJsonSchema(root, action.outputSchema, `action ${action.name} outputSchema`)
  }
  for (const skill of manifest.contributes?.skills || []) {
    const file = await ensureDeclaredFile(root, skill.path, `skill ${skill.id} path`)
    if (file.stat.size > 64 * 1024) throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'Skill instructions exceed 64 KiB')
    await ensureDeclaredFile(root, skill.cli, `skill ${skill.id} cli`)
  }
  for (const command of manifest.contributes?.commands || []) {
    if (command.inputSchema) loadJsonSchema(root, command.inputSchema, `command ${command.id} inputSchema`)
  }
  for (const tool of manifest.contributes?.tools || []) {
    if (tool.instructions) {
      const file = await ensureDeclaredFile(root, tool.instructions, `tool ${tool.id} instructions`)
      if (file.stat.size > 64 * 1024) throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'Tool instructions exceed 64 KiB')
    }
    validateAppToolInputSchema(
      loadJsonSchema(root, tool.inputSchema, `tool ${tool.id} inputSchema`),
      `App ${manifest.id} tool ${tool.id} inputSchema (${tool.inputSchema})`,
    )
    if (tool.outputSchema) loadJsonSchema(root, tool.outputSchema, `tool ${tool.id} outputSchema`)
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
  const trust = await validatePackageSignature(root, manifest, actualChecksums, options)
  await validateSourcePackage(root, { required: options.requireSource === true || Boolean(manifest.mcpApp && files.some(file => file.relativePath.startsWith('source/'))) })
  return deepFreeze({ root, manifest, checksums: actualChecksums, files, trust })
}

export async function readAppPackageManifest(packageRoot, options = {}) {
  const root = path.resolve(packageRoot)
  const stat = await fsp.lstat(root)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'App package root must be a real directory')
  }
  const manifest = validateAppManifest(JSON.parse(await fsp.readFile(path.join(root, 'app.moss.json'), 'utf8')), {
    hostApiVersion: options.hostApiVersion,
  })
  const platform = `${process.platform}-${process.arch}`
  if (manifest.platforms && !manifest.platforms.includes(platform)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `App ${manifest.id}@${manifest.version} does not support ${platform}; package supports ${manifest.platforms.join(', ')}`)
  }
  return manifest
}

// Full content verification belongs to installation. A verified version is
// restored from its installation receipt without rereading every bundled file.
async function readInstalledAppPackage(packageRoot, receiptPath, options = {}) {
  const root = path.resolve(packageRoot)
  const rootStat = await fsp.lstat(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'App package root must be a real directory')
  }
  const manifestBytes = await fsp.readFile(path.join(root, 'app.moss.json'))
  const manifest = validateAppManifest(JSON.parse(manifestBytes.toString('utf8')), {
    hostApiVersion: options.hostApiVersion,
  })
  const platform = `${process.platform}-${process.arch}`
  if (manifest.platforms && !manifest.platforms.includes(platform)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `App ${manifest.id}@${manifest.version} does not support ${platform}; package supports ${manifest.platforms.join(', ')}`)
  }
  // Keep the declared entry checks cheap so a missing entry fails during
  // restore rather than appearing later as a failed Backend launch.
  await ensureDeclaredFile(root, manifest.backend?.entry, 'backend.entry')
  await ensureDeclaredFile(root, manifest.nativeAdapter?.entry, 'nativeAdapter.entry')
  const checksumBytes = await fsp.readFile(path.join(root, 'checksums.json'))
  const checksums = JSON.parse(checksumBytes.toString('utf8'))
  if (!checksums || typeof checksums !== 'object' || Array.isArray(checksums)) {
    throw new AppServiceError(APP_ERROR_CODES.integrityFailed, 'checksums.json must be an object')
  }
  const manifestDigest = sha256(manifestBytes)
  const checksumsDigest = sha256(checksumBytes)
  let receipt
  try { receipt = JSON.parse(await fsp.readFile(receiptPath, 'utf8')) } catch {}
  let trust
  if (receipt?.schemaVersion === 1 && receipt.appId === manifest.id && receipt.version === manifest.version
    && receipt.manifestDigest === manifestDigest && receipt.checksumsDigest === checksumsDigest
    && receipt.trust && typeof receipt.trust === 'object') {
    trust = receipt.trust
  } else {
    // Migrate versions installed before receipts existed. This checks only the
    // signed declaration, not package contents, which installation checked.
    trust = await validatePackageSignature(root, manifest, checksums, options)
    await writeInstallationReceipt(receiptPath, manifest, trust, manifestDigest, checksumsDigest)
  }
  if (trust.status === 'untrusted' && trustedPublisherKey(options.trustedPublishers, trust.publisherId, trust.keyId)) {
    trust = await validatePackageSignature(root, manifest, checksums, options)
    await writeInstallationReceipt(receiptPath, manifest, trust, manifestDigest, checksumsDigest)
  }
  if (trust.status === 'trusted' && !trustedPublisherKey(options.trustedPublishers, trust.publisherId, trust.keyId)) {
    trust = { ...trust, status: 'untrusted' }
  }
  if (options.requireTrustedPublisher && trust.status !== 'trusted') {
    throw new AppServiceError(APP_ERROR_CODES.permissionDenied, `App publisher is not trusted: ${trust.publisherId || manifest.id}`)
  }
  return deepFreeze({ root, manifest, checksums, files: [], trust })
}

async function writeInstallationReceipt(receiptPath, manifest, trust, manifestDigest, checksumsDigest) {
  const receipt = { schemaVersion: 1, appId: manifest.id, version: manifest.version,
    manifestDigest, checksumsDigest, trust }
  await fsp.mkdir(path.dirname(receiptPath), { recursive: true })
  const temporary = `${receiptPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(receipt)}\n`, { mode: 0o600, flag: 'wx' })
    await fsp.rename(temporary, receiptPath)
  } finally { await fsp.rm(temporary, { force: true }) }
}

export class AppPackageStore {
  constructor(options) {
    this.appsDir = path.resolve(options.appsDir)
    this.hostApiVersion = options.hostApiVersion
    this.trustedPublishers = options.trustedPublishers
    this.requireTrustedPublisher = options.requireTrustedPublisher === true
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
    const resolvedPath = path.resolve(root, value)
    const relative = path.relative(path.resolve(root), resolvedPath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'App package version escapes its version store')
    }
    return resolvedPath
  }

  async get(appId, version) {
    const packageInfo = await readInstalledAppPackage(this.versionRoot(appId, version),
      path.join(this.appRoot(appId), 'verification', `${version}.json`), {
      hostApiVersion: this.hostApiVersion,
      trustedPublishers: this.trustedPublishers,
      requireTrustedPublisher: this.requireTrustedPublisher,
    })
    if (packageInfo.manifest.id !== appId || packageInfo.manifest.version !== version) {
      throw new AppServiceError(
        APP_ERROR_CODES.integrityFailed,
        `Stored App package identity mismatch: expected ${appId}@${version}`,
      )
    }
    return packageInfo
  }

  async installFromDirectory(sourceDir, options = {}) {
    const manifest = await readAppPackageManifest(sourceDir, { hostApiVersion: this.hostApiVersion })
    const destination = this.versionRoot(manifest.id, manifest.version)
    const validationOptions = {
      hostApiVersion: this.hostApiVersion,
      limits: options.limits,
      trustedPublishers: options.trustedPublishers || this.trustedPublishers,
      requireTrustedPublisher: options.requireTrustedPublisher ?? this.requireTrustedPublisher,
    }
    if (fs.existsSync(destination)) {
      const source = await validateAppPackage(sourceDir, validationOptions)
      const current = await this.get(manifest.id, manifest.version)
      if (JSON.stringify(current.checksums) !== JSON.stringify(source.checksums)) {
        throw new AppServiceError(APP_ERROR_CODES.integrityFailed, 'An immutable App version already exists with different contents')
      }
      return { ...current, installed: false }
    }
    const stagingRoot = path.join(this.appRoot(manifest.id), '.staging')
    const stagingDir = path.join(stagingRoot, randomUUID())
    await fsp.mkdir(stagingRoot, { recursive: true })
    try {
      await fsp.cp(sourceDir, stagingDir, { recursive: true, errorOnExist: true, force: false })
      const staged = await validateAppPackage(stagingDir, validationOptions)
      if (staged.manifest.id !== manifest.id || staged.manifest.version !== manifest.version) {
        throw new AppServiceError(APP_ERROR_CODES.integrityFailed, 'App package identity changed during installation')
      }
      await fsp.mkdir(path.dirname(destination), { recursive: true })
      try {
        await fsp.rename(stagingDir, destination)
      } catch (error) {
        if (!fs.existsSync(destination)) throw error
        const current = await this.get(manifest.id, manifest.version)
        if (JSON.stringify(current.checksums) !== JSON.stringify(staged.checksums)) {
          throw new AppServiceError(APP_ERROR_CODES.integrityFailed, 'An immutable App version was installed concurrently with different contents')
        }
        return { ...current, installed: false }
      }
      const manifestDigest = sha256(await fsp.readFile(path.join(destination, 'app.moss.json')))
      const checksumsDigest = sha256(await fsp.readFile(path.join(destination, 'checksums.json')))
      await writeInstallationReceipt(path.join(this.appRoot(manifest.id), 'verification', `${manifest.version}.json`),
        staged.manifest, staged.trust, manifestDigest, checksumsDigest)
    } finally {
      await fsp.rm(stagingDir, { recursive: true, force: true })
    }
    return { ...(await this.get(manifest.id, manifest.version)), installed: true }
  }

  async removeVersion(appId, version) {
    await fsp.rm(this.versionRoot(appId, version), { recursive: true, force: true })
    await fsp.rm(path.join(this.appRoot(appId), 'verification', `${version}.json`), { force: true })
  }

  async removeApp(appId) {
    await fsp.rm(this.appRoot(appId), { recursive: true, force: true })
  }
}
