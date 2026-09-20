import { createHash } from 'node:crypto'
import { APP_ERROR_CODES, AppServiceError } from '../../../app-sdk/src/index.mjs'

export const APP_CONTRIBUTION_KINDS = Object.freeze([
  'views',
  'settings',
  'commands',
  'tools',
  'resourceProviders',
  'widgets',
])

export function contributionId(appId, localId) {
  return `${appId}/${localId}`
}

export function appToolName(appId, localId) {
  const normalize = (value) => String(value).replace(/[^a-zA-Z0-9_]/g, '_')
  const qualifiedId = contributionId(appId, localId)
  const digest = createHash('sha256').update(qualifiedId).digest('hex').slice(0, 12)
  const readable = `app__${normalize(appId)}__${normalize(localId)}`
  return `${readable.slice(0, 50)}__${digest}`
}

export function collectManifestContributions(manifest, options = {}) {
  const grants = new Set(options.grants || [])
  const enabled = options.enabled !== false
  const result = Object.fromEntries(APP_CONTRIBUTION_KINDS.map((kind) => [kind, []]))
  for (const kind of APP_CONTRIBUTION_KINDS) {
    for (const item of manifest.contributes?.[kind] || []) {
      const granted = !item.permission || grants.has(item.permission)
      if (!options.includeUnavailable && (!enabled || !granted)) continue
      result[kind].push(Object.freeze({
        ...item,
        id: contributionId(manifest.id, item.id),
        localId: item.id,
        appId: manifest.id,
        appVersion: manifest.version,
        appDisplayName: manifest.displayName,
        enabled,
        granted,
        ...(kind === 'tools' ? { name: appToolName(manifest.id, item.id) } : {}),
      }))
    }
  }
  return result
}

export function findContribution(contributions, kind, id) {
  if (!APP_CONTRIBUTION_KINDS.includes(kind)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Unknown App contribution kind: ${kind}`)
  }
  const contribution = contributions[kind]?.find((item) => item.id === id || item.localId === id)
  if (!contribution) {
    throw new AppServiceError(APP_ERROR_CODES.actionNotFound, `App contribution is unavailable: ${kind} ${id}`)
  }
  return contribution
}
