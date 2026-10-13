import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { validateMcpHostInput } from '../../../app-sdk/src/mcp/index.mjs'
import { AppServiceError, APP_ERROR_CODES } from '../../../app-sdk/src/errors.mjs'
import { sourcePath } from './source.mjs'

const invalid = message => { throw new AppServiceError(APP_ERROR_CODES.invalidPackage, message) }

/** One data format is used by generation, installation and MCP registration. */
export function normalizeMcpAppConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'mcpServers')) invalid('Expected an mcpServers configuration')
  const servers = input.mcpServers
  if (!servers || typeof servers !== 'object' || Array.isArray(servers) || !Object.keys(servers).length || Object.keys(servers).length > 100) invalid('MCP App must declare 1–100 services')
  if (Buffer.byteLength(JSON.stringify(input)) > 64 * 1024) invalid('MCP App configuration exceeds 64 KiB')
  const names = Object.keys(servers).map(name => name.replaceAll('-', '_'))
  if (new Set(names).size !== names.length) invalid('MCP service names collide after tool normalization')
  return { mcpServers: Object.fromEntries(Object.entries(servers).map(([name, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid(`Invalid MCP service: ${name}`)
    const config = { ...raw, type: raw.type || (raw.command ? 'stdio' : 'http') }
    validateMcpHostInput('servers.save', { name, enabled: true, config })
    if (config.type === 'stdio') {
      if (typeof config.command !== 'string' || !config.command.trim() || config.url) invalid(`MCP service ${name} requires a command`)
    } else {
      let url
      try { url = new URL(config.url) } catch { invalid(`MCP service ${name} requires a URL`) }
      if (!['http:', 'https:'].includes(url.protocol) || config.command) invalid(`Invalid MCP URL: ${name}`)
    }
    return [name, config]
  })) }
}

export async function readMcpAppConfig(root, manifest) {
  const file = sourcePath(root, manifest.mcpApp.config)
  const stat = await fs.stat(file)
  if (!stat.isFile() || stat.size > 64 * 1024) invalid('MCP App configuration must be a file of at most 64 KiB')
  const config = normalizeMcpAppConfig(JSON.parse(await fs.readFile(file, 'utf8')))
  return { ...config, revision: createHash('sha256').update(JSON.stringify(config)).digest('hex') }
}
