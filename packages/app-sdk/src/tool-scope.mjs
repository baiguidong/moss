/** Normalize a Host-resolved App scope; the signed manifest supplies its default. */
export function getAppToolScope(value) {
  return value === 'global' ? 'global' : 'session'
}

export function isAppToolAvailable(appId, toolScope, appIds = []) {
  return getAppToolScope(toolScope) === 'global' || appIds.includes(appId)
}
