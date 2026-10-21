// Run with: node ui/scripts/verify-app-tool-bridge-database.mjs
// Uses unchanged database and data-workbench packages with a temporary consumer App.
// The SQLite database, installed Apps, and App data live in a temporary profile.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import { AppRuntimeHost, writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'
import { AppCredentialAdapter } from '../src/apps/app-runtime.mjs'
import { AppMcpHost, createMcpProtocolDefinition, MCP_METHODS, MCP_PROTOCOL } from '../src/apps/app-mcp-host.mjs'

const coreRoot = fileURLToPath(new URL('../..', import.meta.url))
const databaseRoot = process.env.MOSS_DATABASE_APP_ROOT || path.resolve(coreRoot, '../moss-apps/apps/database')
const workbenchRoot = process.env.MOSS_DATA_WORKBENCH_APP_ROOT || path.resolve(coreRoot, '../moss-apps/apps/data-workbench')
const definitionBytes = await fs.readFile(path.join(databaseRoot, 'app.moss.json'))
const definition = JSON.parse(definitionBytes)
assert.equal(definition.id, 'moss.database')
assert.equal(definition.version, '0.2.2')
assert.equal(definition.appCapabilities, undefined, 'The target App must remain unchanged')
assert.equal(definition.contributes?.tools, undefined, 'This proof needs the existing dynamic DBHub tools')
const workbenchDefinitionBytes = await fs.readFile(path.join(workbenchRoot, 'app.moss.json'))
const workbenchDefinition = JSON.parse(workbenchDefinitionBytes)
assert.equal(workbenchDefinition.id, 'moss.data-workbench')
assert.match(workbenchDefinition.version, /^\d+\.\d+\.\d+$/)
assert(workbenchDefinition.contributes?.tools?.some(tool => tool.id === 'catalog'))

const require = createRequire(path.join(coreRoot, 'ui/package.json'))
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')
const { CallToolResultSchema } = require('@modelcontextprotocol/sdk/types.js')

async function withMcpClient(_name, config, signal, operation) {
  assert.equal(config.type, 'stdio')
  const client = new Client({ name: 'moss-app-tool-bridge-verification', version: '1.0.0' })
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...process.env, ...config.env },
    stderr: 'pipe',
  })
  transport.stderr?.resume()
  try {
    await client.connect(transport, { signal, timeout: 120_000 })
    return await operation(client)
  } finally {
    await client.close().catch(() => {})
  }
}

async function listMcpTools(name, config, signal) {
  return withMcpClient(name, config, signal, async client => {
    const tools = []
    let cursor
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: 120_000 })
      tools.push(...page.tools)
      cursor = page.nextCursor
    } while (cursor)
    return tools
  })
}

async function callMcpTool(name, config, toolName, args, { signal, beforeCall }) {
  return withMcpClient(name, config, signal, async client => {
    const page = await client.listTools({}, { signal, timeout: 120_000 })
    const tool = page.tools.find(item => item.name === toolName)
    assert(tool, `MCP tool ${toolName} disappeared`)
    await beforeCall(tool)
    return client.callTool({ name: toolName, arguments: args }, CallToolResultSchema, { signal, timeout: 180_000 })
  })
}

async function copyDatabasePackage(destination) {
  await fs.mkdir(destination, { recursive: true })
  for (const entry of ['app.moss.json', 'assets', 'dist', 'schemas']) {
    await fs.cp(path.join(databaseRoot, entry), path.join(destination, entry), { recursive: true })
  }
  await writePackageChecksums(destination)
}

async function copyWorkbenchPackage(destination) {
  await fs.mkdir(destination, { recursive: true })
  for (const entry of ['app.moss.json', 'assets', 'dist', 'resources', 'schemas']) {
    await fs.cp(path.join(workbenchRoot, entry), path.join(destination, entry), { recursive: true })
  }
  await writePackageChecksums(destination)
}

async function writeConsumerPackage(destination) {
  await fs.mkdir(destination, { recursive: true })
  const appId = 'fixture.database-consumer'
  await fs.writeFile(path.join(destination, 'app.moss.json'), `${JSON.stringify({
    schemaVersion: 2,
    id: appId,
    version: '1.0.0',
    displayName: 'Database bridge consumer fixture',
    hostApi: '^3.19.0',
    backend: {
      entry: 'backend.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand',
      actions: [{ name: 'query', timeoutMs: 300_000 }],
    },
    host: { protocols: ['moss.app-capabilities/v1'] },
    permissions: ['apps:invoke'],
    appCapabilities: { usesTools: [
      { appId: definition.id, tools: ['search_objects', 'execute_sql'] },
      { appId: workbenchDefinition.id, tools: ['catalog'] },
    ] },
  }, null, 2)}\n`)
  const sdk = pathToFileURL(path.join(coreRoot, 'packages/app-sdk/src/index.mjs')).href
  await fs.writeFile(path.join(destination, 'backend.mjs'), `
import { AppBackendClient, createAppCapabilitiesClient } from ${JSON.stringify(sdk)}
const backend = new AppBackendClient({ hostRequestTimeoutMs: 300_000 })
const client = createAppCapabilitiesClient(backend.host)
backend.registerAction('query', async ({ sql }) => {
  const catalog = await client.listTools({ appId: 'moss.database' }, { timeoutMs: 180_000 })
  const match = catalog.tools.filter(tool => tool.name === 'execute_sql')
  if (match.length !== 1) throw new Error('Expected exactly one database execute_sql tool')
  const result = await client.invokeTool(match[0].toolRef, { sql }, { timeoutMs: 180_000 })
  const workbenchTools = await client.listTools({ appId: 'moss.data-workbench' })
  const catalogTool = workbenchTools.tools.find(tool => tool.name === 'catalog')
  if (!catalogTool) throw new Error('Expected data-workbench catalog tool')
  const workbenchCatalog = await client.invokeTool(catalogTool.toolRef, {})
  return {
    source: match[0].source,
    toolNames: catalog.tools.map(tool => tool.name),
    result,
    workbenchSource: catalogTool.source,
    workbenchCatalog,
  }
})
backend.start()
`)
  await writePackageChecksums(destination)
  return appId
}

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-database-bridge-')))
const oldHome = process.env.MOSS_HOME, oldConfigDir = process.env.MOSS_CONFIG_DIR
process.env.MOSS_HOME = root
process.env.MOSS_CONFIG_DIR = root
let runtime
try {
  const sqlitePath = path.join(root, 'bridge-orders.sqlite')
  const sqlite = new DatabaseSync(sqlitePath)
  try {
    sqlite.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, amount INTEGER); INSERT INTO orders VALUES (1,10),(2,20),(3,30)')
  } finally { sqlite.close() }

  const databasePackage = path.join(root, 'database-package')
  await copyDatabasePackage(databasePackage)
  runtime = new AppRuntimeHost({
    rootDir: root,
    nodeExecutable: process.execPath,
    credentialAdapter: new AppCredentialAdapter(root),
    hostCapabilityOptions: { protocols: [createMcpProtocolDefinition()] },
  })
  const mcpHost = new AppMcpHost({
    getRuntime: () => runtime,
    inspect: async (name, config, signal) => ({ state: 'connected', tools: await listMcpTools(name, config, signal), checkedAt: Date.now() }),
    discoverTool: listMcpTools,
    invokeTool: callMcpTool,
  })
  assert.equal(typeof runtime.setAppToolBridge, 'function', 'Host bridge is not installed')
  runtime.setAppToolBridge(mcpHost)
  for (const method of MCP_METHODS) {
    runtime.registerHostHandler(MCP_PROTOCOL, method, (input, context) => mcpHost.handle(method, input, context))
  }
  await runtime.initialize()
  await runtime.installFromDirectory(databasePackage)
  const databaseInstance = await runtime.ensureDefaultInstance(definition.id)
  const saved = await runtime.invoke(definition.id, databaseInstance.id, 'connections.save', {
    title: 'Bridge orders', kind: 'sqlite', file: sqlitePath, readonly: true, maxRows: 2, timeout: 10,
  }, { timeoutMs: 300_000 })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.equal(saved.data.connections.length, 1)
  await mcpHost.refresh()
  console.log('PASS unchanged moss.database@0.2.2 installed and configured with temporary SQLite data')

  const workbenchPackage = path.join(root, 'workbench-package')
  await copyWorkbenchPackage(workbenchPackage)
  await runtime.installFromDirectory(workbenchPackage)
  await runtime.ensureDefaultInstance(workbenchDefinition.id)
  console.log(`PASS unchanged moss.data-workbench@${workbenchDefinition.version} installed`)

  const consumerPackage = path.join(root, 'consumer-package')
  const consumerId = await writeConsumerPackage(consumerPackage)
  await runtime.installFromDirectory(consumerPackage)
  const consumerInstance = await runtime.ensureDefaultInstance(consumerId)
  const response = await runtime.invoke(consumerId, consumerInstance.id, 'query', {
    sql: 'SELECT id, amount FROM orders ORDER BY id',
  }, { timeoutMs: 300_000 })
  assert.equal(response.source, 'mcp')
  assert(response.toolNames.includes('search_objects'))
  assert(response.toolNames.includes('execute_sql'))
  assert.equal(response.workbenchSource, 'contribution')
  assert.equal(typeof response.workbenchCatalog.version, 'string')
  const text = response.result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
  const rows = JSON.parse(text).data.statements[0].rows
  assert.equal(rows.length, 2, 'DBHub must read the real SQLite table and honor the target App row limit')
  assert.match(JSON.stringify(rows), /10/)
  assert.match(JSON.stringify(rows), /20/)
  console.log('PASS temporary consumer App combined DBHub SQL results with the data-workbench catalog through Host')
  assert.deepEqual(await fs.readFile(path.join(databaseRoot, 'app.moss.json')), definitionBytes)
  assert.deepEqual(await fs.readFile(path.join(workbenchRoot, 'app.moss.json')), workbenchDefinitionBytes)
  console.log('PASS both target App source manifests were not modified')
} finally {
  await runtime?.shutdown().catch(() => {})
  await fs.rm(root, { recursive: true, force: true })
  if (oldHome === undefined) delete process.env.MOSS_HOME
  else process.env.MOSS_HOME = oldHome
  if (oldConfigDir === undefined) delete process.env.MOSS_CONFIG_DIR
  else process.env.MOSS_CONFIG_DIR = oldConfigDir
}
