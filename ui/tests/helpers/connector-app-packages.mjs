import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-connector-app-packages-'))
process.env.MOSS_HOME = path.join(root, 'home')
const { initializeBundledConnectorCatalog, listConnectorCatalog } = await import('../../src/connector-hub-ipc.mjs')
const { generateConnectorAppPackage, serviceAppName } = await import('../../scripts/lib/connector-app-package.mjs')
try {
  await initializeBundledConnectorCatalog({
    bundledCatalogPath: new URL('../../resources/connectors/workbuddy-connectors-config.zip', import.meta.url).pathname,
    bundledMcpOverridesPath: new URL('../../resources/connectors/connector-mcp-overrides.json', import.meta.url).pathname,
    bundledCliOverridesPath: new URL('../../resources/connectors/connector-cli-overrides.json', import.meta.url).pathname,
    bundledCloudAuthPath: new URL('../../resources/connectors/cloud-auth-providers.json', import.meta.url).pathname,
  })
  const catalog = await listConnectorCatalog()
  assert.equal(catalog.connectors.length, 115)
  const results = []
  for (const connector of catalog.connectors) {
    const destination = path.join(root, 'packages', connector.id)
    const pkg = await generateConnectorAppPackage(connector, '1.0.0', destination)
    assert.equal(pkg.manifest.id, `moss.${serviceAppName(connector.id)}`)
    assert.equal(pkg.manifest.discovery.group, 'online')
    assert.equal(Boolean(pkg.manifest.backend), false)
    results.push({ id: pkg.manifest.id, capabilities: pkg.manifest.connectorApp.capabilities, files: pkg.files.length, discovery: pkg.manifest.discovery })
  }
  assert.equal((await listConnectorCatalog()).installed.length, 0)
  console.log(JSON.stringify({ ok: true, packageCount: results.length, results }, null, 2))
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
