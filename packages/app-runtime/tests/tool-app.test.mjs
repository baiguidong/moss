import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createToolAppManifest, generateToolApp } from '../src/packages/generate-tool-app.mjs'
import { readConnectorToolSource } from '../src/packages/connector-app.mjs'

async function fixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-tool-app-'))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  const connectorDir = path.join(root, 'connector')
  await fs.mkdir(path.join(connectorDir, '.moss/skills/guide'), { recursive: true })
  await fs.writeFile(path.join(connectorDir, '.moss/skills/guide/SKILL.md'), '# Guide\n')
  const definition = { schemaVersion: 1, id: 'test.hybrid', version: '1.0.0', displayName: 'Hybrid',
    discovery: { group: 'online' }, connector: { id: 'service', skillNames: ['guide'],
      credentialSchema: { fields: [{ key: 'API_KEY', type: 'password', required: true }] } },
    mcp: { variantField: 'MODE', defaultVariant: 'direct', variants: { direct: {
      mcpServers: { service: { type: 'http', url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer ${API_KEY}' } } },
    } } }, cli: { status: 'node --version' } }
  return { root, connectorDir, definition, destination: path.join(root, 'package') }
}

test('one tool definition generates mixed capabilities without a custom UI or Backend', async context => {
  const options = await fixture(context)
  const pkg = await generateToolApp(options)
  assert.deepEqual(pkg.manifest.connectorApp, { id: 'service', capabilities: ['mcp', 'cli', 'skills'] })
  assert.equal(pkg.manifest.ui, undefined)
  assert.equal(pkg.manifest.backend, undefined)
  assert.deepEqual(pkg.manifest.permissions, ['connector:use'])
  const read = async relative => JSON.parse(await fs.readFile(path.join(options.destination, relative), 'utf8'))
  assert.deepEqual(await read('connector/mcp.json'), options.definition.mcp)
  assert.deepEqual(await read('connector/cli.json'), options.definition.cli)
  assert.deepEqual(await read('connector/token-schema.json'), options.definition.connector.credentialSchema)
  await fs.writeFile(path.join(options.root, 'app.json'), JSON.stringify(options.definition))
  assert.deepEqual(await readConnectorToolSource(options.root, pkg.manifest), options.definition)
  await assert.rejects(readConnectorToolSource(options.root, { ...pkg.manifest, id: 'another.app' }), /differ/)
})

test('pure Skills tools remain valid and capabilities are derived from payloads', async context => {
  const options = await fixture(context)
  const definition = { ...options.definition }
  delete definition.mcp
  delete definition.cli
  assert.deepEqual(createToolAppManifest(definition).connectorApp.capabilities, ['skills'])
  await generateToolApp({ ...options, definition })
  assert.throws(() => createToolAppManifest({ ...definition, backend: {} }), /definition/)
  assert.throws(() => createToolAppManifest({ ...definition, cli: [] }), /configuration/)
})

test('tool generation rejects duplicated configurations and reserved resources', async context => {
  const options = await fixture(context)
  await fs.writeFile(path.join(options.connectorDir, 'mcp.json'), '{}')
  await assert.rejects(generateToolApp(options), /belongs in app.json/)
  await fs.unlink(path.join(options.connectorDir, 'mcp.json'))
  const resourcesDir = path.join(options.root, 'resources')
  await fs.mkdir(resourcesDir)
  await fs.writeFile(path.join(resourcesDir, 'app.moss.json'), '{}')
  await assert.rejects(generateToolApp({ ...options, resourcesDir }), /Reserved tool resource/)
})

test('the shared tool generator preserves the builtin MCP path and remote transport', async context => {
  const { root } = await fixture(context)
  const definition = { schemaVersion: 1, id: 'test.remote', version: '1.0.0', displayName: 'Remote',
    discovery: { group: 'online' }, mcpServers: { remote: { type: 'http', url: 'https://example.invalid/mcp' } } }
  const pkg = await generateToolApp({ definition, destination: path.join(root, 'remote') })
  assert.equal(pkg.manifest.ui.builtin, 'mcp')
  assert.deepEqual(pkg.manifest.discovery, { group: 'online' })
  assert.equal(pkg.manifest.mcpApp.config, 'mcp.json')
})
