import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  APP_ERROR_CODES,
  AppServiceError,
  loadJsonSchema,
  resolveBackendProtocols,
} from '../../../app-sdk/src/index.mjs'
import { AppActionBroker } from '../actions/index.mjs'
import { AppHostCapabilityRegistry } from '../capabilities/index.mjs'
import {
  APP_CONTRIBUTION_KINDS,
  collectManifestContributions,
  findContribution,
} from '../contributions/index.mjs'
import { AppEventBroker } from '../events/index.mjs'
import { AppLogStore } from '../logging/index.mjs'
import { AppPackageStore, validateAppPackage } from '../packages/index.mjs'
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
    this.rootDir = path.resolve(options.rootDir)
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
    this.supervisor = new AppProcessSupervisor({
      nodeExecutable: options.nodeExecutable,
      onStatus: (status) => this.publishRuntimeEvent({ type: 'status', ...status }, status.owner),
      onEvent: (event) => this.publishRuntimeEvent({ type: 'backend-event', ...event }, event.owner),
      onLog: (entry) => this.logs.append(entry).catch(() => {}),
      ...(options.processOptions || {}),
      onHostRequest: (request) => this.dispatchHostRequest(request),
    })
    this.actions = new AppActionBroker({
      ...(options.actionOptions || {}),
      supervisor: this.supervisor,
      packageResolver: (appId) => this.getActivePackage(appId),
      authorize: (runtimeRecord) => this.authorizeInvocation(runtimeRecord),
    })
    this.appTransitions = new Map()
    this.initialized = false
  }

  async initialize() {
    if (this.initialized) return this
    await this.state.initialize()
    this.initialized = true
    const owners = this.installations.listOwners()
    if (!owners.length) owners.push(this.defaultOwner)
    for (const owner of owners) await this.withOwner(owner, () => this.restore())
    return this
  }

  currentOwner() {
    return this.ownerContext.getStore() || this.defaultOwner
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
    const source = await validateAppPackage(sourceDir, {
      hostApiVersion: this.packages.hostApiVersion,
      trustedPublishers: options.trustedPublishers,
      requireTrustedPublisher: options.requireTrustedPublisher,
    })
    return this.transitionApp(source.manifest.id, async () => {
      const installed = await this.packages.installFromDirectory(source.root, options)
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
        await this.activateVersionNow(appId, version, { grants: options.grants })
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
        await Promise.allSettled(runtimeSnapshots.map((item) => this.supervisor.stop(item.key)))
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
      await this.reconcileApp(appId)
      this.publishRuntimeEvent({ type: 'installation-changed', appId })
      return packageInfo
    } catch (error) {
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

  authorizeInvocation(runtimeRecord) {
    const installation = this.installations.get(runtimeRecord.appId)
    if (!installation?.enabled) throw new AppServiceError(APP_ERROR_CODES.disabled, 'App Backend is disabled')
    const instance = this.requireInstance(runtimeRecord.appId, runtimeRecord.instanceId)
    if (!instance.enabled) throw new AppServiceError(APP_ERROR_CODES.instanceDisabled, 'App instance is disabled')
    const current = this.runtimeForInstance(runtimeRecord.appId, runtimeRecord.instanceId)
    if (!current || current.key !== runtimeRecord.key) {
      throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App instance runtime is unavailable')
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
    return {
      installation,
      manifest: packageInfo.manifest,
      trust: packageInfo.trust,
      configuration: packageInfo.manifest.backend?.configuration ? {
        schema: packageInfo.manifest.backend.configuration.schema
          ? loadJsonSchema(packageInfo.root, packageInfo.manifest.backend.configuration.schema, 'App configuration')
          : null,
        secrets: packageInfo.manifest.backend.configuration.secrets
          ? loadJsonSchema(packageInfo.root, packageInfo.manifest.backend.configuration.secrets, 'App secrets')
          : null,
      } : null,
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
      const packageInfo = await this.getActivePackage(installation.appId)
      const enabled = Boolean(installation.enabled)
      const contributions = collectManifestContributions(packageInfo.manifest, {
        grants: installation.grants || [],
        enabled,
        includeUnavailable: options.includeUnavailable === true,
      })
      for (const kind of requestedKinds) {
        for (const item of contributions[kind]) {
          const contribution = { ...item }
          if (options.loadSchemas && ['commands', 'tools'].includes(kind)) {
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
    if (!backend) return null
    const existing = this.instances.get(defaultInstanceId(appId))
    const instance = existing || await this.instances.create(appId, {
      displayName: 'Default', config: {}, secretRefs: {}, enabled: true,
    })
    await this.ensureRuntime(packageInfo, instance)
    return instance
  }

  async ensureRuntime(packageInfo, instance) {
    const backend = packageInfo.manifest.backend
    if (!backend) return null
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
      for (const runtimeRecord of runtimes) {
        await this.supervisor.stop(runtimeRecord.key)
        await this.runtimes.bumpGeneration(runtimeRecord.key)
      }
      await this.reconcileApp(appId)
    } catch (error) {
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
    await this.getActivePackage(appId)
    const previous = this.installations.get(appId)
    await this.installations.upsert(appId, { enabled: Boolean(enabled) })
    try {
      await this.reconcileApp(appId)
    } catch (error) {
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
    await this.instances.update(instanceId, { enabled: Boolean(enabled) })
    try {
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
    const instance = this.requireInstance(appId, instanceId)
    const installation = this.installations.get(appId)
    if (!installation?.enabled) throw new AppServiceError(APP_ERROR_CODES.disabled, 'App Backend is disabled')
    if (!instance.enabled) throw new AppServiceError(APP_ERROR_CODES.instanceDisabled, 'App instance is disabled')
    const runtimeRecord = this.runtimeForInstance(appId, instanceId)
    if (!runtimeRecord) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App instance runtime is unavailable')
    const packageInfo = await this.getActivePackage(appId)
    const secrets = await this.credentials.get(appId, instanceId)
    validateConfiguration(packageInfo.root, packageInfo.manifest.backend, instance.config || {}, secrets)
    const bumped = await this.runtimes.bumpGeneration(runtimeRecord.key)
    await this.supervisor.stop(runtimeRecord.key)
    this.registerRuntime(packageInfo, instance, bumped, secrets)
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
    const runtimeRecord = this.runtimeForInstance(appId, instanceId)
    if (!runtimeRecord) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App instance runtime is unavailable')
    const packageInfo = await this.getActivePackage(appId)
    validateConfiguration(
      packageInfo.root,
      packageInfo.manifest.backend,
      instance.config || {},
      await this.credentials.get(appId, instanceId),
    )
    await this.prepareRuntime(runtimeRecord)
    return this.actions.invoke(runtimeRecord, actionName, input, {
      ...options,
      principal: normalizeAppOwner(options.principal || this.currentOwner()),
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

  async requestHostCapability(appId, instanceId, protocol, method, input = {}, options = {}) {
    const installation = this.installations.get(appId)
    if (!installation?.enabled) throw new AppServiceError(APP_ERROR_CODES.disabled, 'App Backend is disabled')
    const instance = this.requireInstance(appId, instanceId)
    if (!instance.enabled) throw new AppServiceError(APP_ERROR_CODES.instanceDisabled, 'App instance is disabled')
    const runtimeRecord = this.runtimeForInstance(appId, instanceId)
    if (!runtimeRecord) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App instance runtime is unavailable')
    this.authorizeInvocation(runtimeRecord)
    const packageInfo = await this.getActivePackage(appId)
    const backend = packageInfo.manifest.backend
    if (!backend) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App has no Backend')
    return this.hostCapabilities.dispatch({
      appId,
      instanceId,
      version: packageInfo.manifest.version,
      generation: runtimeRecord.generation,
      dataDir: this.appDataPath(this.dataDir, appId, 'instances', instanceId),
      runtimeDir: this.appDataPath(this.runtimeDir, appId, instanceId),
      owner: this.currentOwner(),
      principal: normalizeAppOwner(options.principal || this.currentOwner()),
      requestId: String(options.requestId || randomUUID()),
      protocol,
      method,
      input,
      protocols: resolveBackendProtocols(backend),
      permissions: packageInfo.manifest.permissions || [],
      grants: installation.grants || [],
      signal: options.signal,
    })
  }

  dispatchHostRequest(request) {
    const owner = normalizeAppOwner(request.owner || this.currentOwner())
    return this.withOwner(owner, () => this.dispatchHostRequestNow(request))
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
    const backend = packageInfo.manifest.backend
    if (typeof this.hostCapabilities?.dispatch !== 'function') {
      throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'Host capability broker is not configured')
    }
    return this.hostCapabilities.dispatch({
      ...request,
      appId: runtimeRecord.appId,
      instanceId: runtimeRecord.instanceId,
      version: packageInfo.manifest.version,
      generation: runtimeRecord.generation,
      dataDir: this.appDataPath(this.dataDir, runtimeRecord.appId, 'instances', runtimeRecord.instanceId),
      runtimeDir: this.appDataPath(this.runtimeDir, runtimeRecord.appId, runtimeRecord.instanceId),
      owner: this.currentOwner(),
      principal: request.principal || this.currentOwner(),
      protocols: resolveBackendProtocols(backend),
      permissions: packageInfo.manifest.permissions || [],
      grants: this.installations.get(request.appId)?.grants ?? [],
    })
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
    const prepared = await this.hostCapabilities.prepareEvent({
      appId,
      instanceId,
      protocol,
      name,
      data,
      protocols: resolveBackendProtocols(backend),
      permissions: packageInfo.manifest.permissions || [],
      grants: installation.grants ?? [],
    })
    await this.prepareRuntime(runtimeRecord)
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
    const packageInfo = await this.getActivePackage(runtimeRecord.appId)
    const instance = this.instances.get(runtimeRecord.instanceId)
    if (!instance) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App instance does not exist')
    this.registerRuntime(packageInfo, instance, runtimeRecord, await this.credentials.get(runtimeRecord.appId, runtimeRecord.instanceId))
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
      entry: backend.entry,
      lifecycle: backend.lifecycle,
      protocols: resolveBackendProtocols(backend),
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
      for (const runtimeRecord of this.runtimes.list(appId)) await this.removeRuntimeRecord(runtimeRecord)
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
      installation.enabled && instance.enabled && configurationReady && backend.lifecycle === 'persistent',
    )
    let runtimeRecord = runtimeRecords[0]
    if (!runtimeRecord) {
      runtimeRecord = await this.ensureRuntime(packageInfo, instance)
    }
    if (!runtimeRecord) return
    await this.runtimes.upsert({ ...runtimeRecord, desiredState: shouldRun ? 'running' : 'stopped' })
    if (!installation.enabled || !instance.enabled || !configurationReady) {
      await this.supervisor.stop(runtimeRecord.key)
      return
    }
    await this.prepareRuntime(runtimeRecord)
    if (shouldRun) await this.supervisor.start(runtimeRecord.key)
  }

  async restore() {
    for (const installation of this.installations.list()) {
      try { await this.reconcileApp(installation.appId) } catch (error) {
        this.publishRuntimeEvent({ type: 'restore-error', appId: installation.appId, error: error.message })
      }
    }
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
    this.packageCache.set(`${appId}@${version}`, nextPackage)
    const previousVersion = installation.activeVersion
    const previousGrants = installation.grants || []
    const nextGrants = installationGrantsForPackage(installation, nextPackage.manifest, options.grants)
    const activeRuntimes = this.runtimes.list(appId)
    const activeInstanceIds = new Set(this.instances.list(appId).map((instance) => instance.id))
    await Promise.allSettled(activeRuntimes.map((item) => this.supervisor.stop(item.key)))
    try {
      await this.installations.upsert(appId, { activeVersion: version, grants: nextGrants })
      for (const runtimeRecord of activeRuntimes) await this.runtimes.bumpGeneration(runtimeRecord.key)
      await this.reconcileApp(appId)
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
    const runtimes = this.runtimes.list(appId)
    await Promise.allSettled(runtimes.map((item) => this.supervisor.stop(item.key)))
    for (const runtimeRecord of runtimes) this.supervisor.unregister(runtimeRecord.key)
    await this.runtimes.removeForApp(appId)
    if (options.deleteData) await this.instances.removeForApp(appId)
    await this.installations.remove(appId)
    if (!this.installations.listAll().some((item) => item.appId === appId)) {
      await this.packages.removeApp(appId)
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
    await this.supervisor.shutdown()
  }
}
