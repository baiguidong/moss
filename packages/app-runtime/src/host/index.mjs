import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { APP_ERROR_CODES, AppServiceError, loadJsonSchema } from '../../../app-sdk/src/index.mjs'
import { AppActionBroker } from '../actions/index.mjs'
import { AppEventBroker } from '../events/index.mjs'
import { AppLogStore } from '../logging/index.mjs'
import { AppPackageStore, validateAppPackage } from '../packages/index.mjs'
import { AppProcessSupervisor } from '../process/index.mjs'
import {
  DeploymentStore,
  InstallationStore,
  InstanceStore,
  JsonAppStateStore,
  defaultInstanceId,
  deploymentKey,
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
    this.credentials = options.credentialAdapter || new MemoryCredentialAdapter()
    this.events = options.eventBroker || new AppEventBroker()
    this.state = options.stateStore || new JsonAppStateStore(path.join(this.rootDir, 'app-runtime-state.json'))
    this.packages = new AppPackageStore({ appsDir: this.appsDir, hostApiVersion: options.hostApiVersion })
    this.packageCache = new Map()
    this.installations = new InstallationStore(this.state)
    this.instances = new InstanceStore(this.state)
    this.deployments = new DeploymentStore(this.state)
    this.logs = new AppLogStore({
      logsDir: path.join(this.runtimeDir, 'logs'),
      secretProvider: async (appId, instanceId) => Object.values(await this.credentials.get(appId, instanceId)),
      ...(options.logOptions || {}),
    })
    this.supervisor = new AppProcessSupervisor({
      nodeExecutable: options.nodeExecutable,
      onStatus: (status) => this.events.publish({ type: 'status', ...status }),
      onEvent: (event) => this.events.publish({ type: 'backend-event', ...event }),
      onLog: (entry) => this.logs.append(entry).catch(() => {}),
      ...(options.processOptions || {}),
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
    await this.restore()
    if (this.target === 'server') {
      this.leaseTimer = setInterval(() => this.renewLeases().catch(() => {}), Math.max(1000, Math.floor(this.leaseTtlMs / 3)))
      this.leaseTimer.unref?.()
    }
    return this
  }

  transitionApp(appId, operation) {
    const previous = this.appTransitions.get(appId) || Promise.resolve()
    const transition = previous.then(operation, operation)
    const tail = transition.catch(() => {})
    this.appTransitions.set(appId, tail)
    tail.finally(() => {
      if (this.appTransitions.get(appId) === tail) this.appTransitions.delete(appId)
    })
    return transition
  }

  async installFromDirectory(sourceDir) {
    const source = await validateAppPackage(sourceDir, { hostApiVersion: this.packages.hostApiVersion })
    return this.transitionApp(source.manifest.id, async () => {
      const installed = await this.packages.installFromDirectory(source.root)
      return this.registerPackageInstallation(installed)
    })
  }

  async registerPackageInstallation(installed) {
    const current = this.installations.get(installed.manifest.id)
    await this.installations.upsert(installed.manifest.id, {
      activeVersion: current?.activeVersion || installed.manifest.version,
      enabled: current?.enabled || false,
    })
    if (!current?.activeVersion || current.activeVersion === installed.manifest.version) {
      this.packageCache.set(`${installed.manifest.id}@${installed.manifest.version}`, Object.freeze(installed))
    }
    await this.ensureDefaultInstance(installed.manifest.id)
    this.events.publish({ type: 'installation-changed', appId: installed.manifest.id })
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
        await this.activateVersionNow(appId, version)
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
    try {
      await this.installations.upsert(appId, {
        activeVersion: version,
        ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
      })
      await this.ensureDefaultInstance(appId)
      await this.reconcileApp(appId)
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
    const instances = !backend
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

  async ensureDefaultInstance(appId) {
    const packageInfo = await this.getActivePackage(appId)
    const backend = packageInfo.manifest.backend
    if (!backend || backend.instanceMode !== 'single') return null
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
    const key = deploymentKey(instance.id, target, targetId)
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

  async setAppEnabledNow(appId, enabled) {
    const packageInfo = await this.getActivePackage(appId)
    if (!packageInfo.manifest.backend) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'UI-only Apps do not have a Backend switch')
    const previous = this.installations.get(appId)
    await this.installations.upsert(appId, { enabled: Boolean(enabled) })
    try {
      await this.reconcileApp(appId)
    } catch (error) {
      await this.installations.upsert(appId, { enabled: previous.enabled })
      await this.reconcileApp(appId).catch(() => {})
      throw error
    }
    this.events.publish({ type: 'installation-changed', appId })
    return this.getApp(appId)
  }

  async listInstances(appId) {
    const packageInfo = await this.getActivePackage(appId)
    const backend = packageInfo.manifest.backend
    const instances = !backend
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
      this.events.publish({ type: 'instance-changed', appId, instanceId: instance.id })
      return this.instances.get(instance.id)
    } catch (error) {
      for (const deployment of this.deployments.list(appId).filter((item) => item.instanceId === instance.id)) {
        await this.removeDeploymentRecord(deployment).catch(() => {})
      }
      await this.credentials.remove(appId, instance.id).catch(() => {})
      await this.instances.remove(instance.id).catch(() => {})
      await fsp.rm(path.join(this.dataDir, appId, 'instances', instance.id), { recursive: true, force: true }).catch(() => {})
      await fsp.rm(path.join(this.runtimeDir, appId, instance.id), { recursive: true, force: true }).catch(() => {})
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
      this.events.publish({ type: 'instance-changed', appId, instanceId })
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
    this.events.publish({ type: 'instance-changed', appId, instanceId })
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
      await fsp.rm(path.join(this.dataDir, appId, 'instances', instanceId), { recursive: true, force: true })
      await fsp.rm(path.join(this.runtimeDir, appId, instanceId), { recursive: true, force: true })
    }
    this.events.publish({ type: 'instance-removed', appId, instanceId })
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
    this.events.publish({ type: 'instance-changed', appId, instanceId })
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
    return this.actions.invoke(deployment, actionName, input, options)
  }

  cancel(appId, instanceId, requestId) {
    this.requireInstance(appId, instanceId)
    const deployment = this.localDeployment(appId, instanceId)
    return deployment ? this.actions.cancel(deployment.key, requestId) : false
  }

  async getLogs(appId, instanceId, options) {
    this.requireInstance(appId, instanceId)
    return this.logs.list(appId, instanceId, options)
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
      packageRoot: packageInfo.root,
      config: instance.config || {},
      secrets: secrets || {},
      dataDir: path.join(this.dataDir, packageInfo.manifest.id, 'instances', instance.id),
      runtimeDir: path.join(this.runtimeDir, packageInfo.manifest.id, instance.id),
      target: { type: deployment.targetType, id: deployment.targetId },
    })
  }

  async reconcileApp(appId) {
    const packageInfo = await this.getActivePackage(appId)
    const backend = packageInfo.manifest.backend
    if (!backend) {
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
        this.events.publish({ type: 'restore-error', appId: installation.appId, error: error.message })
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

  async activateVersion(appId, version) {
    return this.transitionApp(appId, () => this.activateVersionNow(appId, version))
  }

  async activateVersionNow(appId, version) {
    const installation = this.installations.get(appId)
    if (!installation) throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `App is not installed: ${appId}`)
    if (installation.activeVersion === version) return this.getApp(appId)
    const targetPackage = await this.packages.get(appId, version)
    this.packageCache.set(`${appId}@${version}`, targetPackage)
    const previousVersion = installation.activeVersion
    const activeDeployments = this.deployments.list(appId)
    const activeInstanceIds = new Set(this.instances.list(appId).map((instance) => instance.id))
    await Promise.allSettled(activeDeployments.map((item) => this.supervisor.stop(item.key)))
    try {
      await this.installations.upsert(appId, { activeVersion: version })
      for (const deployment of activeDeployments) await this.deployments.bumpGeneration(deployment.key)
      await this.reconcileApp(appId)
      return this.getApp(appId)
    } catch (error) {
      const snapshotKeys = new Set(activeDeployments.map((item) => item.key))
      for (const deployment of this.deployments.list(appId)) {
        await this.supervisor.stop(deployment.key)
        if (!snapshotKeys.has(deployment.key)) {
          this.supervisor.unregister(deployment.key)
          await this.deployments.remove(deployment.key)
        }
      }
      await this.installations.upsert(appId, { activeVersion: previousVersion })
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
    this.events.publish({ type: 'deployment-moved', appId, instanceId, deployment })
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
    await this.packages.removeApp(appId)
    for (const key of this.packageCache.keys()) if (key.startsWith(`${appId}@`)) this.packageCache.delete(key)
    if (options.deleteData) {
      await fsp.rm(path.join(this.dataDir, appId), { recursive: true, force: true })
      await fsp.rm(path.join(this.runtimeDir, appId), { recursive: true, force: true })
      await this.logs.removeApp(appId)
    }
    if (options.deleteCredentials) {
      await this.credentials.removeApp(appId)
      if (!options.deleteData) {
        for (const instance of this.instances.list(appId)) {
          await this.instances.update(instance.id, { secretRefs: {} })
        }
      }
    }
    this.events.publish({ type: 'app-uninstalled', appId })
    return true
  }

  async shutdown() {
    if (this.leaseTimer) clearInterval(this.leaseTimer)
    await this.supervisor.shutdown()
    if (this.target === 'server') {
      await Promise.allSettled(this.deployments.list().map((item) => this.deployments.releaseLease(item.key, this.hostId)))
    }
  }
}
