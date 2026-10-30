import { isToolSourceAvailable } from '../../../app-sdk/src/tool-services.mjs'
import { contractDefinition } from '../../../app-sdk/src/host/contracts.mjs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  APP_ERROR_CODES,
  AppServiceError,
  compileJsonSchema,
  loadJsonSchema,
  requireHostPermission,
  resolveAppProtocols,
} from '../../../app-sdk/src/index.mjs'
import { AppActionBroker } from '../actions/index.mjs'
import { AppCapabilityBroker, APP_CAPABILITIES_PROTOCOL } from '../app-capabilities/index.mjs'
import { AppToolScopeStore } from '../tool-scope/index.mjs'
import { getAppToolScope } from '../../../app-sdk/src/tool-scope.mjs'
import builtinApps from '../../../app-sdk/src/builtin-apps.json' with { type: 'json' }
import { HostRequests } from './requests.mjs'
import { AppHostCapabilityRegistry } from '../capabilities/index.mjs'
import {
  APP_CONTRIBUTION_KINDS,
  collectManifestContributions,
  findContribution,
} from '../contributions/index.mjs'
import { AppEventBroker } from '../events/index.mjs'
import { AppLogStore } from '../logging/index.mjs'
import { AppPackageStore, readAppPackageManifest } from '../packages/index.mjs'
import { AppProcessSupervisor } from '../process/index.mjs'
import {
  RuntimeStore,
  InstallationStore,
  InstanceStore,
  JsonAppStateStore,
  DEFAULT_APP_OWNER,
  defaultInstanceId,
  runtimeKey,
  normalizeAppOwner,
  validateConfiguration,
} from '../state/index.mjs'

export class MemoryCredentialAdapter {
  constructor() { this.values = new Map() }
  key(appId, instanceId) { return `${appId}:${instanceId}` }
  async get(appId, instanceId) { return structuredClone(this.values.get(this.key(appId, instanceId)) || {}) }
  async set(appId, instanceId, values) { this.values.set(this.key(appId, instanceId), structuredClone(values || {})) }
  async remove(appId, instanceId) { this.values.delete(this.key(appId, instanceId)) }
  async removeApp(appId) {
    for (const key of this.values.keys()) if (key.startsWith(`${appId}:`)) this.values.delete(key)
  }
}

function maskedSecrets(value) {
  return Object.fromEntries(Object.keys(value || {}).map((key) => [key, { configured: true, masked: '********' }]))
}

async function stopRuntimes(supervisor, runtimes, message = 'App Backend cleanup failed') {
  const results = await Promise.allSettled(runtimes.map(runtime => supervisor.stop(runtime.key)))
  const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
  if (errors.length) {
    throw new AggregateError(errors, `${message}: ${errors.map(error => error?.message || String(error)).join('; ')}`)
  }
}

function activityInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => key !== 'id')
    || typeof value.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value.id)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Backend activity id is invalid')
  }
  return { id: value.id }
}

function activityOutput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 1 || typeof value.active !== 'boolean') {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'Backend activity response is invalid')
  }
  return { active: value.active }
}

const queuedTaskMarker = /^[a-f0-9-]{36}$/
async function hasQueuedTaskMarkers(dataDir) {
  const jobsDir = path.join(dataDir, 'jobs')
  const pendingDir = path.join(jobsDir, '.pending')
  try {
    // Match the engine task store's marker format. Do not follow a redirected
    // queue directory or treat an unrelated file as recoverable work.
    if (!(await fsp.lstat(jobsDir)).isDirectory() || !(await fsp.lstat(pendingDir)).isDirectory()) return false
    return (await fsp.readdir(pendingDir, { withFileTypes: true }))
      .some(entry => entry.isFile() && queuedTaskMarker.test(entry.name))
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

function normalizeInstallationGrants(manifest, value) {
  if (!Array.isArray(value)) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'App grants must be an array')
  const requested = new Set(manifest.permissions || [])
  const grants = [...new Set(value.map((entry) => String(entry || '').trim()))].sort()
  const invalid = grants.find((permission) => !requested.has(permission))
  if (invalid) {
    throw new AppServiceError(APP_ERROR_CODES.permissionDenied, `App did not request permission: ${invalid}`)
  }
  return grants
}

function installationGrantsForPackage(current, manifest, requestedGrants) {
  if (requestedGrants !== undefined) return normalizeInstallationGrants(manifest, requestedGrants)
  if (current) {
    const requested = new Set(manifest.permissions || [])
    return normalizeInstallationGrants(
      manifest,
      (current.grants || []).filter((permission) => requested.has(permission)),
    )
  }
  return normalizeInstallationGrants(manifest, manifest.permissions || [])
}

function ownerStorageSegment(owner) {
  return Buffer.from(owner.key, 'utf8').toString('base64url')
}

export class AppRuntimeHost {
  constructor(options) {
    this.getManifestMetadata = options.getManifestMetadata
    this.prepareBackend = options.prepareBackend
    this.prepareAppInvocation = options.prepareAppInvocation
    this.pendingSessionScopes = options.pendingSessionScopes
    this.shouldRestoreInstance = options.shouldRestoreInstance
    this.automaticStartAllowed = options.automaticStartAllowed || (() => true)
    this.nativeAdapterHost = options.nativeAdapterHost
    this.nativePublishers = new Set(options.nativePublishers || [])
    this.hostRequests = new HostRequests(options.hostRequestOptions)
    this.uiHostSubscriptions = new Set()
    this.capabilityAvailability = options.capabilityAvailability || (() => ({ available: true, reason: null }))
    this.beforeAppDeactivation = (appId) => {
      this.cancelHostRequests(appId)
      return Promise.resolve(this.nativeAdapterHost?.deactivate(appId)).then(() => options.beforeAppDeactivation?.(appId))
    }
    this.rootDir = path.resolve(options.rootDir)
    this.toolScopes = new AppToolScopeStore(path.join(this.rootDir, 'app-tool-scopes.json'))
    this.appsDir = path.resolve(options.appsDir || path.join(this.rootDir, 'apps'))
    this.dataDir = path.resolve(options.dataDir || path.join(this.rootDir, 'apps-data'))
    this.runtimeDir = path.resolve(options.runtimeDir || path.join(this.rootDir, 'apps-runtime'))
    this.defaultOwner = normalizeAppOwner(options.defaultOwner || DEFAULT_APP_OWNER)
    this.ownerContext = new AsyncLocalStorage()
    this.credentialAdapter = options.credentialAdapter || new MemoryCredentialAdapter()
    this.credentials = {
      get: (appId, instanceId) => this.credentialAdapter.get(this.storageAppId(appId), instanceId),
      set: (appId, instanceId, values) => this.credentialAdapter.set(this.storageAppId(appId), instanceId, values),
      remove: (appId, instanceId) => this.credentialAdapter.remove(this.storageAppId(appId), instanceId),
      removeApp: (appId) => this.credentialAdapter.removeApp(this.storageAppId(appId)),
    }
    this.events = options.eventBroker || new AppEventBroker()
    this.state = options.stateStore || new JsonAppStateStore(path.join(this.rootDir, 'app-runtime-state.json'))
    this.packages = new AppPackageStore({
      appsDir: this.appsDir,
      hostApiVersion: options.hostApiVersion,
      trustedPublishers: options.trustedPublishers,
      requireTrustedPublisher: options.requireTrustedPublisher,
    })
    this.packageCache = new Map()
    this.configurationSchemaCache = new WeakMap()
    const ownerResolver = () => this.currentOwner()
    this.installations = new InstallationStore(this.state, { ownerResolver })
    this.instances = new InstanceStore(this.state, { ownerResolver })
    this.runtimes = new RuntimeStore(this.state, { ownerResolver })
    this.logs = new AppLogStore({
      logsDir: path.join(this.runtimeDir, 'logs'),
      secretProvider: async (appId, instanceId, owner) => this.withOwner(
        owner || this.defaultOwner,
        async () => Object.values(await this.credentials.get(appId, instanceId)),
      ),
      ...(options.logOptions || {}),
    })
    if (options.hostCapabilities !== undefined && options.hostCapabilities !== null
      && (typeof options.hostCapabilities.dispatch !== 'function'
        || typeof options.hostCapabilities.registerProtocol !== 'function')) {
      throw new TypeError('hostCapabilities must implement dispatch(request) and registerProtocol(definition)')
    }
    this.hostCapabilities = options.hostCapabilities ?? new AppHostCapabilityRegistry(options.hostCapabilityOptions)
    this.appCapabilities = new AppCapabilityBroker(this)
    this.hostCapabilities.registerProtocol(this.appCapabilities.definition())
    this.hostCapabilities.registerHandler(APP_CAPABILITIES_PROTOCOL, 'providers.list', (input, context) => this.appCapabilities.list(input, context))
    this.hostCapabilities.registerHandler(APP_CAPABILITIES_PROTOCOL, 'provider.invoke', (input, context) => this.appCapabilities.invoke(input, context))
    this.hostCapabilities.registerHandler(APP_CAPABILITIES_PROTOCOL, 'resource.read', (input, context) => this.appCapabilities.read(input, context))
    this.hostCapabilities.registerHandler(APP_CAPABILITIES_PROTOCOL, 'tools.list', (input, context) => this.appCapabilities.listTools(input, context))
    this.hostCapabilities.registerHandler(APP_CAPABILITIES_PROTOCOL, 'tool.invoke', (input, context) => this.appCapabilities.invokeTool(input, context))
    this.hostCapabilities.registerProtocol(contractDefinition('moss.host/v1'))
    this.hostCapabilities.registerHandler('moss.host/v1', 'capabilities.get', (input, context) => this.describeCapabilities(input, context))
    this.hostCapabilities.registerHandler('moss.host/v1', 'tools.scope.get', (_input, context) => this.toolScopeSettings(context))
    this.hostCapabilities.registerHandler('moss.host/v1', 'tools.scope.set', (input, context) => this.toolScopeSettings(context, input.scope))
    this.hostCapabilities.registerHandler('moss.host/v1', 'native.settings', async (input, context) => {
      const pkg = await this.requireNativePackage(context.appId)
      context.assertCurrent()
      return this.nativeAdapterHost.settings(pkg, input, context)
    })
    this.hostCapabilities.registerProtocol({ protocol: 'moss.runtime/v1', methods: Object.fromEntries(
      ['begin', 'renew', 'end'].map(name => [`activity.${name}`, { surfaces: ['backend'], validateInput: activityInput,
        validateOutput: activityOutput }]),
    ) })
    for (const name of ['begin', 'renew', 'end']) {
      this.hostCapabilities.registerHandler('moss.runtime/v1', `activity.${name}`, (input, context) => {
        context.assertCurrent()
        return this.supervisor.setActivity(runtimeKey(context.instanceId, context.owner), context.generation, input.id, name)
      })
    }
    this.supervisor = new AppProcessSupervisor({
      nodeExecutable: options.nodeExecutable,
      processesDir: path.join(this.runtimeDir, 'processes'),
      onStatus: (status) => this.publishRuntimeEvent({ type: 'status', ...status }, status.owner),
      onEvent: (event) => this.publishRuntimeEvent({ type: 'backend-event', ...event }, event.owner),
      onLog: (entry) => this.logs.append(entry).catch(() => {}),
      ...(options.processOptions || {}),
      onHostRequest: (request) => this.dispatchHostRequest(request),
      shouldRestartOnDemand: (definition) => this.canRecoverPendingRuntime(definition),
    })
    this.actions = new AppActionBroker({
      ...(options.actionOptions || {}),
      supervisor: this.supervisor,
      packageResolver: (appId) => this.getActivePackage(appId),
      authorize: (runtimeRecord) => this.authorizeInvocation(runtimeRecord),
      prepare: (runtimeRecord) => this.prepareRuntime(runtimeRecord),
    })
    this.appTransitions = new Map()
    this.initialized = false
    this.initializationPromise = null
  }

  async initialize({ restore = true } = {}) {
    if (this.initialized) return this
    if (this.initializationPromise) return this.initializationPromise
    const initialization = (async () => {
      await this.state.initialize()
      await this.maintainRetiredPackages()
      await this.appCapabilities.initialize()
      // Mark the Host initialized only after orphan recovery and restoration
      // finish.  A transient startup failure must be retryable; setting this
      // flag earlier made the next initialize() silently skip recovery.
      if (restore) { await this.ensureOrphanRecovery(); await this.restoreAllOwners() }
      this.initialized = true
      return this
    })()
    this.initializationPromise = initialization
    try {
      return await initialization
    } finally {
      if (this.initializationPromise === initialization) this.initializationPromise = null
    }
  }

  async maintainRetiredPackages() {
    const retiredDir = path.join(this.runtimeDir, 'retired-native-packages')
    for (const name of await fsp.readdir(retiredDir).catch(error => { if (error.code === 'ENOENT') return []; throw error })) {
      const appId = name.endsWith('.json') ? name.slice(0, -5) : ''
      if (!/^[a-z][a-z0-9._-]*$/.test(appId)) continue
      if (this.nativeAdapterHost?.isLoaded(appId)) continue
      if (!this.installations.listAll().some(item => item.appId === appId)) await this.packages.removeApp(appId)
      await fsp.rm(path.join(retiredDir, name), { force: true })
    }
  }

  async ensureOrphanRecovery() {
    return this.orphanRecovery ??= this.supervisor.recoverOrphans().then(errors => {
      for (const error of errors) this.publishRuntimeEvent({ type: 'restore-error', error: error.message })
    }).catch(error => { this.orphanRecovery = null; throw error })
  }

  async restoreBackground({ signal, concurrency = 3 } = {}) {
    if (signal?.aborted) return
    await this.ensureOrphanRecovery()
    const owners = this.installations.listOwners()
    for (const owner of owners.length ? owners : [this.defaultOwner]) {
      if (signal?.aborted) return
      await this.withOwner(owner, async () => {
        const eligible = new Set()
        for (const installation of this.installations.list()) {
          if (signal?.aborted) return
          if (!installation.enabled) continue
          const manifest = await this.manifestMetadata(installation).catch(() => null)
          if (!manifest?.backend) continue
          const enabledInstances = []
          for (const instance of this.instances.list(installation.appId)) {
            if (!instance.enabled) continue
            try {
              if (!this.shouldRestoreInstance || await this.shouldRestoreInstance({ manifest, installation, instance,
                dataDir: this.appDataPath(this.dataDir, installation.appId, 'instances', instance.id) })) enabledInstances.push(instance)
            } catch (error) {
              this.publishRuntimeEvent({ type: 'restore-error', appId: installation.appId, error: error.message })
            }
          }
          if (!enabledInstances.length) continue
          if (manifest.backend.lifecycle === 'persistent') eligible.add(installation.appId)
          else if (manifest.host?.protocols?.includes('moss.runtime/v1')) {
            for (const instance of enabledInstances) {
              if (await this.hasPendingTasks(installation.appId, instance.id, manifest)) { eligible.add(installation.appId); break }
            }
          }
        }
        await this.restore({ signal, concurrency, shouldRestore: installation => eligible.has(installation.appId) })
      })
    }
  }

  async manifestMetadata(installation) {
    const cached = this.packageCache.get(`${installation.appId}@${installation.activeVersion}`)
    return cached?.manifest || await this.getManifestMetadata?.(installation) || await readAppPackageManifest(path.join(this.appsDir, installation.appId, 'versions', installation.activeVersion))
  }

  async restoreAllOwners({ signal, concurrency = 1, shouldRestore } = {}) {
    const owners = this.installations.listOwners()
    if (!owners.length) owners.push(this.defaultOwner)
    for (const owner of owners) {
      if (signal?.aborted) break
      await this.withOwner(owner, () => this.restore({ signal, concurrency, shouldRestore }))
    }
    return this
  }

  currentOwner() {
    return this.ownerContext.getStore() || this.defaultOwner
  }

  getToolScope(appId, manifestScope) {
    return getAppToolScope(this.toolScopes?.get(this.storageAppId(appId)) ?? builtinApps.toolDefaults?.[appId]?.scope ?? manifestScope)
  }

  getToolLoading(appId, manifestLoading) {
    return this.toolScopes?.getLoading(this.storageAppId(appId)) ?? builtinApps.toolDefaults?.[appId]?.loading ?? (manifestLoading === 'always' ? 'always' : 'on-demand')
  }

  async toolScopeSettings(context, scope = undefined, loading = undefined) {
    const pkg = await this.getActivePackage(context.appId)
    context.assertCurrent()
    if (scope !== undefined) {
      if (scope !== null && scope !== 'global' && scope !== 'session') throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid App tool scope')
      if (this.toolScopes.set(this.storageAppId(context.appId), scope, loading)) this.publishRuntimeEvent({ type: 'tool-scope-changed', appId: context.appId })
    }
    return { scope: this.getToolScope(context.appId, pkg.manifest.toolScope), defaultScope: getAppToolScope(builtinApps.toolDefaults?.[context.appId]?.scope ?? pkg.manifest.toolScope), overridden: this.toolScopes.get(this.storageAppId(context.appId)) !== undefined }
  }

  withOwner(owner, operation) {
    if (typeof operation !== 'function') throw new TypeError('withOwner requires an operation')
    return this.ownerContext.run(normalizeAppOwner(owner), operation)
  }

  storageAppId(appId, owner = this.currentOwner()) {
    return owner.key === DEFAULT_APP_OWNER.key
      ? appId
      : `owners/${ownerStorageSegment(owner)}/${appId}`
  }

  appDataPath(root, appId, ...parts) {
    const owner = this.currentOwner()
    return owner.key === DEFAULT_APP_OWNER.key
      ? path.join(root, appId, ...parts)
      : path.join(root, 'owners', ownerStorageSegment(owner), appId, ...parts)
  }

  async hasPendingTasks(appId, instanceId, manifest) {
    if (manifest.backend?.storage === 'session') return Boolean((await this.pendingSessionScopes?.(appId, instanceId))?.length)
    return hasQueuedTaskMarkers(this.appDataPath(this.dataDir, appId, 'instances', instanceId))
  }

  async canRecoverPendingRuntime(definition) {
    return this.withOwner(definition.owner, async () => {
      if (!this.automaticStartAllowed() || definition.lifecycle !== 'on-demand'
        || !definition.protocols?.includes('moss.runtime/v1')) return false
      const isCurrent = () => {
        const installation = this.installations.get(definition.appId)
        const instance = this.instances.get(definition.instanceId)
        const runtimeRecord = this.runtimes.get(definition.key)
        const registered = this.supervisor.definitions.get(definition.key)
        return this.automaticStartAllowed() && installation?.enabled
          && installation.activeVersion === definition.version
          && installation.incarnationId === definition.installationIncarnationId
          && instance?.enabled && instance.appId === definition.appId
          && instance.incarnationId === definition.instanceIncarnationId
          && runtimeRecord?.generation === definition.generation
          && registered?.generation === definition.generation && registered?.version === definition.version
          && registered?.installationIncarnationId === definition.installationIncarnationId
          && registered?.instanceIncarnationId === definition.instanceIncarnationId
      }
      return Boolean(isCurrent() && await this.hasPendingTasks(definition.appId, definition.instanceId, (await this.getActivePackage(definition.appId)).manifest) && isCurrent())
    })
  }

  publishRuntimeEvent(event, owner = this.currentOwner()) {
    return this.events.publish({ ...event, owner: normalizeAppOwner(owner) })
  }

  transitionApp(appId, operation) {
    const transitionKey = `${this.currentOwner().key}:${appId}`
    const previous = this.appTransitions.get(transitionKey) || Promise.resolve()
    const transition = previous.then(operation, operation)
    const tail = transition.catch(() => {})
    this.appTransitions.set(transitionKey, tail)
    tail.finally(() => {
      if (this.appTransitions.get(transitionKey) === tail) this.appTransitions.delete(transitionKey)
    })
    return transition
  }

  async installFromDirectory(sourceDir, options = {}) {
    const manifest = await readAppPackageManifest(sourceDir, { hostApiVersion: this.packages.hostApiVersion })
    return this.transitionApp(manifest.id, async () => {
      const installed = await this.packages.installFromDirectory(sourceDir, options)
      return this.registerPackageInstallation(installed, options)
    })
  }

  async registerPackageInstallation(installed, options = {}) {
    const current = this.installations.get(installed.manifest.id)
    const activatesInstalledVersion = !current?.activeVersion
      || current.activeVersion === installed.manifest.version
    await this.installations.upsert(installed.manifest.id, {
      activeVersion: current?.activeVersion || installed.manifest.version,
      enabled: current?.enabled ?? options.enabled ?? true,
      grants: current
        ? current.grants || []
        : installationGrantsForPackage(current, installed.manifest, options.grants),
    })
    if (activatesInstalledVersion) {
      this.packageCache.set(`${installed.manifest.id}@${installed.manifest.version}`, Object.freeze(installed))
    }
    await this.ensureDefaultInstance(installed.manifest.id)
    if (current && activatesInstalledVersion && options.grants !== undefined) {
      await this.setAppGrantsNow(installed.manifest.id, options.grants)
    } else if (activatesInstalledVersion) {
      await this.reconcileApp(installed.manifest.id)
    }
    this.publishRuntimeEvent({ type: 'installation-changed', appId: installed.manifest.id })
    return this.getApp(installed.manifest.id)
  }

  async registerInstalled(appId, version, options = {}) {
    return this.transitionApp(appId, () => this.registerInstalledNow(appId, version, options))
  }

  async registerInstalledNow(appId, version, options = {}) {
    const packageInfo = await this.packages.get(appId, version)
    this.packageCache.set(`${appId}@${version}`, packageInfo)
    const current = this.installations.get(appId)
    if (current?.activeVersion && current.activeVersion !== version) {
      try {
        if (options.enabled !== undefined) {
          await this.installations.upsert(appId, { enabled: Boolean(options.enabled) })
        }
        await this.activateVersionNow(appId, version, { grants: options.grants, deferStart: options.deferStart })
      } catch (error) {
        if (options.enabled !== undefined) {
          await this.installations.upsert(appId, { enabled: current.enabled })
          await this.reconcileApp(appId).catch(() => {})
        }
        throw error
      }
      return packageInfo
    }
    const instanceIds = new Set(this.instances.list(appId).map((instance) => instance.id))
    const runtimeSnapshots = this.runtimes.list(appId)
    const nextGrants = installationGrantsForPackage(current, packageInfo.manifest, options.grants)
    const grantsChanged = Boolean(current)
      && JSON.stringify(current.grants || []) !== JSON.stringify(nextGrants)
    try {
      if (grantsChanged) {
        // Repeated registration after installation/startup keeps the same owner
        // alive. Only cancel its calls and subscriptions when replacing it.
        this.cancelHostRequests(appId)
        await stopRuntimes(this.supervisor, runtimeSnapshots, 'Cannot stop App Backend before changing grants')
      }
      await this.installations.upsert(appId, {
        activeVersion: version,
        grants: nextGrants,
        enabled: current?.enabled ?? options.enabled ?? true,
      })
      if (grantsChanged) {
        for (const runtimeRecord of runtimeSnapshots) await this.runtimes.bumpGeneration(runtimeRecord.key)
      }
      await this.ensureDefaultInstance(appId)
      if (!options.deferStart) await this.reconcileApp(appId)
      this.publishRuntimeEvent({ type: 'installation-changed', appId })
      return packageInfo
    } catch (error) {
      this.cancelHostRequests(appId)
      const snapshotKeys = new Set(runtimeSnapshots.map((runtimeRecord) => runtimeRecord.key))
      for (const runtimeRecord of this.runtimes.list(appId)) {
        await this.supervisor.stop(runtimeRecord.key).catch(() => {})
        if (!snapshotKeys.has(runtimeRecord.key)) {
          this.supervisor.unregister(runtimeRecord.key)
          await this.runtimes.remove(runtimeRecord.key).catch(() => {})
        }
      }
      for (const snapshot of runtimeSnapshots) {
        const latest = this.runtimes.get(snapshot.key)
        await this.runtimes.upsert({
          ...snapshot,
          generation: Math.max(snapshot.generation, latest?.generation || 0) + 1,
        }).catch(() => {})
      }
      for (const instance of this.instances.list(appId)) {
        if (!instanceIds.has(instance.id)) await this.instances.remove(instance.id).catch(() => {})
      }
      if (current) await this.installations.upsert(appId, current)
      else await this.installations.remove(appId)
      if (current) await this.reconcileApp(appId).catch(() => {})
      throw error
    }
  }

  async getActivePackage(appId) {
    const installation = this.installations.get(appId)
    if (!installation?.activeVersion) throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `App is not installed: ${appId}`)
    const key = `${appId}@${installation.activeVersion}`
    if (!this.packageCache.has(key)) this.packageCache.set(key, await this.packages.get(appId, installation.activeVersion))
    return this.packageCache.get(key)
  }

  getInstallation(appId) {
    return this.installations.get(appId)
  }

  nativeAvailable(pkg) {
    return Boolean(this.nativeAdapterHost && pkg.manifest.nativeAdapter
      && pkg.trust?.status === 'trusted' && this.nativePublishers.has(pkg.trust.publisherId))
  }

  async requireNativePackage(appId) {
    const installation = this.installations.get(appId)
    if (!installation?.enabled || !installation.grants?.includes('desktop:control')) throw new Error('Native App is disabled or desktop:control was revoked')
    const pkg = await this.packages.get(appId, installation.activeVersion)
    if (!this.nativeAvailable(pkg)) throw new Error('Native adapters require a trusted signature from a Host-approved native publisher')
    const current = this.installations.get(appId)
    if (!current?.enabled || current.activeVersion !== pkg.manifest.version || !current.grants?.includes('desktop:control')) throw new Error('Native App changed during authorization')
    return pkg
  }

  authorizeInvocation(runtimeRecord) {
    const installation = this.installations.get(runtimeRecord.appId)
    if (!installation?.enabled) throw new AppServiceError(APP_ERROR_CODES.disabled, 'App Backend is disabled')
    const instance = this.requireInstance(runtimeRecord.appId, runtimeRecord.instanceId)
    if (!instance.enabled) throw new AppServiceError(APP_ERROR_CODES.instanceDisabled, 'App instance is disabled')
    const current = this.runtimeForInstance(runtimeRecord.appId, runtimeRecord.instanceId)
    if (!current || current.key !== runtimeRecord.key) {
      throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App instance runtime is unavailable')
    }
    if (current.generation !== runtimeRecord.generation) {
      throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'App runtime generation is stale')
    }
  }

  async getApp(appId) {
    const installation = this.installations.get(appId)
    if (!installation) return null
    const packageInfo = await this.getActivePackage(appId)
    const backend = packageInfo.manifest.backend
    const instances = !backend
      ? []
      : this.instances.list(appId).filter((instance) =>
        instance.id === defaultInstanceId(appId))
    const publicInstances = await Promise.all(instances.map(async (instance) => ({
      ...instance,
      secretRefs: maskedSecrets(await this.credentials.get(appId, instance.id)),
      status: await this.getInstanceStatus(appId, instance.id),
    })))
    let configuration = null
    if (backend?.configuration) {
      configuration = this.configurationSchemaCache.get(packageInfo)
      if (!configuration) {
        configuration = {
          schema: backend.configuration.schema
            ? loadJsonSchema(packageInfo.root, backend.configuration.schema, 'App configuration') : null,
          secrets: backend.configuration.secrets
            ? loadJsonSchema(packageInfo.root, backend.configuration.secrets, 'App secrets') : null,
        }
        this.configurationSchemaCache.set(packageInfo, configuration)
      }
    }
    return {
      installation,
      manifest: packageInfo.manifest,
      toolScope: this.getToolScope(appId, packageInfo.manifest.toolScope),
      toolLoading: this.getToolLoading(appId, packageInfo.manifest.toolLoading),
      trust: packageInfo.trust,
      configuration: configuration ? structuredClone(configuration) : null,
      instances: publicInstances,
    }
  }

  async listApps() {
    const results = []
    for (const installation of this.installations.list()) {
      try { results.push(await this.getApp(installation.appId)) } catch (error) {
        results.push({ installation, manifest: null, instances: [], error: error.message })
      }
    }
    return results
  }

  async listContributions(options = {}) {
    const requestedKinds = options.kinds === undefined
      ? APP_CONTRIBUTION_KINDS
      : options.kinds
    if (!Array.isArray(requestedKinds) || requestedKinds.some((kind) => !APP_CONTRIBUTION_KINDS.includes(kind))) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Unknown App contribution kind')
    }
    const result = Object.fromEntries(requestedKinds.map((kind) => [kind, []]))
    for (const installation of this.installations.list()) {
      if (options.appId && installation.appId !== options.appId) continue
      if (!options.appId) {
        const metadata = await this.manifestMetadata(installation).catch(() => null)
        if (metadata && !requestedKinds.some(kind => metadata.contributes?.[kind]?.length)) continue
      }
      let packageInfo
      try { packageInfo = await this.getActivePackage(installation.appId) }
      catch (error) {
        if (options.appId) throw error
        continue // One damaged installation must not hide other Apps' contributions.
      }
      const enabled = Boolean(installation.enabled)
      const contributions = collectManifestContributions(packageInfo.manifest, {
        toolScope: this.getToolScope(installation.appId, packageInfo.manifest.toolScope),
        toolLoading: this.getToolLoading(installation.appId, packageInfo.manifest.toolLoading),
        grants: installation.grants || [],
        enabled,
        includeUnavailable: options.includeUnavailable === true,
      })
      for (const kind of requestedKinds) {
        for (const item of contributions[kind]) {
          if (item.execution === 'native' && !this.nativeAvailable(packageInfo)) continue
          if (kind === 'tools' && Array.isArray(options.selectedAppIds) && !isToolSourceAvailable(item, options.selectedAppIds, options.selectedAppServiceIds)) continue
          const contribution = { ...item }
          if (item.execution === 'native') contribution.hostPermissionManaged = true
          if (options.loadSchemas && ['commands', 'tools'].includes(kind)) {
            if (item.instructions) contribution.instructionsText = await fsp.readFile(path.join(packageInfo.root, item.instructions), 'utf8')
            if (item.inputSchema) {
              contribution.inputSchemaDocument = loadJsonSchema(
                packageInfo.root,
                item.inputSchema,
                `${kind} ${item.localId} inputSchema`,
              )
            }
            if (item.outputSchema) {
              contribution.outputSchemaDocument = loadJsonSchema(
                packageInfo.root,
                item.outputSchema,
                `${kind} ${item.localId} outputSchema`,
              )
            }
          }
          result[kind].push(Object.freeze(contribution))
        }
      }
    }
    for (const items of Object.values(result)) {
      items.sort((left, right) => (left.order || 0) - (right.order || 0)
        || left.appDisplayName.localeCompare(right.appDisplayName)
        || left.id.localeCompare(right.id))
    }
    return result
  }

  async requireContribution(kind, id, options = {}) {
    const separator = String(id || '').indexOf('/')
    const appId = options.appId || (separator > 0 ? String(id).slice(0, separator) : '')
    if (!appId) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Qualified App contribution id is required')
    const contributions = await this.listContributions({ appId, kinds: [kind], loadSchemas: options.loadSchemas })
    return findContribution(contributions, kind, id)
  }

  resolveContributionInstance(appId, requestedInstanceId) {
    const packageInfo = this.packageCache.get(`${appId}@${this.installations.get(appId)?.activeVersion}`)
    const backend = packageInfo?.manifest.backend
    if (!backend) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App contribution requires a Backend')
    if (requestedInstanceId) return this.requireInstance(appId, requestedInstanceId)
    return this.requireInstance(appId, defaultInstanceId(appId))
  }

  async invokeContribution(kind, id, input = {}, options = {}) {
    if (!['commands', 'tools', 'resourceProviders'].includes(kind)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, `App contribution cannot be invoked: ${kind}`)
    }
    const contribution = await this.requireContribution(kind, id)
    if (kind === 'tools' && contribution.execution === 'native') {
      const pkg = await this.requireNativePackage(contribution.appId)
      const validate = compileJsonSchema(loadJsonSchema(pkg.root, contribution.inputSchema))
      if (!validate(input)) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Native tool input does not match its schema')
      options.signal?.throwIfAborted()
      return this.nativeAdapterHost.invoke(pkg, contribution.action, input, options)
    }
    if (kind === 'tools' && contribution.execution === 'host') {
      const pkg = await this.getActivePackage(contribution.appId)
      const validate = compileJsonSchema(loadJsonSchema(pkg.root, contribution.inputSchema, 'Host tool input'))
      if (!validate(input)) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Host tool input does not match its schema')
      const instance = this.requireInstance(contribution.appId, options.instanceId || defaultInstanceId(contribution.appId))
      const runtimeRecord = this.runtimeForInstance(contribution.appId, instance.id)
      if (!runtimeRecord) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App runtime is unavailable')
      options.authorizeDispatch?.()
      return this.dispatchHostRequest({
        appId: contribution.appId, instanceId: instance.id, key: runtimeRecord.key,
        generation: runtimeRecord.generation, version: pkg.manifest.version,
        protocol: contribution.host.protocol, method: contribution.host.method, input,
        owner: this.currentOwner(), principal: normalizeAppOwner(options.principal || this.currentOwner()),
        surface: 'backend', signal: options.signal, timeoutMs: options.timeoutMs,
        authorizeDispatch: options.authorizeDispatch,
        invocation: options.invocation || { surface: 'tool' },
      })
    }
    const instance = this.resolveContributionInstance(contribution.appId, options.instanceId)
    const action = kind === 'resourceProviders' ? contribution.resolveAction : contribution.action
    return this.invoke(contribution.appId, instance.id, action, input, options)
  }

  invokeToolContribution(id, input = {}, options = {}) {
    return this.invokeContribution('tools', id, input, options)
  }

  invokeCommandContribution(id, input = {}, options = {}) {
    return this.invokeContribution('commands', id, input, options)
  }

  async listCommands(options = {}) {
    const { commands } = await this.listContributions({ kinds: ['commands'] })
    const result = []
    for (const command of commands) {
      if (!command.listAction) { result.push({ ...command, name: command.localId }); continue }
      try {
        const instance = this.resolveContributionInstance(command.appId)
        const entries = await this.invoke(command.appId, instance.id, command.listAction, {}, options)
        if (!Array.isArray(entries) || entries.length > 200) throw new Error('Invalid command provider response')
        for (const entry of entries) {
          if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(entry.name) || !entry.input || typeof entry.input !== 'object') continue
          result.push({ ...command, id: command.id + '/' + entry.name, providerId: command.id,
            name: entry.name, description: String(entry.description || command.description).slice(0,512), input: entry.input })
        }
      } catch (error) { this.onEvent?.({type:'command-provider-error', appId:command.appId, error:error.message}) }
    }
    // Ambiguous aliases require the stable, qualified name.
    return result.map(item => ({...item, name: result.filter(other => other.name === item.name).length > 1 ? item.id : item.name}))
  }

  async invokeDiscoveredCommand(id, args, options = {}) {
    const command = (await this.listCommands(options)).find(item => item.id === id)
    if (!command) throw new Error('App command is no longer available')
    const input = command.providerId ? {...command.input, args} : args
    return this.invokeCommandContribution(command.providerId || command.id, input, options)
  }

  async resolveResource(uri, options = {}) {
    let parsed
    try { parsed = new URL(String(uri)) } catch {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Resource URI is invalid')
    }
    const contributions = await this.listContributions({ kinds: ['resourceProviders'] })
    const matches = contributions.resourceProviders.filter((provider) => provider.schemes.includes(parsed.protocol.slice(0, -1)))
    if (matches.length !== 1) {
      throw new AppServiceError(
        APP_ERROR_CODES.actionNotFound,
        matches.length ? `Multiple App resource providers claim URI: ${uri}` : `No App resource provider is available for URI: ${uri}`,
      )
    }
    return this.invokeContribution('resourceProviders', matches[0].id, { uri: String(uri) }, options)
  }

  async ensureDefaultInstance(appId) {
    const packageInfo = await this.getActivePackage(appId)
    const backend = packageInfo.manifest.backend
    const existing = this.instances.get(defaultInstanceId(appId))
    const instance = existing || await this.instances.create(appId, {
      displayName: 'Default', config: {}, secretRefs: {}, enabled: true,
    })
    await this.ensureRuntime(packageInfo, instance)
    return instance
  }

  async ensureRuntime(packageInfo, instance) {
    const backend = packageInfo.manifest.backend
    const key = runtimeKey(instance.id, this.currentOwner())
    const current = this.runtimes.get(key)
    return this.runtimes.upsert({
      appId: packageInfo.manifest.id,
      instanceId: instance.id,
      desiredState: current?.desiredState || 'stopped',
      generation: current?.generation || 1,
    })
  }

  async setAppEnabled(appId, enabled) {
    return this.transitionApp(appId, () => this.setAppEnabledNow(appId, enabled))
  }

  async setAppGrants(appId, grants) {
    return this.transitionApp(appId, () => this.setAppGrantsNow(appId, grants))
  }

  async setAppGrantsNow(appId, grants) {
    const packageInfo = await this.getActivePackage(appId)
    const installation = this.installations.get(appId)
    const nextGrants = normalizeInstallationGrants(packageInfo.manifest, grants)
    if (JSON.stringify(installation.grants || []) === JSON.stringify(nextGrants)) return this.getApp(appId)
    const runtimes = this.runtimes.list(appId)
    await this.installations.upsert(appId, { grants: nextGrants })
    try {
      await this.beforeAppDeactivation(appId)
      for (const runtimeRecord of runtimes) {
        await this.supervisor.stop(runtimeRecord.key)
        await this.runtimes.bumpGeneration(runtimeRecord.key)
      }
      await this.reconcileApp(appId)
    } catch (error) {
      if (packageInfo.manifest.nativeAdapter) throw error // Revocation must fail closed.
      await this.installations.upsert(appId, { grants: installation.grants || [] })
      for (const runtimeRecord of this.runtimes.list(appId)) {
        await this.supervisor.stop(runtimeRecord.key).catch(() => {})
        await this.runtimes.bumpGeneration(runtimeRecord.key).catch(() => {})
      }
      await this.reconcileApp(appId).catch(() => {})
      throw error
    }
    this.publishRuntimeEvent({ type: 'installation-changed', appId })
    return this.getApp(appId)
  }

  async setAppEnabledNow(appId, enabled) {
    const packageInfo = await this.getActivePackage(appId)
    const previous = this.installations.get(appId)
    const nextEnabled = Boolean(enabled)
    await this.installations.upsert(appId, { enabled: nextEnabled })
    try {
      if (previous.enabled !== nextEnabled) {
        for (const runtimeRecord of this.runtimes.list(appId)) await this.runtimes.bumpGeneration(runtimeRecord.key)
      }
      if (!enabled) await this.beforeAppDeactivation(appId)
      await this.reconcileApp(appId)
    } catch (error) {
      if (!enabled && packageInfo.manifest.nativeAdapter) throw error
      await this.installations.upsert(appId, { enabled: previous.enabled })
      await this.reconcileApp(appId).catch(() => {})
      throw error
    }
    this.publishRuntimeEvent({ type: 'installation-changed', appId })
    return this.getApp(appId)
  }

  async listInstances(appId) {
    const packageInfo = await this.getActivePackage(appId)
    const backend = packageInfo.manifest.backend
    const instances = !backend
      ? []
      : this.instances.list(appId).filter((instance) =>
        instance.id === defaultInstanceId(appId))
    return Promise.all(instances.map(async (instance) => ({
      ...instance,
      secretRefs: maskedSecrets(await this.credentials.get(appId, instance.id)),
      status: await this.getInstanceStatus(appId, instance.id),
    })))
  }

  async updateInstance(appId, instanceId, patch = {}) {
    return this.transitionApp(appId, () => this.updateInstanceNow(appId, instanceId, patch))
  }

  async updateInstanceNow(appId, instanceId, patch = {}) {
    this.cancelHostRequests(appId, instanceId)
    const instance = this.requireInstance(appId, instanceId)
    const packageInfo = await this.getActivePackage(appId)
    const currentSecrets = await this.credentials.get(appId, instanceId)
    const pendingSecrets = patch.secrets ? { ...currentSecrets, ...patch.secrets } : currentSecrets
    const pendingConfig = patch.config ?? instance.config
    const configuration = validateConfiguration(
      packageInfo.root,
      packageInfo.manifest.backend,
      pendingConfig,
      pendingSecrets,
    )
    const { config, secrets } = configuration
    const runtimes = this.runtimes.list(appId).filter((item) => item.instanceId === instanceId)
    try {
      const updated = await this.instances.update(instanceId, {
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...((patch.config !== undefined || JSON.stringify(config) !== JSON.stringify(instance.config)) ? { config } : {}),
        ...(patch.secrets !== undefined ? {
          secretRefs: Object.fromEntries(Object.keys(secrets).map((key) => [key, `vault://${appId}/${instanceId}/${key}`])),
        } : {}),
      })
      if (patch.secrets !== undefined) await this.credentials.set(appId, instanceId, secrets)
      for (const runtimeRecord of runtimes) {
        const bumped = await this.runtimes.bumpGeneration(runtimeRecord.key)
        await this.supervisor.stop(runtimeRecord.key)
        this.registerRuntime(packageInfo, updated, bumped, secrets)
      }
      await this.reconcileInstance(instanceId)
      this.publishRuntimeEvent({ type: 'instance-changed', appId, instanceId })
      return this.instances.get(instanceId)
    } catch (error) {
      for (const runtimeRecord of runtimes) await this.supervisor.stop(runtimeRecord.key).catch(() => {})
      let rollbackError = null
      try {
        await this.instances.update(instanceId, {
          displayName: instance.displayName,
          config: instance.config,
          secretRefs: instance.secretRefs,
          enabled: instance.enabled,
        })
        await this.credentials.set(appId, instanceId, currentSecrets)
        for (const runtimeRecord of runtimes) {
          const current = this.runtimes.get(runtimeRecord.key)
          const restored = current
            ? await this.runtimes.bumpGeneration(runtimeRecord.key)
            : await this.runtimes.upsert({ ...runtimeRecord, generation: runtimeRecord.generation + 1 })
          this.registerRuntime(packageInfo, instance, restored, currentSecrets)
        }
        await this.reconcileInstance(instanceId)
      } catch (recoveryError) {
        rollbackError = recoveryError
        for (const runtimeRecord of runtimes) await this.supervisor.stop(runtimeRecord.key).catch(() => {})
      }
      if (rollbackError) {
        throw new AppServiceError(
          APP_ERROR_CODES.backendUnavailable,
          `Instance update failed; rollback also failed: ${rollbackError.message}`,
        )
      }
      throw error
    }
  }

  async setInstanceEnabled(appId, instanceId, enabled) {
    return this.transitionApp(appId, () => this.setInstanceEnabledNow(appId, instanceId, enabled))
  }

  async setInstanceEnabledNow(appId, instanceId, enabled) {
    const previous = this.requireInstance(appId, instanceId)
    if (enabled) {
      const packageInfo = await this.getActivePackage(appId)
      validateConfiguration(
        packageInfo.root,
        packageInfo.manifest.backend,
        previous.config || {},
        await this.credentials.get(appId, instanceId),
      )
    }
    const nextEnabled = Boolean(enabled)
    await this.instances.update(instanceId, { enabled: nextEnabled })
    try {
      if (previous.enabled !== nextEnabled) {
        for (const runtimeRecord of this.runtimes.list(appId).filter(item => item.instanceId === instanceId)) {
          await this.runtimes.bumpGeneration(runtimeRecord.key)
        }
      }
      if (!enabled) await this.beforeAppDeactivation(appId)
      await this.reconcileInstance(instanceId)
    } catch (error) {
      await this.instances.update(instanceId, { enabled: previous.enabled })
      await this.reconcileInstance(instanceId).catch(() => {})
      throw error
    }
    this.publishRuntimeEvent({ type: 'instance-changed', appId, instanceId })
    return this.getInstanceStatus(appId, instanceId)
  }

  async clearInstanceCredentials(appId, instanceId) {
    return this.transitionApp(appId, () => this.clearInstanceCredentialsNow(appId, instanceId))
  }

  async clearInstanceCredentialsNow(appId, instanceId) {
    const instance = this.requireInstance(appId, instanceId)
    if (instance.enabled && this.installations.get(appId)?.enabled) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Disable the App before clearing its credentials')
    }
    await this.credentials.remove(appId, instanceId)
    await this.instances.update(instanceId, { secretRefs: {} })
    for (const runtimeRecord of this.runtimes.list(appId).filter((item) => item.instanceId === instanceId)) {
      await this.supervisor.stop(runtimeRecord.key)
      await this.runtimes.bumpGeneration(runtimeRecord.key)
    }
    this.publishRuntimeEvent({ type: 'instance-changed', appId, instanceId })
    return this.instances.get(instanceId)
  }

  requireInstance(appId, instanceId) {
    const instance = this.instances.get(instanceId)
    if (instanceId !== defaultInstanceId(appId) || !instance || instance.appId !== appId) throw new AppServiceError(APP_ERROR_CODES.unauthorized, 'App instance is outside the caller scope')
    return instance
  }

  async getInstanceStatus(appId, instanceId) {
    this.requireInstance(appId, instanceId)
    const runtimeRecord = this.runtimeForInstance(appId, instanceId)
    return runtimeRecord ? this.supervisor.status(runtimeRecord.key) : null
  }

  async restartInstance(appId, instanceId) {
    return this.transitionApp(appId, () => this.restartInstanceNow(appId, instanceId))
  }

  async restartInstanceNow(appId, instanceId) {
    this.cancelHostRequests(appId, instanceId)
    const instance = this.requireInstance(appId, instanceId)
    const installation = this.installations.get(appId)
    if (!installation?.enabled) throw new AppServiceError(APP_ERROR_CODES.disabled, 'App Backend is disabled')
    if (!instance.enabled) throw new AppServiceError(APP_ERROR_CODES.instanceDisabled, 'App instance is disabled')
    if (!this.runtimeForInstance(appId, instanceId)) await this.reconcileApp(appId)
    const runtimeRecord = this.runtimeForInstance(appId, instanceId)
    if (!runtimeRecord) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App instance runtime is unavailable')
    const packageInfo = await this.getActivePackage(appId)
    const secrets = await this.credentials.get(appId, instanceId)
    validateConfiguration(packageInfo.root, packageInfo.manifest.backend, instance.config || {}, secrets)
    const bumped = await this.runtimes.bumpGeneration(runtimeRecord.key)
    await this.supervisor.stop(runtimeRecord.key)
    await this.prepareRuntime(bumped)
    return this.supervisor.start(runtimeRecord.key, { clearCrashLoop: true })
  }

  runtimeForInstance(appId, instanceId) {
    return this.runtimes.list(appId).find((item) => item.instanceId === instanceId)
  }

  async invoke(appId, instanceId, actionName, input, options = {}) {
    const installation = this.installations.get(appId)
    if (!installation?.enabled) throw new AppServiceError(APP_ERROR_CODES.disabled, 'App Backend is disabled')
    const instance = this.requireInstance(appId, instanceId)
    if (!instance.enabled) throw new AppServiceError(APP_ERROR_CODES.instanceDisabled, 'App instance is disabled')
    if (!this.runtimeForInstance(appId, instanceId)) await this.reconcileApp(appId)
    const runtimeRecord = this.runtimeForInstance(appId, instanceId)
    if (!runtimeRecord) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App instance runtime is unavailable')
    if (this.prepareAppInvocation) {
      const prepared = await this.prepareAppInvocation({ appId, instanceId, actionName, input, options, manifest: (await this.getActivePackage(appId)).manifest })
      input = prepared.input; options = prepared.options
    }
    const authorizeDispatch = options.authorizeDispatch
    return this.actions.invoke(runtimeRecord, actionName, input, {
      ...options,
      principal: normalizeAppOwner(options.principal || this.currentOwner()),
      authorizeDispatch: () => {
        this.authorizeInvocation(runtimeRecord)
        authorizeDispatch?.()
      },
    })
  }

  registerHostProtocol(definition) {
    return this.hostCapabilities.registerProtocol(definition)
  }

  registerHostHandler(protocol, method, handler) {
    if (typeof this.hostCapabilities?.registerHandler !== 'function') {
      throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'Host capability broker does not support handler registration')
    }
    return this.hostCapabilities.registerHandler(protocol, method, handler)
  }

  setAppToolBridge(bridge) {
    this.appCapabilities.setToolBridge(bridge)
  }

  requestHostCapability(appId, instanceId, protocol, method, input = {}, options = {}) {
    const runtimeRecord = this.runtimeForInstance(appId, instanceId)
    if (!runtimeRecord) return Promise.reject(new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App instance runtime is unavailable'))
    return this.dispatchHostRequest({
      ...options, appId, instanceId, protocol, method, input,
      key: runtimeRecord.key, generation: runtimeRecord.generation,
      version: this.installations.get(appId)?.activeVersion,
      owner: this.currentOwner(), surface: 'ui',
    })
  }

  cancelHostRequests(appId, instanceId) {
    const owner = this.currentOwner()
    this.hostRequests.cancelWhere(request => request.owner.key === owner.key && request.appId === appId && (!instanceId || request.instanceId === instanceId))
    for (const entry of this.uiHostSubscriptions) if (entry.owner.key === owner.key && entry.appId === appId && (!instanceId || entry.instanceId === instanceId)) {
      this.uiHostSubscriptions.delete(entry)
      entry.onClosed?.(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'App lifecycle changed'))
    }
  }

  dispatchHostRequest(request) {
    const owner = normalizeAppOwner(request.owner || this.currentOwner())
    return this.withOwner(owner, () => this.hostRequests.run({ ...request, owner, surface: request.surface || 'backend' },
      current => this.dispatchHostRequestNow(current)))
  }

  async dispatchHostRequestNow(request) {
    let runtimeRecord = this.runtimes.get(request.key)
    if (!runtimeRecord) {
      throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App runtime is unavailable')
    }
    if (runtimeRecord.appId !== request.appId || runtimeRecord.instanceId !== request.instanceId) {
      throw new AppServiceError(APP_ERROR_CODES.unauthorized, 'Host request is outside the App instance scope')
    }
    if (runtimeRecord.generation !== request.generation) {
      throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'App runtime generation is stale')
    }
    this.authorizeInvocation(runtimeRecord)
    const packageInfo = await this.getActivePackage(request.appId)
    if (packageInfo.manifest.version !== request.version) {
      throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'App version is stale')
    }
    runtimeRecord = this.runtimes.get(request.key)
    if (!runtimeRecord || runtimeRecord.generation !== request.generation) {
      throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'App runtime generation is stale')
    }
    if (runtimeRecord.appId !== request.appId || runtimeRecord.instanceId !== request.instanceId) {
      throw new AppServiceError(APP_ERROR_CODES.unauthorized, 'Host request is outside the App instance scope')
    }
    if (this.installations.get(request.appId)?.activeVersion !== request.version) {
      throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'App version is stale')
    }
    this.authorizeInvocation(runtimeRecord)
    const installationIncarnationId = this.installations.get(request.appId)?.incarnationId
    const instanceIncarnationId = this.instances.get(request.instanceId)?.incarnationId
    const backend = packageInfo.manifest.backend
    if (typeof this.hostCapabilities?.dispatch !== 'function') {
      throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'Host capability broker is not configured')
    }
    const assertAppCurrent = (authorization) => {
      const current = this.runtimes.get(request.key)
      const installation = this.installations.get(request.appId)
      const instance = this.instances.get(request.instanceId)
      if (!current || current.appId !== request.appId || current.instanceId !== request.instanceId
        || current.generation !== request.generation || installation?.activeVersion !== request.version
        || installation?.incarnationId !== installationIncarnationId
        || instance?.incarnationId !== instanceIncarnationId) {
        throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'App runtime generation is stale')
      }
      this.authorizeInvocation(current)
      if (authorization?.permission) requireHostPermission(installation.grants ?? [], authorization.permission, { source: 'grant' })
    }
    const assertCurrent = (authorization) => {
      request.signal?.throwIfAborted()
      assertAppCurrent(authorization)
      request.authorizeDispatch?.()
    }
    return this.hostCapabilities.dispatch({
      ...request,
      assertCurrent,
      assertAppCurrent,
      appId: runtimeRecord.appId,
      instanceId: runtimeRecord.instanceId,
      version: packageInfo.manifest.version,
      generation: runtimeRecord.generation,
      installationIncarnationId,
      instanceIncarnationId,
      dataDir: this.appDataPath(this.dataDir, runtimeRecord.appId, 'instances', runtimeRecord.instanceId),
      runtimeDir: this.appDataPath(this.runtimeDir, runtimeRecord.appId, runtimeRecord.instanceId),
      owner: this.currentOwner(),
      principal: request.principal || this.currentOwner(),
      protocols: resolveAppProtocols(packageInfo.manifest),
      permissions: packageInfo.manifest.permissions || [],
      grants: this.installations.get(request.appId)?.grants ?? [],
    })
  }

  async describeCapabilities(input, context) {
    const pkg = await this.getActivePackage(context.appId)
    const declared = resolveAppProtocols(pkg.manifest)
    const protocols = input.protocols || declared
    const capabilities = []
    for (const protocol of protocols) {
      if (!declared.includes(protocol)) throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'Capability discovery requires a declared protocol')
      const definition = this.hostCapabilities.protocols.get(protocol)
      if (!definition) { capabilities.push({ protocol, method: '*', supported: false, allowed: false, available: false, reason: 'unsupported', permission: null, surfaces: [], limits: {} }); continue }
      for (const [name, member] of definition.methods) {
        const supported = Boolean(this.hostCapabilities.handlers.get(protocol)?.has(name) || definition.handleRequest)
        let allowed = false, reason = supported ? null : 'unsupported'
        try { await this.hostCapabilities.authorizeMember({ ...context, surface: context.surface, protocols: declared, permissions: pkg.manifest.permissions, grants: this.installations.get(context.appId)?.grants || [] }, definition, member, name, 'method'); allowed = true }
        catch { reason = 'permission_denied' }
        let status = supported && allowed ? await this.capabilityAvailability(protocol, name, context) : { available: false, reason }
        context.assertCurrent()
        if (allowed && member.permission) {
          try { requireHostPermission(this.installations.get(context.appId)?.grants || [], member.permission, { source: 'grant' }) }
          catch { allowed = false; reason = 'permission_denied'; status = { available: false, reason } }
        }
        capabilities.push({ protocol, method: name, supported, allowed, available: supported && allowed && status.available === true,
          reason: status.reason || reason, permission: member.permission, surfaces: member.surfaces || ['ui','backend'],
          limits: { timeoutMs: this.hostRequests.timeoutMs, maxTimeoutMs: this.hostRequests.maxTimeoutMs, maxPending: this.hostRequests.maxPerRuntime, ...member.limits } })
      }
    }
    context.assertCurrent()
    const grants = this.installations.get(context.appId)?.grants || []
    for (const item of capabilities) if (item.allowed && item.permission && !grants.includes(item.permission)) {
      item.allowed = false; item.available = false; item.reason = 'permission_denied'
    }
    return { capabilities }
  }

  async subscribeHostEvent(appId, instanceId, protocol, name, listener, options = {}) {
    const runtime = this.runtimeForInstance(appId, instanceId)
    if (!runtime) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App runtime unavailable')
    const generation = runtime.generation, version = this.installations.get(appId)?.activeVersion, owner = this.currentOwner()
    this.authorizeInvocation(runtime)
    const pkg = await this.getActivePackage(appId)
    const { definition, member } = this.hostCapabilities.requireMember(protocol, name, 'event')
    await this.hostCapabilities.authorizeMember({ surface: 'ui', appId, instanceId, owner, protocols: resolveAppProtocols(pkg.manifest), permissions: pkg.manifest.permissions, grants: this.installations.get(appId)?.grants || [] }, definition, member, name, 'event')
    const current = () => {
      options.signal?.throwIfAborted()
      this.authorizeInvocation(this.runtimeForInstance(appId, instanceId))
      if (this.runtimeForInstance(appId, instanceId)?.generation !== generation || this.installations.get(appId)?.activeVersion !== version) throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'Subscription generation is stale')
      if (member.permission) requireHostPermission(this.installations.get(appId)?.grants || [], member.permission, { source: 'grant' })
    }
    current()
    if (this.uiHostSubscriptions.size >= 512) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Host subscription limit reached')
    const entry = { appId, instanceId, protocol, name, owner, current, listener, onClosed: options.onClosed }
    this.uiHostSubscriptions.add(entry)
    return () => this.uiHostSubscriptions.delete(entry)
  }

  async publishUiHostEvent(appId, instanceId, protocol, name, data, options) {
    for (const entry of this.uiHostSubscriptions) {
      if (entry.owner.key !== this.currentOwner().key || entry.appId !== appId || entry.instanceId !== instanceId || entry.protocol !== protocol || entry.name !== name) continue
      try {
        entry.current()
        const { member } = this.hostCapabilities.requireMember(protocol, name, 'event')
        const value = member.validateInput(data)
        entry.listener(value, { eventId: options.eventId || randomUUID(), protocol, name })
      } catch (error) { this.uiHostSubscriptions.delete(entry); entry.onClosed?.(error) }
    }
  }

  async publishHostEvent(appId, instanceId, protocol, name, data = {}, options = {}) {
    const installation = this.installations.get(appId)
    if (!installation?.enabled) throw new AppServiceError(APP_ERROR_CODES.disabled, 'App Backend is disabled')
    const instance = this.requireInstance(appId, instanceId)
    if (!instance.enabled) throw new AppServiceError(APP_ERROR_CODES.instanceDisabled, 'App instance is disabled')
    const runtimeRecord = this.runtimeForInstance(appId, instanceId)
    if (!runtimeRecord) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App instance runtime is unavailable')
    const packageInfo = await this.getActivePackage(appId)
    const backend = packageInfo.manifest.backend
    await this.publishUiHostEvent(appId, instanceId, protocol, name, data, options)
    if (!backend) return { delivered: true }
    const prepared = await this.hostCapabilities.prepareEvent({
      appId,
      instanceId,
      owner: this.currentOwner(),
      principal: normalizeAppOwner(options.principal || this.currentOwner()),
      protocol,
      name,
      data,
      protocols: resolveAppProtocols(packageInfo.manifest),
      permissions: packageInfo.manifest.permissions || [],
      grants: installation.grants ?? [],
    })
    // A status hint only targets an existing process; its runtime is already prepared.
    if (!options.onlyIfRunning) await this.prepareRuntime(runtimeRecord)
    // Loading the package, authorization and runtime preparation can yield to revocation.
    this.authorizeInvocation(runtimeRecord)
    if (this.runtimes.get(runtimeRecord.key)?.generation !== runtimeRecord.generation
      || this.installations.get(appId)?.activeVersion !== packageInfo.manifest.version) {
      throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'App runtime generation is stale')
    }
    if (prepared.permission) requireHostPermission(this.installations.get(appId)?.grants ?? [], prepared.permission, { source: 'grant' })
    return this.supervisor.publishHostEvent(
      runtimeRecord.key,
      prepared.protocol,
      prepared.name,
      prepared.data,
      options,
    )
  }

  cancelHostEvent(appId, instanceId, protocol, eventId) {
    this.requireInstance(appId, instanceId)
    const runtimeRecord = this.runtimeForInstance(appId, instanceId)
    return runtimeRecord ? this.supervisor.cancelHostEvent(runtimeRecord.key, protocol, eventId) : false
  }

  cancel(appId, instanceId, requestId) {
    this.requireInstance(appId, instanceId)
    const runtimeRecord = this.runtimeForInstance(appId, instanceId)
    return runtimeRecord ? this.actions.cancel(runtimeRecord.key, requestId) : false
  }

  async getLogs(appId, instanceId, options) {
    this.requireInstance(appId, instanceId)
    return this.logs.list(appId, instanceId, { ...options, owner: this.currentOwner() })
  }

  async prepareRuntime(runtimeRecord) {
    await this.ensureOrphanRecovery()
    const packageInfo = await this.getActivePackage(runtimeRecord.appId)
    const instance = this.instances.get(runtimeRecord.instanceId)
    if (!instance) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App instance does not exist')
    const secrets = await this.credentials.get(runtimeRecord.appId, runtimeRecord.instanceId)
    // A queued action can outlive an upgrade while package/credentials are read.
    this.authorizeInvocation(runtimeRecord)
    if (this.installations.get(runtimeRecord.appId)?.activeVersion !== packageInfo.manifest.version) {
      throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'App version is stale')
    }
    validateConfiguration(packageInfo.root, packageInfo.manifest.backend, instance.config, secrets)
    await this.prepareBackend?.(runtimeRecord, this.supervisor)
    this.authorizeInvocation(runtimeRecord)
    this.registerRuntime(packageInfo, instance, runtimeRecord, secrets)
  }

  registerRuntime(packageInfo, instance, runtimeRecord, secrets) {
    const backend = packageInfo.manifest.backend
    const configuration = validateConfiguration(packageInfo.root, backend, instance.config, secrets)
    this.supervisor.register({
      key: runtimeRecord.key,
      appId: packageInfo.manifest.id,
      version: packageInfo.manifest.version,
      instanceId: instance.id,
      generation: runtimeRecord.generation,
      installationIncarnationId: this.installations.get(packageInfo.manifest.id)?.incarnationId,
      instanceIncarnationId: instance.incarnationId,
      entry: backend.entry,
      lifecycle: backend.lifecycle,
      protocols: resolveAppProtocols(packageInfo.manifest),
      permissions: packageInfo.manifest.permissions || [],
      grants: this.installations.get(packageInfo.manifest.id)?.grants ?? [],
      packageRoot: packageInfo.root,
      config: configuration.config,
      secrets: configuration.secrets,
      dataDir: this.appDataPath(this.dataDir, packageInfo.manifest.id, 'instances', instance.id),
      runtimeDir: this.appDataPath(this.runtimeDir, packageInfo.manifest.id, instance.id),
      owner: this.currentOwner(),
    })
  }

  async reconcileApp(appId) {
    const packageInfo = await this.getActivePackage(appId)
    const backend = packageInfo.manifest.backend
    if (!backend) {
      const instance = await this.ensureDefaultInstance(appId)
      for (const runtimeRecord of this.runtimes.list(appId)) {
        await this.supervisor.stop(runtimeRecord.key)
        this.supervisor.unregister(runtimeRecord.key)
        if (runtimeRecord.instanceId !== instance.id) await this.runtimes.remove(runtimeRecord.key)
        else await this.runtimes.upsert({ ...runtimeRecord, desiredState: 'stopped' })
      }
      return
    }
    const defaultInstance = await this.ensureDefaultInstance(appId)
    for (const runtimeRecord of this.runtimes.list(appId)) {
      if (runtimeRecord.instanceId !== defaultInstance.id) await this.removeRuntimeRecord(runtimeRecord)
    }
    await this.reconcileInstance(defaultInstance.id)
  }

  async removeRuntimeRecord(runtimeRecord) {
    await this.supervisor.stop(runtimeRecord.key)
    this.supervisor.unregister(runtimeRecord.key)
    await this.runtimes.remove(runtimeRecord.key)
  }

  async reconcileInstance(instanceId) {
    const instance = this.instances.get(instanceId)
    if (!instance) return
    const installation = this.installations.get(instance.appId)
    const packageInfo = await this.getActivePackage(instance.appId)
    const backend = packageInfo.manifest.backend
    if (!backend) return
    const runtimeRecords = this.runtimes.list(instance.appId).filter((item) => item.instanceId === instanceId)
    if (instance.id !== defaultInstanceId(instance.appId)) {
      for (const runtimeRecord of runtimeRecords) await this.removeRuntimeRecord(runtimeRecord)
      return
    }
    let configurationReady = true
    if (installation.enabled && instance.enabled) {
      try {
        validateConfiguration(packageInfo.root, backend, instance.config || {}, await this.credentials.get(instance.appId, instance.id))
      } catch (error) {
        if (error?.code !== APP_ERROR_CODES.invalidInput) throw error
        configurationReady = false
      }
    }
    const shouldRun = Boolean(
      this.automaticStartAllowed() && installation.enabled && instance.enabled && configurationReady && backend.lifecycle === 'persistent',
    )
    let runtimeRecord = runtimeRecords[0]
    if (!runtimeRecord) {
      runtimeRecord = await this.ensureRuntime(packageInfo, instance)
    }
    if (!runtimeRecord) return
    // desiredState records the stay-running policy. A pending-work wakeup is
    // temporary, so an on-demand Backend remains stopped in this record.
    await this.runtimes.upsert({ ...runtimeRecord, desiredState: shouldRun ? 'running' : 'stopped' })
    if (!installation.enabled || !instance.enabled || !configurationReady) {
      await this.supervisor.stop(runtimeRecord.key)
      return
    }
    if (!this.automaticStartAllowed()) return
    // A queued engine task must be reconciled even when no App surface is open.
    const shouldRecoverPending = backend.lifecycle === 'on-demand'
      && packageInfo.manifest.host?.protocols?.includes('moss.runtime/v1')
      && await this.hasPendingTasks(instance.appId, instance.id, packageInfo.manifest)
    if (shouldRun || shouldRecoverPending) {
      await this.prepareRuntime(runtimeRecord)
      await this.supervisor.start(runtimeRecord.key)
    }
  }

  async restore({ signal, concurrency = 1, shouldRestore } = {}) {
    const installations = this.installations.list().filter(installation => !shouldRestore || shouldRestore(installation, this.currentOwner()))
    const workerCount = Math.min(installations.length, Math.max(1, Math.min(4, Math.trunc(concurrency) || 1)))
    let next = 0
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (!signal?.aborted && next < installations.length) {
        const installation = installations[next++]
        try { await this.reconcileApp(installation.appId) } catch (error) {
          this.publishRuntimeEvent({ type: 'restore-error', appId: installation.appId, error: error.message })
        }
      }
    }))
  }

  async activateVersion(appId, version, options = {}) {
    return this.transitionApp(appId, () => this.activateVersionNow(appId, version, options))
  }

  async activateVersionNow(appId, version, options = {}) {
    const installation = this.installations.get(appId)
    if (!installation) throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `App is not installed: ${appId}`)
    if (installation.activeVersion === version) {
      return options.grants === undefined
        ? this.getApp(appId)
        : this.setAppGrantsNow(appId, options.grants)
    }
    const nextPackage = await this.packages.get(appId, version)
    await this.beforeAppDeactivation(appId)
    this.packageCache.set(`${appId}@${version}`, nextPackage)
    const previousVersion = installation.activeVersion
    const previousGrants = installation.grants || []
    const nextGrants = installationGrantsForPackage(installation, nextPackage.manifest, options.grants)
    this.cancelHostRequests(appId)
    const activeRuntimes = this.runtimes.list(appId)
    const activeInstanceIds = new Set(this.instances.list(appId).map((instance) => instance.id))
    await stopRuntimes(this.supervisor, activeRuntimes, 'Cannot stop App Backend before activating version')
    try {
      await this.installations.upsert(appId, { activeVersion: version, grants: nextGrants })
      for (const runtimeRecord of activeRuntimes) await this.runtimes.bumpGeneration(runtimeRecord.key)
      if (!options.deferStart) await this.reconcileApp(appId)
      const app = await this.getApp(appId)
      this.publishRuntimeEvent({ type: 'installation-changed', appId })
      return app
    } catch (error) {
      const snapshotKeys = new Set(activeRuntimes.map((item) => item.key))
      for (const runtimeRecord of this.runtimes.list(appId)) {
        await this.supervisor.stop(runtimeRecord.key)
        if (!snapshotKeys.has(runtimeRecord.key)) {
          this.supervisor.unregister(runtimeRecord.key)
          await this.runtimes.remove(runtimeRecord.key)
        }
      }
      await this.installations.upsert(appId, { activeVersion: previousVersion, grants: previousGrants })
      for (const instance of this.instances.list(appId)) {
        if (!activeInstanceIds.has(instance.id)) await this.instances.remove(instance.id).catch(() => {})
      }
      for (const snapshot of activeRuntimes) {
        const current = this.runtimes.get(snapshot.key)
        await this.runtimes.upsert({
          ...snapshot,
          generation: Math.max(snapshot.generation, current?.generation || 0) + 1,
          leaseOwner: current?.leaseOwner ?? snapshot.leaseOwner,
          leaseExpiresAt: current?.leaseExpiresAt ?? snapshot.leaseExpiresAt,
        })
      }
      try {
        await this.reconcileApp(appId)
      } catch (rollbackError) {
        await Promise.allSettled(this.runtimes.list(appId).map((item) => this.supervisor.stop(item.key)))
        throw new AppServiceError(
          APP_ERROR_CODES.backendUnavailable,
          `Version activation failed; rollback to ${previousVersion} also failed: ${rollbackError.message}`,
        )
      }
      throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, `Version activation failed and was rolled back: ${error.message}`)
    }
  }

  async uninstall(appId, options = {}) {
    return this.transitionApp(appId, () => this.uninstallNow(appId, options))
  }

  async uninstallNow(appId, options = {}) {
    const installation = this.installations.get(appId)
    if (!installation) return false
    await this.installations.upsert(appId, { enabled: false })
    await this.beforeAppDeactivation(appId)
    const runtimes = this.runtimes.list(appId)
    await stopRuntimes(this.supervisor, runtimes, 'Cannot stop App Backend before uninstalling')
    for (const runtimeRecord of runtimes) this.supervisor.unregister(runtimeRecord.key)
    await this.runtimes.removeForApp(appId)
    if (options.deleteData) await this.instances.removeForApp(appId)
    await this.installations.remove(appId)
    if (!this.installations.listAll().some((item) => item.appId === appId)) {
      // Native modules cannot be unloaded safely. Retain their immutable files
      // until the next Host process; activation of a new version requires restart.
      if (!this.nativeAdapterHost?.isLoaded(appId)) await this.packages.removeApp(appId)
      else {
        const retiredDir = path.join(this.runtimeDir, 'retired-native-packages')
        await fsp.mkdir(retiredDir, { recursive: true })
        await fsp.writeFile(path.join(retiredDir, `${appId}.json`), '{}\n')
      }
      for (const key of this.packageCache.keys()) if (key.startsWith(`${appId}@`)) this.packageCache.delete(key)
    }
    if (options.deleteData) {
      await fsp.rm(this.appDataPath(this.dataDir, appId), { recursive: true, force: true })
      await fsp.rm(this.appDataPath(this.runtimeDir, appId), { recursive: true, force: true })
      await this.logs.removeApp(appId, { owner: this.currentOwner() })
    }
    if (options.deleteCredentials) {
      await this.credentials.removeApp(appId)
      if (!options.deleteData) {
        for (const instance of this.instances.list(appId)) {
          await this.instances.update(instance.id, { secretRefs: {} })
        }
      }
    }
    this.publishRuntimeEvent({ type: 'app-uninstalled', appId })
    return true
  }

  async shutdown() {
    const errors = []
    const attempt = async operation => {
      try { await operation() } catch (error) { errors.push(error) }
    }
    await attempt(() => this.nativeAdapterHost?.stop('shutdown'))
    await attempt(() => this.hostRequests.cancelWhere(() => true))
    const subscriptions = [...this.uiHostSubscriptions]
    this.uiHostSubscriptions.clear()
    for (const entry of subscriptions) {
      await attempt(() => entry.onClosed?.(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Host shut down')))
    }
    await attempt(() => this.supervisor.shutdown())
    if (errors.length) throw new AggregateError(errors, `App Runtime shutdown failed: ${errors.map(error => error?.message || String(error)).join('; ')}`)
  }
}
