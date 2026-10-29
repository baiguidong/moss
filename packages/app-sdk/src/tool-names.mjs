import builtins from './builtin-apps.json' with { type: 'json' }

const builtinAppIds = new Set(builtins.apps)

/** Use the stable App slug, not its translated display name or MCP service name. */
export function appToolPrefix(appId) {
  if (builtinAppIds.has(appId)) return ''
  const appName = String(appId).split('.').at(-1).replace(/[^a-zA-Z0-9]/g, '')
  return `${appName}_`
}

/** Shared by native contributions, MCP registration and tool disclosure. */
export function normalizeAppToolName(localId, appId) {
  const name = appToolPrefix(appId) + String(localId).replace(/[^a-zA-Z0-9_-]/g, '_')
  if (name.length <= 64) return name
  // Keep long identifiers within the API limit without silently merging them.
  // This fingerprint must also work in the browser (no node:crypto dependency).
  let hash = 2166136261
  for (const character of `${appId}/${localId}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  }
  return `${name.slice(0, 55)}_${(hash >>> 0).toString(16).padStart(8, '0')}`
}
