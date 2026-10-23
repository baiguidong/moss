import fs from 'node:fs/promises'
import path from 'node:path'
import { AppServiceError, APP_ERROR_CODES } from '../../../app-sdk/src/errors.mjs'
import { validateAppManifest } from '../../../app-sdk/src/schemas/index.mjs'
import { getAppCategoryMinimumHostVersion } from '../../../app-sdk/src/categories.mjs'

export function createConnectorToolManifest(definition) {
  const allowed = new Set(['schemaVersion', 'id', 'version', 'displayName', 'description', 'category', 'keywords', 'icon', 'publisher', 'discovery', 'toolScope', 'connector', 'mcp', 'cli'])
  if (definition?.schemaVersion !== 1 || Object.keys(definition).some(key => !allowed.has(key))) throw new Error('Invalid tool App definition')
  const metadata = definition.connector
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Expected tool connector metadata')
  for (const field of ['mcp', 'cli']) {
    if (definition[field] !== undefined && (!definition[field] || typeof definition[field] !== 'object' || Array.isArray(definition[field]))) throw new Error(`Invalid tool ${field} configuration`)
  }
  const capabilities = [
    ...(definition.mcp ? ['mcp'] : []),
    ...(definition.cli ? ['cli'] : []),
    ...(metadata.skillNames?.length ? ['skills'] : []),
  ]
  return validateAppManifest({
    schemaVersion: 2, id: definition.id, version: definition.version, displayName: definition.displayName,
    description: definition.description || '', category: definition.category || 'other',
    discovery: definition.discovery || { group: 'online' },
    connectorApp: { id: metadata.id, capabilities }, keywords: definition.keywords || [],
    ...(definition.icon ? { icon: definition.icon } : {}), hostApi: getAppCategoryMinimumHostVersion(definition.category) === '3.21.0' ? '^3.21.0' : '^3.15.0',
    toolScope: definition.toolScope || 'session', navigation: { location: 'none' },
    publisher: definition.publisher, permissions: ['connector:use'],
  }, { requireNavigation: true })
}

export async function readConnectorToolSource(root, manifest) {
  const definition = JSON.parse(await fs.readFile(path.join(root, 'app.json'), 'utf8'))
  const generated = createConnectorToolManifest(definition)
  if (generated.id !== manifest.id || generated.version !== manifest.version || JSON.stringify(generated.connectorApp) !== JSON.stringify(manifest.connectorApp)) throw new Error('Tool source and manifest differ')
  for (const name of definition.connector.skillNames || []) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name)
      || !(await fs.stat(path.join(root, 'connector', '.moss', 'skills', name, 'SKILL.md')).catch(() => null))?.isFile()) throw new Error('Invalid tool App skill declaration')
  }
  return definition
}

export async function readConnectorAppPackage(root, manifest) {
  const invalid = message => { throw new AppServiceError(APP_ERROR_CODES.invalidPackage, message) }
  const directory = path.join(root, 'connector')
  const metadataPath = path.join(directory, 'connector.json')
  const stat = await fs.stat(metadataPath)
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) invalid('Invalid Connector App metadata')
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
  if (metadata.id !== manifest.connectorApp.id) invalid('Connector App package identity mismatch')
  const has = async name => (await fs.stat(path.join(directory, name)).catch(() => null))?.isFile() === true
  const capabilities = []
  if (await has('mcp.json')) capabilities.push('mcp')
  if (await has('cli.json')) capabilities.push('cli')
  const skills = Array.isArray(metadata.skillNames) ? metadata.skillNames : []
  for (const name of skills) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name)
      || !await has(`.moss/skills/${name}/SKILL.md`)) invalid('Invalid Connector App skill declaration')
  }
  if (skills.length) capabilities.push('skills')
  if (JSON.stringify([...manifest.connectorApp.capabilities].sort()) !== JSON.stringify(capabilities.sort())) invalid('Connector App capabilities do not match packaged files')
  return { directory, metadata }
}
