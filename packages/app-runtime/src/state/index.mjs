import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  APP_ERROR_CODES,
  AppServiceError,
  compileJsonSchema,
  loadJsonSchema,
} from '../../../app-sdk/src/index.mjs'

const EMPTY_STATE = Object.freeze({ version: 1, installations: {}, instances: {}, deployments: {} })

function clone(value) { return structuredClone(value) }

export function defaultInstanceId(appId) {
  return `${appId}--default`
}

function normalizeInstanceId(appId, value, single) {
  const id = single ? defaultInstanceId(appId) : String(value || `${appId}--${randomUUID()}`).trim()
  if (
    id.length > 160 ||
    !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(id) ||
    !id.startsWith(`${appId}--`)
  ) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Instance id must use the ${appId}-- prefix and filesystem-safe characters`)
  }
  return id
}

export function deploymentKey(instanceId, targetType, targetId) {
  return `${instanceId}@${targetType}:${targetId}`
}

export class JsonAppStateStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath)
    this.state = clone(EMPTY_STATE)
    this.queue = Promise.resolve()
  }

  async initialize() {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.filePath, 'utf8'))
      this.state = {
        version: 1,
        installations: parsed?.installations || {},
        instances: parsed?.instances || {},
        deployments: parsed?.deployments || {},
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await this.persist()
    }
    return this
  }

  snapshot() { return clone(this.state) }

  async transaction(mutator) {
    const operation = this.queue.then(async () => {
      const next = clone(this.state)
      const result = await mutator(next)
      const previous = this.state
      this.state = next
      try {
        await this.persist()
      } catch (error) {
        this.state = previous
        throw error
      }
      return result
    })
    this.queue = operation.catch(() => {})
    return operation
  }

  async persist() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await fsp.writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 })
      await fsp.rename(temporary, this.filePath)
    } finally {
      await fsp.rm(temporary, { force: true }).catch(() => {})
    }
  }
}

export class SqliteAppStateStore {
  constructor(databasePath) {
    this.databasePath = path.resolve(databasePath)
    this.db = null
    this.queue = Promise.resolve()
  }

  async initialize() {
    await fsp.mkdir(path.dirname(this.databasePath), { recursive: true })
    const { DatabaseSync } = await import('node:sqlite')
    this.db = new DatabaseSync(this.databasePath)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS app_installations (
        app_id TEXT PRIMARY KEY, active_version TEXT, enabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_instances (
        id TEXT PRIMARY KEY, app_id TEXT NOT NULL, display_name TEXT NOT NULL,
        config_json TEXT NOT NULL, secret_refs_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_app_instances_app_id ON app_instances(app_id);
      CREATE TABLE IF NOT EXISTS app_deployments (
        deployment_key TEXT PRIMARY KEY, app_id TEXT NOT NULL, instance_id TEXT NOT NULL,
        target_type TEXT NOT NULL, target_id TEXT NOT NULL, desired_state TEXT NOT NULL,
        generation INTEGER NOT NULL, lease_owner TEXT, lease_expires_at INTEGER, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_app_deployments_app_id ON app_deployments(app_id);
    `)
    return this
  }

  readState() {
    if (!this.db) throw new Error('SQLite App state store is not initialized')
    const installations = {}
    for (const row of this.db.prepare('SELECT * FROM app_installations').all()) {
      installations[row.app_id] = {
        appId: row.app_id, activeVersion: row.active_version, enabled: Boolean(row.enabled),
        createdAt: row.created_at, updatedAt: row.updated_at,
      }
    }
    const instances = {}
    for (const row of this.db.prepare('SELECT * FROM app_instances').all()) {
      instances[row.id] = {
        id: row.id, appId: row.app_id, displayName: row.display_name,
        config: JSON.parse(row.config_json), secretRefs: JSON.parse(row.secret_refs_json),
        enabled: Boolean(row.enabled), createdAt: row.created_at, updatedAt: row.updated_at,
      }
    }
    const deployments = {}
    for (const row of this.db.prepare('SELECT * FROM app_deployments').all()) {
      deployments[row.deployment_key] = {
        key: row.deployment_key, appId: row.app_id, instanceId: row.instance_id,
        targetType: row.target_type, targetId: row.target_id, desiredState: row.desired_state,
        generation: row.generation, leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at,
        updatedAt: row.updated_at,
      }
    }
    return { version: 1, installations, instances, deployments }
  }

  snapshot() { return clone(this.readState()) }

  async transaction(mutator) {
    const operation = this.queue.then(async () => {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const next = this.readState()
        const result = await mutator(next)
        this.writeState(next)
        this.db.exec('COMMIT')
        return result
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    })
    this.queue = operation.catch(() => {})
    return operation
  }

  writeState(state) {
    this.db.exec('DELETE FROM app_installations; DELETE FROM app_instances; DELETE FROM app_deployments;')
    const insertInstallation = this.db.prepare('INSERT INTO app_installations VALUES (?, ?, ?, ?, ?)')
    for (const item of Object.values(state.installations)) {
      insertInstallation.run(item.appId, item.activeVersion, item.enabled ? 1 : 0, item.createdAt, item.updatedAt)
    }
    const insertInstance = this.db.prepare('INSERT INTO app_instances VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    for (const item of Object.values(state.instances)) {
      insertInstance.run(item.id, item.appId, item.displayName, JSON.stringify(item.config || {}), JSON.stringify(item.secretRefs || {}), item.enabled ? 1 : 0, item.createdAt, item.updatedAt)
    }
    const insertDeployment = this.db.prepare('INSERT INTO app_deployments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const item of Object.values(state.deployments)) {
      insertDeployment.run(item.key, item.appId, item.instanceId, item.targetType, item.targetId, item.desiredState, item.generation, item.leaseOwner, item.leaseExpiresAt, item.updatedAt)
    }
  }

  close() { this.db?.close(); this.db = null }
}

export class InstallationStore {
  constructor(state) { this.state = state }
  list() { return Object.values(this.state.snapshot().installations) }
  get(appId) { return this.state.snapshot().installations[appId] || null }
  async upsert(appId, patch) {
    return this.state.transaction((state) => {
      const timestamp = Date.now()
      const previous = state.installations[appId]
      state.installations[appId] = {
        appId,
        activeVersion: patch.activeVersion ?? previous?.activeVersion ?? null,
        enabled: patch.enabled ?? previous?.enabled ?? false,
        createdAt: previous?.createdAt || timestamp,
        updatedAt: timestamp,
      }
      return clone(state.installations[appId])
    })
  }
  async remove(appId) {
    await this.state.transaction((state) => { delete state.installations[appId] })
  }
}

export class InstanceStore {
  constructor(state) { this.state = state }
  list(appId) { return Object.values(this.state.snapshot().instances).filter((item) => item.appId === appId) }
  get(instanceId) { return this.state.snapshot().instances[instanceId] || null }
  async create(appId, input = {}, options = {}) {
    const id = normalizeInstanceId(appId, input.id, options.single)
    return this.state.transaction((state) => {
      const existing = state.instances[id]
      if (existing && existing.appId !== appId) throw new AppServiceError(APP_ERROR_CODES.unauthorized, 'Instance id belongs to another App')
      if (existing && !options.single) throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Instance already exists: ${id}`)
      const timestamp = Date.now()
      const displayName = String(input.displayName || (options.single ? 'Default' : 'New instance')).trim()
      if (!displayName || displayName.length > 120) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Instance display name must contain 1 to 120 characters')
      state.instances[id] = {
        id,
        appId,
        displayName,
        config: clone(input.config || {}),
        secretRefs: clone(input.secretRefs || {}),
        enabled: input.enabled ?? existing?.enabled ?? false,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
      }
      return clone(state.instances[id])
    })
  }
  async update(instanceId, patch) {
    return this.state.transaction((state) => {
      const current = state.instances[instanceId]
      if (!current) throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Unknown App instance: ${instanceId}`)
      const displayName = patch.displayName === undefined ? current.displayName : String(patch.displayName).trim()
      if (!displayName || displayName.length > 120) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Instance display name must contain 1 to 120 characters')
      state.instances[instanceId] = {
        ...current,
        ...(patch.displayName !== undefined ? { displayName } : {}),
        ...(patch.config !== undefined ? { config: clone(patch.config) } : {}),
        ...(patch.secretRefs !== undefined ? { secretRefs: clone(patch.secretRefs) } : {}),
        ...(patch.enabled !== undefined ? { enabled: Boolean(patch.enabled) } : {}),
        updatedAt: Date.now(),
      }
      return clone(state.instances[instanceId])
    })
  }
  async remove(instanceId) {
    await this.state.transaction((state) => { delete state.instances[instanceId] })
  }
  async removeForApp(appId) {
    await this.state.transaction((state) => {
      for (const [id, item] of Object.entries(state.instances)) if (item.appId === appId) delete state.instances[id]
    })
  }
}

export class DeploymentStore {
  constructor(state) { this.state = state }
  list(appId) {
    return Object.values(this.state.snapshot().deployments).filter((item) => !appId || item.appId === appId)
  }
  get(key) { return this.state.snapshot().deployments[key] || null }
  async upsert(input) {
    const key = deploymentKey(input.instanceId, input.targetType, input.targetId)
    return this.state.transaction((state) => {
      const current = state.deployments[key]
      state.deployments[key] = {
        key,
        appId: input.appId,
        instanceId: input.instanceId,
        targetType: input.targetType,
        targetId: input.targetId,
        desiredState: input.desiredState ?? current?.desiredState ?? 'stopped',
        generation: input.generation ?? current?.generation ?? 1,
        leaseOwner: input.leaseOwner ?? current?.leaseOwner ?? null,
        leaseExpiresAt: input.leaseExpiresAt ?? current?.leaseExpiresAt ?? null,
        updatedAt: Date.now(),
      }
      return clone(state.deployments[key])
    })
  }
  async bumpGeneration(key, patch = {}) {
    return this.state.transaction((state) => {
      const current = state.deployments[key]
      if (!current) throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Unknown App deployment: ${key}`)
      state.deployments[key] = { ...current, ...patch, generation: current.generation + 1, updatedAt: Date.now() }
      return clone(state.deployments[key])
    })
  }
  async acquireLease(key, owner, ttlMs, now = Date.now()) {
    return this.state.transaction((state) => {
      const current = state.deployments[key]
      if (!current) throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Unknown App deployment: ${key}`)
      if (current.leaseOwner && current.leaseOwner !== owner && current.leaseExpiresAt > now) return null
      if (current.leaseOwner && current.leaseOwner !== owner) current.generation += 1
      current.leaseOwner = owner
      current.leaseExpiresAt = now + ttlMs
      current.updatedAt = now
      return clone(current)
    })
  }
  async releaseLease(key, owner) {
    await this.state.transaction((state) => {
      const current = state.deployments[key]
      if (current?.leaseOwner === owner) {
        current.generation += 1
        current.leaseOwner = null
        current.leaseExpiresAt = null
        current.updatedAt = Date.now()
      }
    })
  }
  async remove(key) { await this.state.transaction((state) => { delete state.deployments[key] }) }
  async removeForApp(appId) {
    await this.state.transaction((state) => {
      for (const [key, item] of Object.entries(state.deployments)) if (item.appId === appId) delete state.deployments[key]
    })
  }
}

export function validateConfiguration(packageRoot, backend, config, secrets = {}) {
  const validate = (relativePath, value, name) => {
    if (!relativePath) return
    const schema = loadJsonSchema(packageRoot, relativePath, name)
    const validator = compileJsonSchema(schema)
    if (!validator(value)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Invalid ${name}: ${JSON.stringify(validator.errors)}`)
    }
  }
  validate(backend?.configuration?.schema, config || {}, 'App configuration')
  validate(backend?.configuration?.secrets, secrets || {}, 'App secrets')
  return true
}
