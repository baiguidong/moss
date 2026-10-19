import fs from 'node:fs/promises'
import path from 'node:path'
import { AppServiceError, APP_ERROR_CODES } from '../../../app-sdk/src/errors.mjs'

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
