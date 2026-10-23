import fs from 'node:fs/promises'
import path from 'node:path'
import { createMcpAppManifest, generateMcpApp } from './generate-mcp-app.mjs'
import { createConnectorToolManifest } from './connector-app.mjs'
import { listPackageFiles, validateAppPackage, writePackageChecksums } from './index.mjs'

export function createToolAppManifest(definition) {
  return definition?.connector ? createConnectorToolManifest(definition) : createMcpAppManifest(definition)
}

export async function generateToolApp({ definition, resourcesDir, runtimeDir, connectorDir, destination, readme }) {
  if (!definition.connector) return generateMcpApp({ definition, resourcesDir, runtimeDir, destination })
  if (runtimeDir) throw new Error('Connector tools declare their runtime in the CLI or MCP configuration')
  const manifest = createConnectorToolManifest(definition)
  const resources = resourcesDir ? await listPackageFiles(resourcesDir) : []
  const payload = connectorDir ? await listPackageFiles(connectorDir) : []
  const reserved = new Set(['app.moss.json', 'checksums.json', 'app-signature.json', 'source-manifest.json', 'definition.json'])
  for (const file of resources) {
    if (reserved.has(file.relativePath) || /^(?:source|connector)\//.test(file.relativePath)) throw new Error(`Reserved tool resource: ${file.relativePath}`)
  }
  for (const file of payload) {
    if (['connector.json', 'mcp.json', 'cli.json', 'token-schema.json'].includes(file.relativePath)) throw new Error(`Tool configuration belongs in app.json: ${file.relativePath}`)
  }
  await fs.mkdir(destination, { recursive: true })
  if ((await fs.readdir(destination)).length) throw new Error('Tool App output directory must be empty')
  for (const [files, prefix] of [[resources, ''], [payload, 'connector']]) {
    for (const file of files) {
      const target = path.join(destination, prefix, file.relativePath)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(file.absolutePath, target)
    }
  }
  const configurations = { 'app.moss.json': manifest, 'connector/connector.json': definition.connector,
    ...(definition.mcp ? { 'connector/mcp.json': definition.mcp } : {}),
    ...(definition.cli ? { 'connector/cli.json': definition.cli } : {}),
    ...(definition.connector.credentialSchema ? { 'connector/token-schema.json': definition.connector.credentialSchema } : {}),
  }
  for (const [relative, value] of Object.entries(configurations)) {
    const target = path.join(destination, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, JSON.stringify(value, null, 2) + '\n')
  }
  if (readme) await fs.writeFile(path.join(destination, 'README.md'), readme)
  await writePackageChecksums(destination)
  return validateAppPackage(destination)
}
