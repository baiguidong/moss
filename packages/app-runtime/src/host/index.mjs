import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  APP_ERROR_CODES,
  AppServiceError,
  loadJsonSchema,
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
  DeploymentStore,
  InstallationStore,
  InstanceStore,
  JsonAppStateStore,
  DEFAULT_APP_OWNER,
  defaultInstanceId,
  deploymentKey,
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
    this.target = options.target || 'desktop'
    this.hostId = options.hostId || `${this.target}-${randomUUID()}`
    this.deploymentTargetId = options.deploymentTargetId || this.hostId
    this.leaseTtlMs = options.leaseTtlMs || 30_000
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
    this.deployments = new DeploymentStore(this.state, { ownerResolver })
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
      authorize: (deployment) => this.authorizeInvocation(deployment),
    })
    this.leaseTimer = null
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
    if (this.target === 'server') {
      this.leaseTimer = setInterval(() => this.renewAllLeases().catch(() => {}), Math.max(1000, Math.floor(this.leaseTtlMs / 3)))
      this.leaseTimer.unref?.()
    }
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
      enabled: current?.enabled || false,
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
    const deploymentSnapshots = this.deployments.list(appId)
    const nextGrants = installationGrantsForPackage(current, packageInfo.manifest, options.grants)
    const grantsChanged = Boolean(current)
      && JSON.stringify(current.grants || []) !== JSON.stringify(nextGrants)
    try {
      if (grantsChanged) {
        await Promise.allSettled(deploymentSnapshots.map((item) => this.supervisor.stop(item.key)))
      }
      await this.installations.upsert(appId, {
        activeVersion: version,
        grants: nextGrants,
        ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
      })
      if (grantsChanged) {
        for (const deployment of deploymentSnapshots) await this.deployments.bumpGeneration(deployment.key)
      }
      await this.ensureDefaultInstance(appId)
      await this.reconcileApp(appId)
      this.publishRuntimeEvent({ type: 'installation-changed', appId })
      return packageInfo
    } catch (error) {
      const snapshotKeys = new Set(deploymentSnapshots.map((deployment) => deployment.key))
      for (const deployment of this.deployments.list(appId)) {
        await this.supervisor.stop(deployment.key).catch(() => {})
        if (!snapshotKeys.has(deployment.key)) {
          this.supervisor.unregister(deployment.key)
          await this.deployments.remove(deployment.key).catch(() => {})
        }
      }
      for (const snapshot of deploymentSnapshots) {
        const latest = this.deployments.get(snapshot.key)
        await this.deployments.upsert({
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

  authorizeInvocation(deployment) {
    const installation = this.installations.get(deployment.appId)
    if (!installation?.enabled) throw new AppServiceError(APP_ERROR_CODES.disabled, 'App Backend is disabled')
    const instance = this.requireInstance(deployment.appId, deployment.instanceId)
    if (!instance.enabled) throw new AppServiceError(APP_ERROR_CODES.instanceDisabled, 'App instance is disabled')
    const current = this.localDeployment(deployment.appId, deployment.instanceId)
    if (!current || current.key !== deployment.key) {
      throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App instance is no longer deployed on this Host')
    }
  }

  async getApp(appId) {
    const installation = this.installations.get(appId)
    if (!installation) return null
    const packageInfo = await this.getActivePackage(appId)
    const backend = packageInfo.manifest.backend
    const instances = !backend || !backend.targets.includes(this.target)
      ? []
      : this.instances.list(appId).filter((instance) =>
        backend.instanceMode !== 'single' || instance.id === defaultInstanceId(appId))
    const statuses = this.deployments.list(appId).map((deployment) => ({
      deployment,
      runtime: this.supervisor.status(deployment.key),
    }))
    const publicInstances = await Promise.all(instances.map(async (instance) => ({
      ...instance,
      secretRefs: maskedSecrets(await this.credentials.get(appId, instance.id)),
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
      deployments: statuses,
    }
  }

  async listApps() {
    const results = []
    for (const installation of this.installations.list()) {
      try { results.push(await this.getApp(installation.appId)) } catch (error) {
        results.push({ installation, manifest: null, instances: [], deployments: [], error: error.message })
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
      const backend = packageInfo.manifest.backend
      const enabled = Boolean(
        installation.enabled
        && (!backend || backend.targets.includes(this.target)),
      )
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
    if (backend.instanceMode === 'single') return this.requireInstance(appId, defaultInstanceId(appId))
    const enabled = this.instances.list(appId).filter((instance) => instance.enabled)
    if (enabled.length !== 1) {
      throw new AppServiceError(
        APP_ERROR_CODES.invalidInput,
        `App contribution requires an explicit instanceId; ${enabled.length} enabled instances are available`,
      )
    }
    return enabled[0]
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
    if (!backend || backend.instanceMode !== 'single' || !backend.targets.includes(this.target)) return null
    const existing = this.instances.get(defaultInstanceId(appId))
    const instance = existing || await this.instances.create(appId, {
      displayName: 'Default', config: {}, secretRefs: {}, enabled: false,
    }, { single: true })
    await this.ensureDeployment(packageInfo, instance)
    return instance
  }

  async ensureDeployment(packageInfo, instance, target = this.target, targetId = this.deploymentTargetId) {
    const backend = packageInfo.manifest.backend
    if (!backend || !backend.targets.includes(target)) return null
    const key = deploymentKey(instance.id, target, targetId, this.currentOwner())
    const current = this.deployments.get(key)
    return this.deployments.upsert({
      appId: packageInfo.manifest.id,
      instanceId: instance.id,
      targetType: target,
      targetId,
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
    const deployments = this.deployments.list(appId).filter((item) =>
      item.targetType === this.target && item.targetId === this.deploymentTargetId)
    await this.installations.upsert(appId, { grants: nextGrants })
    try {
      for (const deployment of deployments) {
        await this.supervisor.stop(deployment.key)
        await this.deployments.bumpGeneration(deployment.key)
      }
      await this.reconcileApp(appId)
    } catch (error) {
      await this.installations.upsert(appId, { grants: installation.grants || [] })
      for (const deployment of this.deployments.list(appId).filter((item) =>
        item.targetType === this.target && item.targetId === this.deploymentTargetId)) {
        await this.supervisor.stop(deployment.key).catch(() => {})
        await this.deployments.bumpGeneration(deployment.key).catch(() => {})
      }
      await this.reconcileApp(appId).catch(() => {})
      throw error
    }
    this.publishRuntimeEvent({ type: 'installation-changed', appId })
    return this.getApp(appId)
  }

  async setAppEnabledNow(appId, enabled) {
    const packageInfo = await this.getActivePackage(appId)
    if (enabled && packageInfo.manifest.backend && !packageInfo.manifest.backend.targets.includes(this.target)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, `App Backend does not support target: ${this.target}`)
    }
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
    const instances = !backend || !backend.targets.includes(this.target)
      ? []
      : this.instances.list(appId).filter((instance) =>
        backend.instanceMode !== 'single' || instance.id === defaultInstanceId(appId))
    return Promise.all(instances.map(async (instance) => ({
      ...instance,
      secretRefs: maskedSecrets(await this.credentials.get(appId, instance.id)),
      status: await this.getInstanceStatus(appId, instance.id),
    })))
  }

  async createInstance(appId, input = {}) {
    return this.transitionApp(appId, () => this.createInstanceNow(appId, input))
  }

  async createInstanceNow(appId, input = {}) {
    const packageInfo = await this.getActivePackage(appId)
    const backend = packageInfo.manifest.backend
    if (!backend) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'UI-only Apps cannot create Backend instances')
    if (!backend.targets.includes(this.target)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, `App Backend does not support target: ${this.target}`)
    }
    if (backend.instanceMode !== 'multiple') throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'This App uses its single default instance')
    if (input.target && input.target !== this.target) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Instances can only be created on the current Host')
    if (input.targetId && input.targetId !== this.deploymentTargetId) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Instance targetId does not match the current Host')
    validateConfiguration(packageInfo.root, backend, input.config || {}, input.secrets || {})
    const instance = await this.instances.create(appId, {
      id: input.id,
      displayName: input.displayName,
      config: input.config || {},
      secretRefs: {},
      enabled: Boolean(input.enabled),
    })
    try {
      const stored = await this.instances.update(instance.id, {
        secretRefs: Object.fromEntries(Object.keys(input.secrets || {}).map((key) => [key, `vault://${appId}/${instance.id}/${key}`])),
      })
      await this.credentials.set(appId, instance.id, input.secrets || {})
      await this.ensureDeployment(packageInfo, stored)
      await this.reconcileInstance(instance.id)
      this.publishRuntimeEvent({ type: 'instance-changed', appId, instanceId: instance.id })
      return this.instances.get(instance.id)
    } catch (error) {
      for (const deployment of this.deployments.list(appId).filter((item) => item.instanceId === instance.id)) {
        await this.removeDeploymentRecord(deployment).catch(() => {})
      }
      await this.credentials.remove(appId, instance.id).catch(() => {})
      await this.instances.remove(instance.id).catch(() => {})
      await fsp.rm(this.appDataPath(this.dataDir, appId, 'instances', instance.id), { recursive: true, force: true }).catch(() => {})
      await fsp.rm(this.appDataPath(this.runtimeDir, appId, instance.id), { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }

  async updateInstance(appId, instanceId, patch = {}) {
    return this.transitionApp(appId, () => this.updateInstanceNow(appId, instanceId, patch))
  }

  async updateInstanceNow(appId, instanceId, patch = {}) {
    const instance = this.requireInstance(appId, instanceId)
    const packageInfo = await this.getActivePackage(appId)
    const currentSecrets = await this.credentials.get(appId, instanceId)
    const secrets = patch.secrets ? { ...currentSecrets, ...patch.secrets } : currentSecrets
    const config = patch.config ?? instance.config
    validateConfiguration(packageInfo.root, packageInfo.manifest.backend, config, secrets)
    const deployments = this.deployments.list(appId).filter((item) =>
      item.instanceId === instanceId && item.targetType === this.target && item.targetId === this.deploymentTargetId)
    try {
      const updated = await this.instances.update(instanceId, {
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.config !== undefined ? { config } : {}),
        ...(patch.secrets !== undefined ? {
          secretRefs: Object.fromEntries(Object.keys(secrets).map((key) => [key, `vault://${appId}/${instanceId}/${key}`])),
        } : {}),
      })
      if (patch.secrets !== undefined) await this.credentials.set(appId, instanceId, secrets)
      for (const deployment of deployments) {
        const bumped = await this.deployments.bumpGeneration(deployment.key)
        await this.supervisor.stop(deployment.key)
        this.registerDeployment(packageInfo, updated, bumped, secrets)
      }
      await this.reconcileInstance(instanceId)
      this.publishRuntimeEvent({ type: 'instance-changed', appId, instanceId })
      return this.instances.get(instanceId)
    } catch (error) {
      for (const deployment of deployments) await this.supervisor.stop(deployment.key).catch(() => {})
      let rollbackError = null
      try {
        await this.instances.update(instanceId, {
          displayName: instance.displayName,
          config: instance.config,
          secretRefs: instance.secretRefs,
          enabled: instance.enabled,
        })
        await this.credentials.set(appId, instanceId, currentSecrets)
        for (const deployment of deployments) {
          const current = this.deployments.get(deployment.key)
          const restored = current
            ? await this.deployments.bumpGeneration(deployment.key)
            : await this.deployments.upsert({ ...deployment, generation: deployment.generation + 1 })
          this.registerDeployment(packageInfo, instance, restored, currentSecrets)
        }
        await this.reconcileInstance(instanceId)
      } catch (recoveryError) {
        rollbackError = recoveryError
        for (const deployment of deployments) await this.supervisor.stop(deployment.key).catch(() => {})
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

  async removeInstance(appId, instanceId, options = {}) {
    return this.transitionApp(appId, () => this.removeInstanceNow(appId, instanceId, options))
  }

  async removeInstanceNow(appId, instanceId, options = {}) {
    const packageInfo = await this.getActivePackage(appId)
    if (packageInfo.manifest.backend?.instanceMode === 'single') {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'The default single instance cannot be deleted')
    }
    this.requireInstance(appId, instanceId)
    const deployments = this.deployments.list(appId).filter((item) => item.instanceId === instanceId)
    for (const deployment of deployments) {
      await this.supervisor.stop(deployment.key)
      this.supervisor.unregister(deployment.key)
      await this.deployments.remove(deployment.key)
    }
    await this.instances.remove(instanceId)
    if (options.deleteCredentials) await this.credentials.remove(appId, instanceId)
    if (options.deleteData) {
      await fsp.rm(this.appDataPath(this.dataDir, appId, 'instances', instanceId), { recursive: true, force: true })
      await fsp.rm(this.appDataPath(this.runtimeDir, appId, instanceId), { recursive: true, force: true })
    }
    this.publishRuntimeEvent({ type: 'instance-removed', appId, instanceId })
  }

  async clearInstanceCredentials(appId, instanceId) {
    return this.transitionApp(appId, () => this.clearInstanceCredentialsNow(appId, instanceId))
  }

  async clearInstanceCredentialsNow(appId, instanceId) {
    const instance = this.requireInstance(appId, instanceId)
    if (instance.enabled) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Disable the App instance before clearing its credentials')
    await this.credentials.remove(appId, instanceId)
    await this.instances.update(instanceId, { secretRefs: {} })
    for (const deployment of this.deployments.list(appId).filter((item) => item.instanceId === instanceId)) {
      await this.supervisor.stop(deployment.key)
      await this.deployments.bumpGeneration(deployment.key)
    }
    this.publishRuntimeEvent({ type: 'instance-changed', appId, instanceId })
    return this.instances.get(instanceId)
  }

  requireInstance(appId, instanceId) {
    const instance = this.instances.get(instanceId)
    if (!instance || instance.appId !== appId) throw new AppServiceError(APP_ERROR_CODES.unauthorized, 'App instance is outside the caller scope')
    return instance
  }

  async getInstanceStatus(appId, instanceId) {
    this.requireInstance(appId, instanceId)
    const deployments = this.deployments.list(appId).filter((item) => item.instanceId === instanceId)
    return deployments.map((deployment) => ({ deployment, runtime: this.supervisor.status(deployment.key) }))
  }

  async restartInstance(appId, instanceId) {
    return this.transitionApp(appId, () => this.restartInstanceNow(appId, instanceId))
  }

  async restartInstanceNow(appId, instanceId) {
    const instance = this.requireInstance(appId, instanceId)
    const installation = this.installations.get(appId)
    if (!installation?.enabled) throw new AppServiceError(APP_ERROR_CODES.disabled, 'App Backend is disabled')
    if (!instance.enabled) throw new AppServiceError(APP_ERROR_CODES.instanceDisabled, 'App instance is disabled')
    const deployment = this.localDeployment(appId, instanceId)
    if (!deployment) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'No deployment exists on this Host')
    const packageInfo = await this.getActivePackage(appId)
    const secrets = await this.credentials.get(appId, instanceId)
    validateConfiguration(packageInfo.root, packageInfo.manifest.backend, instance.config || {}, secrets)
    const bumped = await this.deployments.bumpGeneration(deployment.key)
    await this.supervisor.stop(deployment.key)
    this.registerDeployment(packageInfo, instance, bumped, secrets)
    return this.supervisor.start(deployment.key, { clearCrashLoop: true })
  }

  localDeployment(appId, instanceId) {
    return this.deployments.list(appId).find((item) =>
      item.instanceId === instanceId && item.targetType === this.target && item.targetId === this.deploymentTargetId)
  }

  async invoke(appId, instanceId, actionName, input, options = {}) {
    const installation = this.installations.get(appId)
    if (!installation?.enabled) throw new AppServiceError(APP_ERROR_CODES.disabled, 'App Backend is disabled')
    const instance = this.requireInstance(appId, instanceId)
    if (!instance.enabled) throw new AppServiceError(APP_ERROR_CODES.instanceDisabled, 'App instance is disabled')
    const deployment = this.localDeployment(appId, instanceId)
    if (!deployment) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App instance is not deployed on this Host')
    await this.prepareDeployment(deployment)
    return this.actions.invoke(deployment, actionName, input, {
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
    const deployment = this.localDeployment(appId, instanceId)
    if (!deployment) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App instance is not deployed on this Host')
    this.authorizeInvocation(deployment)
    const packageInfo = await this.getActivePackage(appId)
    const backend = packageInfo.manifest.backend
    if (!backend) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App has no Backend')
    return this.hostCapabilities.dispatch({
      appId,
      instanceId,
      version: packageInfo.manifest.version,
      generation: deployment.generation,
      target: { type: deployment.targetType, id: deployment.targetId },
      dataDir: this.appDataPath(this.dataDir, appId, 'instances', instanceId),
      runtimeDir: this.appDataPath(this.runtimeDir, appId, instanceId),
      owner: this.currentOwner(),
      principal: normalizeAppOwner(options.principal || this.currentOwner()),
      requestId: String(options.requestId || randomUUID()),
      protocol,
      method,
      input,
      protocols: backend.protocols || [],
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
    let deployment = this.deployments.get(request.key)
    if (!deployment) {
      throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App deployment is unavailable')
    }
    if (deployment.appId !== request.appId || deployment.instanceId !== request.instanceId) {
      throw new AppServiceError(APP_ERROR_CODES.unauthorized, 'Host request is outside the deployment scope')
    }
    if (deployment.generation !== request.generation) {
      throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'App deployment generation is stale')
    }
    this.authorizeInvocation(deployment)
    const packageInfo = await this.getActivePackage(request.appId)
    if (packageInfo.manifest.version !== request.version) {
      throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'App version is stale')
    }
    deployment = this.deployments.get(request.key)
    if (!deployment || deployment.generation !== request.generation) {
      throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'App deployment generation is stale')
    }
    if (deployment.appId !== request.appId || deployment.instanceId !== request.instanceId) {
      throw new AppServiceError(APP_ERROR_CODES.unauthorized, 'Host request is outside the deployment scope')
    }
    if (this.installations.get(request.appId)?.activeVersion !== request.version) {
      throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'App version is stale')
    }
    this.authorizeInvocation(deployment)
    const backend = packageInfo.manifest.backend
    if (typeof this.hostCapabilities?.dispatch !== 'function') {
      throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'Host capability broker is not configured')
    }
    return this.hostCapabilities.dispatch({
      ...request,
      appId: deployment.appId,
      instanceId: deployment.instanceId,
      version: packageInfo.manifest.version,
      generation: deployment.generation,
      target: { type: deployment.targetType, id: deployment.targetId },
      dataDir: this.appDataPath(this.dataDir, deployment.appId, 'instances', deployment.instanceId),
      runtimeDir: this.appDataPath(this.runtimeDir, deployment.appId, deployment.instanceId),
      owner: this.currentOwner(),
      principal: request.principal || this.currentOwner(),
      protocols: backend?.protocols || [],
      permissions: packageInfo.manifest.permissions || [],
      grants: this.installations.get(request.appId)?.grants || packageInfo.manifest.permissions || [],
    })
  }

  async publishHostEvent(appId, instanceId, protocol, name, data = {}, options = {}) {
    const installation = this.installations.get(appId)
    if (!installation?.enabled) throw new AppServiceError(APP_ERROR_CODES.disabled, 'App Backend is disabled')
    const instance = this.requireInstance(appId, instanceId)
    if (!instance.enabled) throw new AppServiceError(APP_ERROR_CODES.instanceDisabled, 'App instance is disabled')
    const deployment = this.localDeployment(appId, instanceId)
    if (!deployment) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App instance is not deployed on this Host')
    const packageInfo = await this.getActivePackage(appId)
    const backend = packageInfo.manifest.backend
    const prepared = this.hostCapabilities.prepareEvent({
      appId,
      instanceId,
      protocol,
      name,
      data,
      protocols: backend?.protocols || [],
      permissions: packageInfo.manifest.permissions || [],
      grants: installation.grants || packageInfo.manifest.permissions || [],
    })
    await this.prepareDeployment(deployment)
    return this.supervisor.publishHostEvent(
      deployment.key,
      prepared.protocol,
      prepared.name,
      prepared.data,
      options,
    )
  }

  cancelHostEvent(appId, instanceId, protocol, eventId) {
    this.requireInstance(appId, instanceId)
    const deployment = this.localDeployment(appId, instanceId)
    return deployment ? this.supervisor.cancelHostEvent(deployment.key, protocol, eventId) : false
  }

  cancel(appId, instanceId, requestId) {
    this.requireInstance(appId, instanceId)
    const deployment = this.localDeployment(appId, instanceId)
    return deployment ? this.actions.cancel(deployment.key, requestId) : false
  }

  async getLogs(appId, instanceId, options) {
    this.requireInstance(appId, instanceId)
    return this.logs.list(appId, instanceId, { ...options, owner: this.currentOwner() })
  }

  async prepareDeployment(deployment) {
    const packageInfo = await this.getActivePackage(deployment.appId)
    const instance = this.instances.get(deployment.instanceId)
    if (!instance) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App instance does not exist')
    if (this.target === 'server') {
      const leased = await this.deployments.acquireLease(deployment.key, this.hostId, this.leaseTtlMs)
      if (!leased) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'Another Server owns this App deployment lease')
      deployment = leased
    }
    this.registerDeployment(packageInfo, instance, deployment, await this.credentials.get(deployment.appId, deployment.instanceId))
  }

  registerDeployment(packageInfo, instance, deployment, secrets) {
    const backend = packageInfo.manifest.backend
    this.supervisor.register({
      key: deployment.key,
      appId: packageInfo.manifest.id,
      version: packageInfo.manifest.version,
      instanceId: instance.id,
      generation: deployment.generation,
      entry: backend.entry,
      lifecycle: backend.lifecycle,
      protocols: backend.protocols || [],
      permissions: packageInfo.manifest.permissions || [],
      grants: this.installations.get(packageInfo.manifest.id)?.grants || packageInfo.manifest.permissions || [],
      packageRoot: packageInfo.root,
      config: instance.config || {},
      secrets: secrets || {},
      dataDir: this.appDataPath(this.dataDir, packageInfo.manifest.id, 'instances', instance.id),
      runtimeDir: this.appDataPath(this.runtimeDir, packageInfo.manifest.id, instance.id),
      target: { type: deployment.targetType, id: deployment.targetId },
      owner: this.currentOwner(),
    })
  }

  async reconcileApp(appId) {
    const packageInfo = await this.getActivePackage(appId)
    const backend = packageInfo.manifest.backend
    if (!backend || !backend.targets.includes(this.target)) {
      for (const deployment of this.deployments.list(appId)) await this.removeDeploymentRecord(deployment)
      return
    }
    const defaultInstance = await this.ensureDefaultInstance(appId)
    if (backend.instanceMode === 'single') {
      for (const deployment of this.deployments.list(appId)) {
        if (deployment.instanceId !== defaultInstance.id) await this.removeDeploymentRecord(deployment)
      }
    }
    const instances = backend.instanceMode === 'single' ? [defaultInstance] : this.instances.list(appId)
    for (const instance of instances) await this.reconcileInstance(instance.id)
  }

  async removeDeploymentRecord(deployment) {
    await this.supervisor.stop(deployment.key)
    this.supervisor.unregister(deployment.key)
    await this.deployments.remove(deployment.key)
  }

  async reconcileInstance(instanceId) {
    const instance = this.instances.get(instanceId)
    if (!instance) return
    const installation = this.installations.get(instance.appId)
    const packageInfo = await this.getActivePackage(instance.appId)
    const backend = packageInfo.manifest.backend
    if (!backend) return
    let placements = this.deployments.list(instance.appId).filter((item) => item.instanceId === instanceId)
    if (backend.instanceMode === 'single' && instance.id !== defaultInstanceId(instance.appId)) {
      for (const deployment of placements) await this.removeDeploymentRecord(deployment)
      return
    }
    for (const deployment of placements.filter((item) => !backend.targets.includes(item.targetType))) {
      await this.removeDeploymentRecord(deployment)
    }
    placements = this.deployments.list(instance.appId).filter((item) => item.instanceId === instanceId)
    const shouldRun = Boolean(installation.enabled && instance.enabled && backend.lifecycle === 'persistent')
    if (installation.enabled && instance.enabled) {
      validateConfiguration(packageInfo.root, backend, instance.config || {}, await this.credentials.get(instance.appId, instance.id))
    }
    let deployment = placements.find((item) => item.targetType === this.target && item.targetId === this.deploymentTargetId)
    if (!deployment && placements.length) {
      for (const remote of placements) {
        await this.deployments.upsert({ ...remote, desiredState: shouldRun ? 'running' : 'stopped' })
      }
      return
    }
    if (!deployment && backend.targets.includes(this.target)) {
      deployment = await this.ensureDeployment(packageInfo, instance)
    }
    if (!deployment) return
    await this.deployments.upsert({ ...deployment, desiredState: shouldRun ? 'running' : 'stopped' })
    if (!installation.enabled || !instance.enabled) {
      await this.supervisor.stop(deployment.key)
      return
    }
    await this.prepareDeployment(deployment)
    if (shouldRun) await this.supervisor.start(deployment.key)
  }

  async restore() {
    for (const installation of this.installations.list()) {
      try { await this.reconcileApp(installation.appId) } catch (error) {
        this.publishRuntimeEvent({ type: 'restore-error', appId: installation.appId, error: error.message })
      }
    }
  }

  async renewLeases() {
    for (const deployment of this.deployments.list().filter((item) => item.targetType === 'server' && item.targetId === this.deploymentTargetId)) {
      const status = this.supervisor.status(deployment.key)
      if (status.state === 'running' || deployment.desiredState === 'running') {
        const lease = await this.deployments.acquireLease(deployment.key, this.hostId, this.leaseTtlMs)
        if (!lease) {
          await this.supervisor.stop(deployment.key)
        } else if (deployment.desiredState === 'running' && this.supervisor.status(deployment.key).state === 'stopped') {
          const packageInfo = await this.getActivePackage(deployment.appId)
          const instance = this.instances.get(deployment.instanceId)
          if (instance) {
            this.registerDeployment(packageInfo, instance, lease, await this.credentials.get(deployment.appId, deployment.instanceId))
            await this.supervisor.start(deployment.key)
          }
        }
      }
    }
  }

  async renewAllLeases() {
    const owners = this.installations.listOwners()
    if (!owners.length) owners.push(this.defaultOwner)
    for (const owner of owners) await this.withOwner(owner, () => this.renewLeases())
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
    const targetPackage = await this.packages.get(appId, version)
    this.packageCache.set(`${appId}@${version}`, targetPackage)
    const previousVersion = installation.activeVersion
    const previousGrants = installation.grants || []
    const nextGrants = installationGrantsForPackage(installation, targetPackage.manifest, options.grants)
    const activeDeployments = this.deployments.list(appId)
    const activeInstanceIds = new Set(this.instances.list(appId).map((instance) => instance.id))
    await Promise.allSettled(activeDeployments.map((item) => this.supervisor.stop(item.key)))
    try {
      await this.installations.upsert(appId, { activeVersion: version, grants: nextGrants })
      for (const deployment of activeDeployments) await this.deployments.bumpGeneration(deployment.key)
      await this.reconcileApp(appId)
      const app = await this.getApp(appId)
      this.publishRuntimeEvent({ type: 'installation-changed', appId })
      return app
    } catch (error) {
      const snapshotKeys = new Set(activeDeployments.map((item) => item.key))
      for (const deployment of this.deployments.list(appId)) {
        await this.supervisor.stop(deployment.key)
        if (!snapshotKeys.has(deployment.key)) {
          this.supervisor.unregister(deployment.key)
          await this.deployments.remove(deployment.key)
        }
      }
      await this.installations.upsert(appId, { activeVersion: previousVersion, grants: previousGrants })
      for (const instance of this.instances.list(appId)) {
        if (!activeInstanceIds.has(instance.id)) await this.instances.remove(instance.id).catch(() => {})
      }
      for (const snapshot of activeDeployments) {
        const current = this.deployments.get(snapshot.key)
        await this.deployments.upsert({
          ...snapshot,
          generation: Math.max(snapshot.generation, current?.generation || 0) + 1,
          leaseOwner: current?.leaseOwner ?? snapshot.leaseOwner,
          leaseExpiresAt: current?.leaseExpiresAt ?? snapshot.leaseExpiresAt,
        })
      }
      try {
        await this.reconcileApp(appId)
      } catch (rollbackError) {
        await Promise.allSettled(this.deployments.list(appId).map((item) => this.supervisor.stop(item.key)))
        throw new AppServiceError(
          APP_ERROR_CODES.backendUnavailable,
          `Version activation failed; rollback to ${previousVersion} also failed: ${rollbackError.message}`,
        )
      }
      throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, `Version activation failed and was rolled back: ${error.message}`)
    }
  }

  async moveDeployment(appId, instanceId, targetType, targetId, options = {}) {
    return this.transitionApp(appId, () => this.moveDeploymentNow(appId, instanceId, targetType, targetId, options))
  }

  async moveDeploymentNow(appId, instanceId, targetType, targetId, options = {}) {
    const instance = this.requireInstance(appId, instanceId)
    const packageInfo = await this.getActivePackage(appId)
    if (!packageInfo.manifest.backend?.targets.includes(targetType)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, `App Backend does not support target: ${targetType}`)
    }
    const current = this.deployments.list(appId).find((item) => item.instanceId === instanceId)
    if (current) {
      const currentIsLocal = current.targetType === this.target && current.targetId === this.deploymentTargetId
      if (!currentIsLocal && !options.sourceStopped && !options.force) {
        throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'The source deployment must confirm it has stopped')
      }
      if (currentIsLocal) await this.supervisor.stop(current.key)
      this.supervisor.unregister(current.key)
      await this.deployments.remove(current.key)
    }
    const deployment = await this.deployments.upsert({
      appId,
      instanceId,
      targetType,
      targetId,
      desiredState: this.installations.get(appId)?.enabled && instance.enabled && packageInfo.manifest.backend.lifecycle === 'persistent'
        ? 'running'
        : 'stopped',
      generation: (current?.generation || 0) + 1,
    })
    if (targetType === this.target && targetId === this.deploymentTargetId) await this.reconcileInstance(instanceId)
    this.publishRuntimeEvent({ type: 'deployment-moved', appId, instanceId, deployment })
    return deployment
  }

  async uninstall(appId, options = {}) {
    return this.transitionApp(appId, () => this.uninstallNow(appId, options))
  }

  async uninstallNow(appId, options = {}) {
    const installation = this.installations.get(appId)
    if (!installation) return false
    await this.installations.upsert(appId, { enabled: false })
    const deployments = this.deployments.list(appId)
    await Promise.allSettled(deployments.map((item) => this.supervisor.stop(item.key)))
    for (const deployment of deployments) this.supervisor.unregister(deployment.key)
    await this.deployments.removeForApp(appId)
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
    if (this.leaseTimer) clearInterval(this.leaseTimer)
    await this.supervisor.shutdown()
    if (this.target === 'server') {
      const owners = this.installations.listOwners()
      if (!owners.length) owners.push(this.defaultOwner)
      for (const owner of owners) {
        await this.withOwner(owner, () => Promise.allSettled(
          this.deployments.list().map((item) => this.deployments.releaseLease(item.key, this.hostId)),
        ))
      }
    }
  }
}
