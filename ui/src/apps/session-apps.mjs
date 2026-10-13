import { normalizeStringList } from '../shared/string-list.mjs'
import { getAppToolServices, isToolSourceAvailable, parseAppServiceKey } from '../../../packages/app-sdk/src/tool-services.mjs'

/** Scope changes wait for runtime reload; explicitly removing an App still revokes it. */
export function canInvokeSessionAppTool(record, contribution) {
  const scope = record.runtimeAppToolScopes?.[contribution.id] ?? contribution.toolScope
  return Boolean(record.runtimeAppToolIds?.has(contribution.id) && isToolSourceAvailable({ ...contribution, toolScope: scope }, record.appIds, record.appServiceIds))
}

/** Main owns validated selection; the running runtime keeps its own snapshot. */
export function createSessionApps({ getRuntime, getMcpHost, isBusy, disposeRuntime, persist, emit, onRemoved = async () => {} }) {
  async function catalog(appId) {
    const runtime = getRuntime()
    const installation = runtime?.installations?.get(appId)
    const pkg = await runtime?.getActivePackage?.(appId).catch(() => null)
    const manifest = pkg?.manifest
    if (manifest?.toolSelection !== 'services') return { app: { id: appId, toolSelection: 'app' }, services: [] }
    const { tools } = runtime ? await runtime.listContributions({ appId, kinds: ['tools'] }).catch(() => ({ tools: [] })) : { tools: [] }
    const app = { id: appId, enabled: installation?.enabled, grants: installation?.grants || [],
      toolSelection: manifest?.toolSelection, contributes: manifest?.contributes,
      agentTools: tools, mcpServices: getMcpHost()?.toolCatalog(appId) || [] }
    const mcpHost = getMcpHost()
    const pending = manifest.host?.protocols?.includes('moss.mcp/v1') && typeof mcpHost?.hasApp === 'function' && !mcpHost.hasApp(appId)
    return { app, services: getAppToolServices(app), pending }
  }

  async function validateServiceIds(value, previous = []) {
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !parseAppServiceKey(id))) throw new Error('App 子服务选择无效')
    const ids = normalizeStringList(value), catalogs = new Map()
    for (const id of ids) {
      if (previous.includes(id)) continue
      const { appId } = parseAppServiceKey(id)
      if (!catalogs.has(appId)) catalogs.set(appId, await catalog(appId))
      if (!catalogs.get(appId).services.some(service => service.id === id && service.available)) {
        throw new Error('此子服务暂不可用，请检查启用状态、授权或服务配置')
      }
    }
    return ids
  }

  async function validateSelection(value, previous = {}) {
    const ids = await validateIds(value.appIds || [], previous.appIds || [])
    const appIds = [], appServiceIds = [...(value.appServiceIds || [])], retained = [...(previous.appServiceIds || [])]
    for (const id of ids) {
      const { app, services, pending } = await catalog(id)
      if (app.toolSelection !== 'services') { appIds.push(id); continue }
      // Upgrade an old whole-App selection exactly once to a concrete snapshot.
      const existing = previous.appIds?.includes(id)
      // Startup may expose the manifest before the persisted MCP catalog is loaded.
      if (existing && pending) { appIds.push(id); continue }
      const selected = services.filter(service => existing || service.available).map(service => service.id)
      appServiceIds.push(...selected)
      if (existing) retained.push(...selected)
    }
    return { appIds, appServiceIds: await validateServiceIds(appServiceIds, retained) }
  }

  async function migrateRecordNow(record) {
    if (!record?.appIds?.length) return
    const next = await validateSelection(record, record)
    if (JSON.stringify(next.appIds) === JSON.stringify(record.appIds)) return
    Object.assign(record, next)
    if (record.runtime) {
      if (isBusy(record)) record.pendingMcpRuntimeReload = true
      else disposeRuntime(record)
    }
    persist(record, true); emit(record)
  }
  async function validateIds(value, previous = []) {
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id.trim())) throw new Error('App 选择无效')
    const ids = normalizeStringList(value)
    const runtime = getRuntime()
    for (const id of ids) {
      if (previous.includes(id)) continue // Retain unavailable selections so they can be removed.
      const installation = runtime?.installations.get(id)
      if (!installation?.enabled) throw new Error('请先启用要加入会话的 App')
      const { tools } = await runtime.listContributions({ appId: id, kinds: ['tools'] })
      const services = getMcpHost()?.toolCatalog(id) || []
      if (!tools.length && !services.some(service => !['app-disabled', 'instance-disabled', 'unauthorized', 'disabled'].includes(service.status))) {
        throw new Error('此 App 暂未提供可用工具，请检查授权或服务配置')
      }
    }
    return ids
  }
  const queues = new WeakMap()
  async function updateNow(record, value) {
    if (record.agentMode === 'remote-direct' || record.isSubAgent) throw new Error('App 工具需要本地普通会话')
    await migrateRecordNow(record)
    if (typeof value === 'function') value = value(record.appIds || [], record.appServiceIds || [])
    const next = await validateSelection(Array.isArray(value) ? { appIds: value, appServiceIds: record.appServiceIds || [] } : value, record)
    const ids = next.appIds
    if (JSON.stringify(ids) === JSON.stringify(record.appIds || []) && JSON.stringify(next.appServiceIds) === JSON.stringify(record.appServiceIds || [])) return false
    const removed = [...new Set([
      ...(record.appIds || []).filter(id => !ids.includes(id)),
      ...(record.appServiceIds || []).filter(id => !next.appServiceIds.includes(id)).map(id => parseAppServiceKey(id)?.appId).filter(Boolean),
    ])]
    Object.assign(record, next)
    // Publish the new authorization state before awaiting driver cancellation.
    // Busy runtimes retain their schema snapshot, but cannot retain control.
    try { await onRemoved(record, removed) }
    catch (error) { persist(record, true); emit(record); throw error }
    record.updatedAt = Date.now()
    const deferred = Boolean(record.runtime && isBusy(record))
    if (record.runtime) {
      if (deferred) record.pendingMcpRuntimeReload = true
      else disposeRuntime(record)
    }
    persist(record, true)
    emit(record)
    return deferred
  }
  function enqueue(record, operation) {
    const task = (queues.get(record) || Promise.resolve()).catch(() => {}).then(operation)
    queues.set(record, task)
    void task.finally(() => { if (queues.get(record) === task) queues.delete(record) }).catch(() => {})
    return task
  }
  function migrateRecord(record) { return record ? enqueue(record, () => migrateRecordNow(record)) : Promise.resolve() }
  function update(record, value) { return enqueue(record, () => updateNow(record, value)) }
  function toggle(record, id) {
    if (typeof id !== 'string' || !id.trim()) return Promise.reject(new Error('App 选择无效'))
    return update(record, ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])
  }
  function toggleService(record, id) {
    if (!parseAppServiceKey(id)) return Promise.reject(new Error('App 子服务选择无效'))
    return update(record, (appIds, ids) => ({ appIds, appServiceIds: ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] }))
  }
  function setServices(record, appId, ids) {
    if (!Array.isArray(ids) || ids.some(id => parseAppServiceKey(id)?.appId !== appId)) return Promise.reject(new Error('App 子服务选择无效'))
    return update(record, (appIds, previous) => ({ appIds, appServiceIds: [...previous.filter(id => parseAppServiceKey(id)?.appId !== appId), ...ids] }))
  }
  async function resourceAppId(providerId) {
    const provider = await getRuntime().requireContribution('resourceProviders', providerId)
    await validateIds([provider.appId])
    return provider.appId
  }
  return { validateIds, validateServiceIds, validateSelection, migrateRecord, update, toggle, toggleService, setServices, resourceAppId }
}
