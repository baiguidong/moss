/** Stable, opaque selection keys. Display names and transport names are never identities. */
export function appServiceKey(appId, serviceId) {
  return JSON.stringify([appId, serviceId])
}

export function parseAppServiceKey(value) {
  try {
    const parts = JSON.parse(value)
    return Array.isArray(parts) && parts.length === 2 && parts.every(part => typeof part === 'string' && part.length > 0)
      && appServiceKey(...parts) === value ? { appId: parts[0], serviceId: parts[1] } : null
  } catch { return null }
}

export function isToolSourceSelected(owner, appIds = [], appServiceIds = []) {
  return owner.toolSelection === 'services'
    ? Boolean(owner.serviceId && appServiceIds.includes(appServiceKey(owner.appId, owner.serviceId)))
    : appIds.includes(owner.appId)
}

export function isToolSourceAvailable(owner, appIds = [], appServiceIds = []) {
  return owner.toolScope === 'global' || isToolSourceSelected(owner, appIds, appServiceIds)
}

export function canSelectMcpService(service) {
  return ['unchecked', 'authorized'].includes(service.status)
    || (service.status === 'connected' && service.tools.some(tool => !tool.disabled))
}

/** Same catalog projection in Main and both composer pickers; contains no credentials. */
export function getAppToolServices(app) {
  if (app.toolSelection !== 'services') return []
  const appId = app.id || app.name
  const native = (app.contributes?.services || []).map(service => {
    const tools = (app.agentTools || []).filter(tool => tool.serviceId === service.id)
    const availableTools = tools.filter(tool => !tool.permission || app.grants?.includes(tool.permission))
    return { id: appServiceKey(appId, service.id), appId, serviceId: service.id, title: service.title,
      description: service.description || '', available: Boolean(app.enabled && availableTools.length),
      toolCount: availableTools.length, status: !app.enabled ? 'app-disabled' : availableTools.length ? 'connected' : 'unauthorized' }
  })
  const mcp = (app.mcpServices || []).filter(service => service.serviceId).map(service => ({
    id: appServiceKey(appId, service.serviceId), appId, serviceId: service.serviceId,
    title: service.name, description: 'MCP 服务',
    available: Boolean(app.enabled && canSelectMcpService(service)),
    toolCount: service.tools.filter(tool => !tool.disabled).length, status: service.status,
  }))
  return [...native, ...mcp]
}
