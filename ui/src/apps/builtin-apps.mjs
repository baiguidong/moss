import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { installAppArchive } from './app-runtime.mjs'
import semver from 'semver'
import { validateAppPackage } from '../../../packages/app-runtime/src/packages/index.mjs'

const installedVersion = app => app?.currentVersion || app?.version || app?.manifest?.version || null

export async function verifyBuiltinInstallation(installed, versions) {
  if (versions.find(item => item.version === installedVersion(installed))?.reason !== 'builtin') return false
  const pkg = await validateAppPackage(installed.versionDir)
  if (pkg.manifest.id !== installed.id || pkg.manifest.version !== installedVersion(installed)) throw new Error('Installed builtin identity changed')
  return true
}

// Publication and runtime activation form one operation; rollback is conditional on
// the exact committed revision so a concurrent user installation always wins.
export async function publishBuiltinPackage(root, options, { runtime, publish, activate, rollback, getRevision, getInstalled }) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'app.moss.json'), 'utf8'))
  const previousVersion = options.expectedBaseVersion || null
  let committedRevision, previousRuntime
  try {
    return await publish(root, { ...options,
      onCommit: ({ installationRevision }) => {
        committedRevision = installationRevision
        previousRuntime = runtime.getInstallation(manifest.id)
      },
      activateInstallation: installed => activate(installed, previousVersion ? undefined : manifest.permissions || []),
    })
  } catch (error) {
    if (committedRevision !== undefined && await rollback(manifest.id, {
      expectedVersion: manifest.version, expectedInstallationRevision: committedRevision, previousVersion,
    })) {
      const revision = getRevision(manifest.id)
      await runtime.transitionApp(manifest.id, async () => {
        if (getRevision(manifest.id) !== revision || installedVersion(getInstalled(manifest.id)) !== previousVersion) return
        const current = runtime.getInstallation(manifest.id)
        if (!previousVersion) { await runtime.uninstallNow(manifest.id); return }
        if (current?.activeVersion === manifest.version) {
          // Activation can remove obsolete grants; restore them only if nobody
          // changed grants after activation. Enabled state remains user-owned.
          const retained = (previousRuntime?.grants || []).filter(p => (manifest.permissions || []).includes(p))
          const unchanged = JSON.stringify([...(current.grants || [])].sort()) === JSON.stringify(retained.sort())
          await runtime.registerInstalledNow(manifest.id, previousVersion, unchanged ? { grants: previousRuntime?.grants || [] } : {})
        }
      })
    }
    throw error
  }
}

export async function readBuiltinManifest(directory, platform = `${process.platform}-${process.arch}`) {
  let manifest
  try { manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, platform, apps: [] }; throw error }
  if (manifest.schemaVersion !== 1 || manifest.platform !== platform || !Array.isArray(manifest.apps)) throw new Error('Invalid builtin App manifest or platform')
  const seen = new Set()
  for (const entry of manifest.apps) {
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(entry.id) || seen.has(entry.id) || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(entry.version)
      || typeof entry.archive !== 'string' || path.basename(entry.archive) !== entry.archive || !/^[\w.-]+\.zip$/.test(entry.archive)
      || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1) throw new Error('Invalid builtin App entry')
    seen.add(entry.id)
  }
  return manifest
}
export async function verifyBuiltinArchive(directory, entry) {
  const root = await fs.realpath(directory), file = await fs.realpath(path.join(root, entry.archive))
  if (path.dirname(file) !== root) throw new Error('Builtin archive escapes resource directory')
  const data = await fs.readFile(file)
  if (data.length !== entry.bytes || createHash('sha256').update(data).digest('hex') !== entry.sha256) throw new Error(`Builtin App checksum mismatch: ${entry.id}`)
  return file
}
export class BuiltinApps {
  constructor({ directory, statePath, getInstalled, getRevision, verifyInstalled, installPackage, runtime, platform }) {
    Object.assign(this, { directory, statePath, getInstalled, getRevision, verifyInstalled, installPackage, runtime, platform })
    this.manifest = { apps: [] }; this.state = { version: 1, seen: {} }; this.errors = new Map(); this.pending = Promise.resolve()
  }
  async initialize() {
    this.manifest = await readBuiltinManifest(this.directory, this.platform)
    try {
      this.state = JSON.parse(await fs.readFile(this.statePath, 'utf8'))
      if (this.state.version !== 1 || !this.state.seen || typeof this.state.seen !== 'object' || Array.isArray(this.state.seen)) throw new Error('Invalid builtin App receipts')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    return this
  }
  has(id) { return this.manifest.apps.some(entry => entry.id === id) }
  list() {
    return this.manifest.apps.map(({ id, version, displayName, description }) => ({ id, version, displayName, description, installed: Boolean(this.getInstalled(id)), installedVersion: installedVersion(this.getInstalled(id)), error: this.errors.get(id) || null }))
  }
  async save() {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true })
    const temporary = `${this.statePath}.${randomUUID()}.tmp`
    await fs.writeFile(temporary, JSON.stringify(this.state), { mode: 0o600 }); await fs.rename(temporary, this.statePath)
  }
  enqueue(operation) { const pending = this.pending.then(operation); this.pending = pending.catch(() => {}); return pending }
  sync() {
    return this.enqueue(async () => {
      for (const entry of this.manifest.apps) {
        try {
          const installed = this.getInstalled(entry.id), current = installedVersion(installed), seen = this.state.seen[entry.id]
          if (installed) {
            if (!seen) { this.state.seen[entry.id] = current || entry.version; await this.save() }
            // A locally authored/marketplace package or an explicit rollback belongs to the user.
            if (installed.localModification || installed.marketplaceSource || !semver.valid(current)
              || !semver.gt(entry.version, current) || (semver.valid(seen) && semver.gt(seen, current))) continue
            const revision = this.getRevision(entry.id)
            if (!await this.verifyInstalled?.(installed)) continue
            await this.install(entry, { version: current, revision })
          } else {
            if (seen || this.getRevision(entry.id)) continue
          // Revision survives uninstall, including removals before builtins existed.
            await this.install(entry)
          }
          this.state.seen[entry.id] = entry.version; await this.save()
        } catch (error) { this.errors.set(entry.id, error.message) }
      }
      return this.list()
    })
  }
  restore(id) {
    return this.enqueue(async () => {
      const entry = this.manifest.apps.find(item => item.id === id)
      if (!entry) throw new Error('This App is not bundled with this version of Moss')
      if (!this.getInstalled(id)) await this.install(entry)
      this.state.seen[id] = entry.version; await this.save(); this.errors.delete(id)
      return this.list()
    })
  }
  async install(entry, previous = { version: null, revision: this.getRevision(entry.id) }) {
    const revision = previous.revision
    const archive = await verifyBuiltinArchive(this.directory, entry)
    await installAppArchive(this.runtime, archive, { installPackage: async root => {
      const manifest = JSON.parse(await fs.readFile(path.join(root, 'app.moss.json'), 'utf8'))
      if (manifest.id !== entry.id || manifest.version !== entry.version) throw new Error('Builtin archive identity mismatch')
      // A user install/uninstall while extraction runs must win.
      const current = this.getInstalled(entry.id)
      if (installedVersion(current) !== previous.version || current?.localModification || this.getRevision(entry.id) !== revision) throw new Error('App installation changed before builtin install')
      return this.installPackage(root, { reason: 'builtin', note: 'Moss 内置应用', expectedBaseVersion: previous.version, expectedInstallationRevision: revision })
    } })
    this.errors.delete(entry.id)
  }
}
