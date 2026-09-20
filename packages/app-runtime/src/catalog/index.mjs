import fsp from 'node:fs/promises'
import path from 'node:path'
import semver from 'semver'
import { APP_ERROR_CODES, AppServiceError } from '../../../app-sdk/src/index.mjs'
import { validateAppPackage } from '../packages/index.mjs'

function safeSegment(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized || normalized.includes('/') || normalized.includes('\\') || normalized === '.' || normalized === '..') {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Invalid ${label}`)
  }
  return normalized
}
async function directories(root) {
  try {
    return (await fsp.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export class DirectoryAppCatalogSource {
  constructor(options) {
    this.id = safeSegment(options.id || 'directory', 'App Catalog source id')
    this.rootDir = path.resolve(options.rootDir)
    this.trustedPublishers = options.trustedPublishers
    this.requireTrustedPublisher = options.requireTrustedPublisher === true
  }

  packageRoot(appId, version) {
    const id = safeSegment(appId, 'App id')
    const release = safeSegment(version, 'App version')
    if (!semver.valid(release)) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid App version')
    return [
      path.join(this.rootDir, id, 'versions', release),
      path.join(this.rootDir, id, release),
    ]
  }

  async resolve(appId, version) {
    for (const candidate of this.packageRoot(appId, version)) {
      try {
        const packageInfo = await validateAppPackage(candidate, {
          trustedPublishers: this.trustedPublishers,
          requireTrustedPublisher: this.requireTrustedPublisher,
        })
        if (packageInfo.manifest.id !== appId || packageInfo.manifest.version !== version) {
          throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'App Catalog package identity mismatch')
        }
        return packageInfo
      } catch (error) {
        if (error?.code !== 'ENOENT' && !String(error?.message || '').includes('unavailable')) throw error
      }
    }
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `App Catalog package is unavailable: ${appId}@${version}`)
  }

  async list() {
    const entries = []
    for (const appId of await directories(this.rootDir)) {
      const appRoot = path.join(this.rootDir, appId)
      const versionRoots = [path.join(appRoot, 'versions'), appRoot]
      const seen = new Set()
      for (const versionRoot of versionRoots) {
        for (const version of await directories(versionRoot)) {
          if (seen.has(version) || !semver.valid(version)) continue
          seen.add(version)
          try {
            const packageInfo = await this.resolve(appId, version)
            entries.push({
              sourceId: this.id,
              appId,
              version,
              manifest: packageInfo.manifest,
              trust: packageInfo.trust,
            })
          } catch {}
        }
      }
    }
    return entries.sort((left, right) => left.appId.localeCompare(right.appId)
      || semver.rcompare(left.version, right.version))
  }
}

export class AppCatalog {
  constructor(options = {}) {
    this.sources = new Map()
    for (const source of options.sources || []) this.registerSource(source)
  }

  registerSource(source) {
    if (!source || typeof source.resolve !== 'function' || typeof source.list !== 'function') {
      throw new TypeError('App Catalog source must implement list() and resolve(appId, version)')
    }
    const id = safeSegment(source.id, 'App Catalog source id')
    if (this.sources.has(id)) throw new TypeError(`App Catalog source is already registered: ${id}`)
    this.sources.set(id, source)
    return () => { if (this.sources.get(id) === source) this.sources.delete(id) }
  }

  async list() {
    return (await Promise.all([...this.sources.values()].map((source) => source.list()))).flat()
  }

  async resolve(appId, version, options = {}) {
    const candidates = options.sourceId
      ? [this.sources.get(options.sourceId)].filter(Boolean)
      : [...this.sources.values()]
    for (const source of candidates) {
      try { return { source, packageInfo: await source.resolve(appId, version) } } catch {}
    }
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `No App Catalog source provides ${appId}@${version}`)
  }

  async install(runtime, appId, version, options = {}) {
    const { source, packageInfo } = await this.resolve(appId, version, options)
    return runtime.installFromDirectory(packageInfo.root, {
      grants: options.grants || [],
      trustedPublishers: source.trustedPublishers,
      requireTrustedPublisher: source.requireTrustedPublisher,
    })
  }
}
