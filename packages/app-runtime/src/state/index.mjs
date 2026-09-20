import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  APP_ERROR_CODES,
  AppServiceError,
  compileJsonSchema,
  loadJsonSchema,
} from '../../../app-sdk/src/index.mjs'

const EMPTY_STATE = Object.freeze({ version: 3, installations: {}, instances: {}, deployments: {} })
export const DEFAULT_APP_OWNER = Object.freeze({
  scope: 'host',
  orgId: null,
  userId: null,
  key: 'host',
})

function clone(value) { return structuredClone(value) }

function normalizeGrants(value) {
  if (!Array.isArray(value)) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'App grants must be an array')
  const grants = value.map((entry) => String(entry || '').trim())
  if (grants.some((entry) => !entry || entry.length > 160 || !/^[a-z][a-z0-9:._-]*$/.test(entry))) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'App grant is invalid')
  }
  return [...new Set(grants)].sort()
}

function ownerSegment(value) {
  return encodeURIComponent(String(value || '').trim())
}

export function normalizeAppOwner(value = DEFAULT_APP_OWNER) {
  const scope = value?.scope || 'host'
  if (!['host', 'org', 'user'].includes(scope)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Invalid App owner scope: ${String(scope)}`)
  }
  const orgId = scope === 'host' ? null : String(value?.orgId || '').trim()
  const userId = scope === 'user' ? String(value?.userId || '').trim() : null
  if (scope !== 'host' && (!orgId || orgId.length > 256)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${scope} App owner requires orgId`)
  }
  if (scope === 'user' && (!userId || userId.length > 256)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'user App owner requires userId')
  }
  const key = scope === 'host'
    ? 'host'
    : scope === 'org'
      ? `org:${ownerSegment(orgId)}`
      : `user:${ownerSegment(orgId)}:${ownerSegment(userId)}`
  return Object.freeze({ scope, orgId, userId, key })
}

function scopedRecordKey(owner, id) {
  return owner.key === DEFAULT_APP_OWNER.key ? id : `${owner.key}::${id}`
}

function recordOwner(item) {
  return normalizeAppOwner(item?.owner || DEFAULT_APP_OWNER)
}

function ownerMatches(item, owner) {
  return recordOwner(item).key === owner.key
}

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

export function deploymentKey(instanceId, targetType, targetId, owner = DEFAULT_APP_OWNER) {
  return scopedRecordKey(normalizeAppOwner(owner), `${instanceId}@${targetType}:${targetId}`)
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
      const installations = {}
      for (const item of Object.values(parsed?.installations || {})) {
        const owner = recordOwner(item)
        const normalized = { ...item, owner, grants: normalizeGrants(Array.isArray(item?.grants) ? item.grants : []) }
        installations[scopedRecordKey(owner, normalized.appId)] = normalized
      }
      const instances = {}
      for (const item of Object.values(parsed?.instances || {})) {
        const owner = recordOwner(item)
        instances[scopedRecordKey(owner, item.id)] = { ...item, owner }
      }
      const deployments = {}
      for (const item of Object.values(parsed?.deployments || {})) {
        const owner = recordOwner(item)
        const key = deploymentKey(item.instanceId, item.targetType, item.targetId, owner)
        deployments[key] = { ...item, key, owner }
      }
      this.state = { version: 3, installations, instances, deployments }
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
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
    const tableExists = (name) => Boolean(this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(name))
    const columns = (name) => new Set(this.db.prepare(`PRAGMA table_info(${name})`).all().map((row) => row.name))
    const legacyInstallations = tableExists('app_installations') && !columns('app_installations').has('owner_key')
    const legacyInstances = tableExists('app_instances') && !columns('app_instances').has('owner_key')
    const legacyDeployments = tableExists('app_deployments') && !columns('app_deployments').has('owner_key')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (legacyInstallations) this.db.exec('ALTER TABLE app_installations RENAME TO app_installations_legacy_owner')
      if (legacyInstances) this.db.exec('ALTER TABLE app_instances RENAME TO app_instances_legacy_owner')
      if (legacyDeployments) this.db.exec('ALTER TABLE app_deployments RENAME TO app_deployments_legacy_owner')
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS app_installations (
          record_key TEXT PRIMARY KEY, owner_key TEXT NOT NULL, owner_scope TEXT NOT NULL,
          org_id TEXT, user_id TEXT, app_id TEXT NOT NULL, active_version TEXT,
          enabled INTEGER NOT NULL DEFAULT 0, grants_json TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          UNIQUE(owner_key, app_id)
        );
        CREATE INDEX IF NOT EXISTS idx_app_installations_owner ON app_installations(owner_key, app_id);
        CREATE TABLE IF NOT EXISTS app_instances (
          record_key TEXT PRIMARY KEY, owner_key TEXT NOT NULL, owner_scope TEXT NOT NULL,
          org_id TEXT, user_id TEXT, id TEXT NOT NULL, app_id TEXT NOT NULL, display_name TEXT NOT NULL,
          config_json TEXT NOT NULL, secret_refs_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          UNIQUE(owner_key, id)
        );
        CREATE INDEX IF NOT EXISTS idx_app_instances_owner_app ON app_instances(owner_key, app_id);
        CREATE TABLE IF NOT EXISTS app_deployments (
          deployment_key TEXT PRIMARY KEY, owner_key TEXT NOT NULL, owner_scope TEXT NOT NULL,
          org_id TEXT, user_id TEXT, app_id TEXT NOT NULL, instance_id TEXT NOT NULL,
          target_type TEXT NOT NULL, target_id TEXT NOT NULL, desired_state TEXT NOT NULL,
          generation INTEGER NOT NULL, lease_owner TEXT, lease_expires_at INTEGER, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_app_deployments_owner_app ON app_deployments(owner_key, app_id);
      `)
      if (legacyInstallations) {
        const legacyColumns = columns('app_installations_legacy_owner')
        const grantsExpression = legacyColumns.has('grants_json') ? 'grants_json' : "'[]'"
        this.db.exec(`
          INSERT INTO app_installations
            (record_key, owner_key, owner_scope, org_id, user_id, app_id, active_version, enabled, grants_json, created_at, updated_at)
          SELECT app_id, 'host', 'host', NULL, NULL, app_id, active_version, enabled,
            ${grantsExpression}, created_at, updated_at
          FROM app_installations_legacy_owner;
          DROP TABLE app_installations_legacy_owner;
        `)
      }
      if (legacyInstances) {
        this.db.exec(`
          INSERT INTO app_instances
            (record_key, owner_key, owner_scope, org_id, user_id, id, app_id, display_name, config_json, secret_refs_json, enabled, created_at, updated_at)
          SELECT id, 'host', 'host', NULL, NULL, id, app_id, display_name, config_json, secret_refs_json, enabled, created_at, updated_at
          FROM app_instances_legacy_owner;
          DROP TABLE app_instances_legacy_owner;
        `)
      }
      if (legacyDeployments) {
        this.db.exec(`
          INSERT INTO app_deployments
            (deployment_key, owner_key, owner_scope, org_id, user_id, app_id, instance_id, target_type, target_id, desired_state, generation, lease_owner, lease_expires_at, updated_at)
          SELECT deployment_key, 'host', 'host', NULL, NULL, app_id, instance_id, target_type, target_id, desired_state, generation, lease_owner, lease_expires_at, updated_at
          FROM app_deployments_legacy_owner;
          DROP TABLE app_deployments_legacy_owner;
        `)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this
  }

  readState() {
    if (!this.db) throw new Error('SQLite App state store is not initialized')
    const installations = {}
    for (const row of this.db.prepare('SELECT * FROM app_installations').all()) {
      const owner = normalizeAppOwner({ scope: row.owner_scope, orgId: row.org_id, userId: row.user_id })
      installations[row.record_key] = {
        appId: row.app_id, activeVersion: row.active_version, enabled: Boolean(row.enabled),
        grants: normalizeGrants(JSON.parse(row.grants_json || '[]')),
        owner,
        createdAt: row.created_at, updatedAt: row.updated_at,
      }
    }
    const instances = {}
    for (const row of this.db.prepare('SELECT * FROM app_instances').all()) {
      const owner = normalizeAppOwner({ scope: row.owner_scope, orgId: row.org_id, userId: row.user_id })
      instances[row.record_key] = {
        id: row.id, appId: row.app_id, displayName: row.display_name,
        config: JSON.parse(row.config_json), secretRefs: JSON.parse(row.secret_refs_json),
        enabled: Boolean(row.enabled), owner, createdAt: row.created_at, updatedAt: row.updated_at,
      }
    }
    const deployments = {}
    for (const row of this.db.prepare('SELECT * FROM app_deployments').all()) {
      const owner = normalizeAppOwner({ scope: row.owner_scope, orgId: row.org_id, userId: row.user_id })
      deployments[row.deployment_key] = {
        key: row.deployment_key, appId: row.app_id, instanceId: row.instance_id,
        targetType: row.target_type, targetId: row.target_id, desiredState: row.desired_state,
        generation: row.generation, leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at,
        owner,
        updatedAt: row.updated_at,
      }
    }
    return { version: 3, installations, instances, deployments }
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
    const insertInstallation = this.db.prepare(`
      INSERT INTO app_installations
        (record_key, owner_key, owner_scope, org_id, user_id, app_id, active_version, enabled, grants_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const [recordKey, item] of Object.entries(state.installations)) {
      const owner = recordOwner(item)
      insertInstallation.run(
        recordKey,
        owner.key,
        owner.scope,
        owner.orgId,
        owner.userId,
        item.appId,
        item.activeVersion,
        item.enabled ? 1 : 0,
        JSON.stringify(item.grants || []),
        item.createdAt,
        item.updatedAt,
      )
    }
    const insertInstance = this.db.prepare(`
      INSERT INTO app_instances
        (record_key, owner_key, owner_scope, org_id, user_id, id, app_id, display_name, config_json, secret_refs_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const [recordKey, item] of Object.entries(state.instances)) {
      const owner = recordOwner(item)
      insertInstance.run(
        recordKey, owner.key, owner.scope, owner.orgId, owner.userId,
        item.id, item.appId, item.displayName, JSON.stringify(item.config || {}),
        JSON.stringify(item.secretRefs || {}), item.enabled ? 1 : 0, item.createdAt, item.updatedAt,
      )
    }
    const insertDeployment = this.db.prepare(`
      INSERT INTO app_deployments
        (deployment_key, owner_key, owner_scope, org_id, user_id, app_id, instance_id, target_type, target_id, desired_state, generation, lease_owner, lease_expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const item of Object.values(state.deployments)) {
      const owner = recordOwner(item)
      insertDeployment.run(
        item.key, owner.key, owner.scope, owner.orgId, owner.userId,
        item.appId, item.instanceId, item.targetType, item.targetId, item.desiredState,
        item.generation, item.leaseOwner, item.leaseExpiresAt, item.updatedAt,
      )
    }
  }

  close() { this.db?.close(); this.db = null }
}

export class InstallationStore {
  constructor(state, options = {}) {
    this.state = state
    this.ownerResolver = options.ownerResolver || (() => DEFAULT_APP_OWNER)
  }
  owner() { return normalizeAppOwner(this.ownerResolver()) }
  list() {
    const owner = this.owner()
    return Object.values(this.state.snapshot().installations).filter((item) => ownerMatches(item, owner))
  }
  listAll() { return Object.values(this.state.snapshot().installations) }
  listOwners() {
    const owners = new Map(this.listAll().map((item) => {
      const owner = recordOwner(item)
      return [owner.key, owner]
    }))
    return [...owners.values()]
  }
  get(appId) {
    const owner = this.owner()
    return this.state.snapshot().installations[scopedRecordKey(owner, appId)] || null
  }
  async upsert(appId, patch) {
    const owner = this.owner()
    const key = scopedRecordKey(owner, appId)
    return this.state.transaction((state) => {
      const timestamp = Date.now()
      const previous = state.installations[key]
      state.installations[key] = {
        appId,
        owner,
        activeVersion: patch.activeVersion ?? previous?.activeVersion ?? null,
        enabled: patch.enabled ?? previous?.enabled ?? false,
        grants: normalizeGrants(patch.grants ?? previous?.grants ?? []),
        createdAt: previous?.createdAt || timestamp,
        updatedAt: timestamp,
      }
      return clone(state.installations[key])
    })
  }
  async remove(appId) {
    const key = scopedRecordKey(this.owner(), appId)
    await this.state.transaction((state) => { delete state.installations[key] })
  }
}

export class InstanceStore {
  constructor(state, options = {}) {
    this.state = state
    this.ownerResolver = options.ownerResolver || (() => DEFAULT_APP_OWNER)
  }
  owner() { return normalizeAppOwner(this.ownerResolver()) }
  list(appId) {
    const owner = this.owner()
    return Object.values(this.state.snapshot().instances).filter((item) =>
      item.appId === appId && ownerMatches(item, owner))
  }
  listAll() { return Object.values(this.state.snapshot().instances) }
  get(instanceId) {
    const owner = this.owner()
    return this.state.snapshot().instances[scopedRecordKey(owner, instanceId)] || null
  }
  async create(appId, input = {}, options = {}) {
    const id = normalizeInstanceId(appId, input.id, options.single)
    const owner = this.owner()
    const key = scopedRecordKey(owner, id)
    return this.state.transaction((state) => {
      const existing = state.instances[key]
      if (existing && existing.appId !== appId) throw new AppServiceError(APP_ERROR_CODES.unauthorized, 'Instance id belongs to another App')
      if (existing && !options.single) throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Instance already exists: ${id}`)
      const timestamp = Date.now()
      const displayName = String(input.displayName || (options.single ? 'Default' : 'New instance')).trim()
      if (!displayName || displayName.length > 120) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Instance display name must contain 1 to 120 characters')
      state.instances[key] = {
        id,
        appId,
        owner,
        displayName,
        config: clone(input.config || {}),
        secretRefs: clone(input.secretRefs || {}),
        enabled: input.enabled ?? existing?.enabled ?? false,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
      }
      return clone(state.instances[key])
    })
  }
  async update(instanceId, patch) {
    const owner = this.owner()
    const key = scopedRecordKey(owner, instanceId)
    return this.state.transaction((state) => {
      const current = state.instances[key]
      if (!current) throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Unknown App instance: ${instanceId}`)
      const displayName = patch.displayName === undefined ? current.displayName : String(patch.displayName).trim()
      if (!displayName || displayName.length > 120) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Instance display name must contain 1 to 120 characters')
      state.instances[key] = {
        ...current,
        ...(patch.displayName !== undefined ? { displayName } : {}),
        ...(patch.config !== undefined ? { config: clone(patch.config) } : {}),
        ...(patch.secretRefs !== undefined ? { secretRefs: clone(patch.secretRefs) } : {}),
        ...(patch.enabled !== undefined ? { enabled: Boolean(patch.enabled) } : {}),
        updatedAt: Date.now(),
      }
      return clone(state.instances[key])
    })
  }
  async remove(instanceId) {
    const key = scopedRecordKey(this.owner(), instanceId)
    await this.state.transaction((state) => { delete state.instances[key] })
  }
  async removeForApp(appId) {
    const owner = this.owner()
    await this.state.transaction((state) => {
      for (const [id, item] of Object.entries(state.instances)) {
        if (item.appId === appId && ownerMatches(item, owner)) delete state.instances[id]
      }
    })
  }
}

export class DeploymentStore {
  constructor(state, options = {}) {
    this.state = state
    this.ownerResolver = options.ownerResolver || (() => DEFAULT_APP_OWNER)
  }
  owner() { return normalizeAppOwner(this.ownerResolver()) }
  list(appId) {
    const owner = this.owner()
    return Object.values(this.state.snapshot().deployments).filter((item) =>
      (!appId || item.appId === appId) && ownerMatches(item, owner))
  }
  listAll() { return Object.values(this.state.snapshot().deployments) }
  get(key) {
    const item = this.state.snapshot().deployments[key] || null
    return item && ownerMatches(item, this.owner()) ? item : null
  }
  async upsert(input) {
    const owner = this.owner()
    const key = deploymentKey(input.instanceId, input.targetType, input.targetId, owner)
    return this.state.transaction((state) => {
      const current = state.deployments[key]
      state.deployments[key] = {
        key,
        owner,
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
    const owner = this.owner()
    return this.state.transaction((state) => {
      const current = state.deployments[key]
      if (!current || !ownerMatches(current, owner)) throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Unknown App deployment: ${key}`)
      state.deployments[key] = { ...current, ...patch, generation: current.generation + 1, updatedAt: Date.now() }
      return clone(state.deployments[key])
    })
  }
  async acquireLease(key, owner, ttlMs, now = Date.now()) {
    const recordOwnerValue = this.owner()
    return this.state.transaction((state) => {
      const current = state.deployments[key]
      if (!current || !ownerMatches(current, recordOwnerValue)) throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Unknown App deployment: ${key}`)
      if (current.leaseOwner && current.leaseOwner !== owner && current.leaseExpiresAt > now) return null
      if (current.leaseOwner && current.leaseOwner !== owner) current.generation += 1
      current.leaseOwner = owner
      current.leaseExpiresAt = now + ttlMs
      current.updatedAt = now
      return clone(current)
    })
  }
  async releaseLease(key, owner) {
    const recordOwnerValue = this.owner()
    await this.state.transaction((state) => {
      const current = state.deployments[key]
      if (current && ownerMatches(current, recordOwnerValue) && current.leaseOwner === owner) {
        current.generation += 1
        current.leaseOwner = null
        current.leaseExpiresAt = null
        current.updatedAt = Date.now()
      }
    })
  }
  async remove(key) {
    const owner = this.owner()
    await this.state.transaction((state) => {
      if (state.deployments[key] && ownerMatches(state.deployments[key], owner)) delete state.deployments[key]
    })
  }
  async removeForApp(appId) {
    const owner = this.owner()
    await this.state.transaction((state) => {
      for (const [key, item] of Object.entries(state.deployments)) {
        if (item.appId === appId && ownerMatches(item, owner)) delete state.deployments[key]
      }
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
