/** App-owned assistants opt in; ordinary channel and desktop sessions inherit as before. */
export function isAppScopedSession(record) {
  return Boolean(record?.channelAppId && record?.channelRuntimePolicy?.contextScope === 'app')
}

export function normalizeAppScopedPolicy(policy = {}) {
  policy ??= {}
  return {
    ...policy,
    contextScope: 'app',
    agentId: null,
    resources: {
      // App supplies the explicit Core/own-tool selection; null never means all plugins.
      tools: Array.isArray(policy.resources?.tools) ? [...new Set(policy.resources.tools)] : [],
      skills: [],
      connectors: [],
    },
  }
}

export function isolateAppSession(record) {
  if (!isAppScopedSession(record)) return false
  const next = {
    connectorIds: [], appIds: [record.channelAppId], appServiceIds: [],
    channelRuntimePolicy: normalizeAppScopedPolicy(record.channelRuntimePolicy),
  }
  const changed = Object.entries(next).some(([key, value]) => JSON.stringify(record[key]) !== JSON.stringify(value))
  Object.assign(record, next)
  return changed
}
