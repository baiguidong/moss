import fs from 'node:fs/promises'
import path from 'node:path'
import { validateAppManifest, ensureSafeRelativePath } from '../../../app-sdk/src/schemas/index.mjs'
import { validateAppPackage, writePackageChecksums, listPackageFiles } from './index.mjs'
import { normalizeMcpAppConfig } from './mcp-app.mjs'
import { mcpMinimumHostVersion } from '../../../app-sdk/src/mcp/local-options.mjs'
import semver from 'semver'

/** Generate a data-only App. Core provides the executable UI and MCP lifecycle. */
export function createMcpAppManifest(definition) {
  if (!definition || definition.schemaVersion !== 1) throw new Error('Expected MCP App definition schemaVersion 1')
  const allowed = new Set(['schemaVersion', 'id', 'version', 'displayName', 'description', 'category', 'keywords', 'icon', 'toolScope', 'mcpServers', 'presentation', 'runtime', 'publisher'])
  if (Object.keys(definition).some(key => !allowed.has(key))) throw new Error('Unknown MCP App definition field')
  normalizeMcpAppConfig({ mcpServers: definition.mcpServers })
  return validateAppManifest({
    schemaVersion: 2, id: definition.id, version: definition.version, displayName: definition.displayName,
    description: definition.description || '', category: definition.category || 'other', keywords: definition.keywords || [],
    publisher: definition.publisher,
    icon: definition.icon || undefined, hostApi: '^' + Object.values(definition.mcpServers).map(mcpMinimumHostVersion).sort(semver.rcompare)[0], toolScope: definition.toolScope || 'session',
    ui: { builtin: 'mcp', window: { width: 1120, height: 780, resizable: true } },
    permissions: ['mcp:read', 'mcp:manage', 'mcp:connect'], host: { protocols: ['moss.mcp/v1', 'moss.host/v1'] },
    navigation: { location: 'settings', viewId: 'settings' },
    contributes: {
      views: [{ id: 'settings', title: definition.displayName, route: '#/', order: 0 }],
      settings: [{ id: 'configuration', title: `${definition.displayName}设置`, viewId: 'settings', group: 'tools', order: 0 }],
    },
    mcpApp: { config: 'mcp.json', ...(definition.runtime ? { runtime: definition.runtime } : {}), ...(definition.presentation ? { presentation: definition.presentation } : {}) },
  }, { requireNavigation: true })
}

export async function generateMcpApp({ definition, resourcesDir, runtimeDir, destination }) {
  const manifest = createMcpAppManifest(definition)
  const config = normalizeMcpAppConfig({ mcpServers: definition.mcpServers })
  // Reject links and executable files before creating output. Resources are data.
  const resources = resourcesDir ? await listPackageFiles(resourcesDir, { maxFiles: 100, maxPackageBytes: 4 * 1024 * 1024 }) : []
  for (const file of resources) {
    if (!/\.(svg|png|jpg|jpeg|gif|webp|ico|md|txt|json)$/i.test(file.relativePath)) throw new Error(`Unsupported MCP App resource: ${file.relativePath}`)
    if (['app.moss.json', 'mcp.json', 'checksums.json', 'app-signature.json', 'source-manifest.json', 'definition.json'].includes(file.relativePath) || file.relativePath.startsWith('source/')) throw new Error(`Reserved MCP App resource: ${file.relativePath}`)
  }
  const runtimeFiles = runtimeDir ? await listPackageFiles(runtimeDir) : []
  if (runtimeFiles.length && !Object.values(config.mcpServers).some(server => [server.command, ...(server.args || [])].some(value => typeof value === 'string' && value.startsWith('@app/runtime/')))) {
    throw new Error('Bundled MCP runtime requires an @app/runtime/ launch path')
  }
  await fs.mkdir(destination, { recursive: true })
  if ((await fs.readdir(destination)).length) throw new Error('MCP App output directory must be empty')
  for (const file of resources) {
    const target = path.join(destination, ensureSafeRelativePath(file.relativePath))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(file.absolutePath, target)
  }
  for (const file of runtimeFiles) {
    const target = path.join(destination, 'runtime', ensureSafeRelativePath(file.relativePath))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(file.absolutePath, target)
  }
  for (const [name, value] of [['app.moss.json', manifest], ['mcp.json', config], ['definition.json', definition]]) {
    await fs.writeFile(path.join(destination, name), JSON.stringify(value, null, 2) + '\n')
  }
  await writePackageChecksums(destination)
  return validateAppPackage(destination)
}
