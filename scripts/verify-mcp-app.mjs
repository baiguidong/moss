// Real configuration -> package -> Desktop Host -> MCP verification, in an isolated home.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { zipSync } from 'fflate'
import { AppRuntimeHost } from '../packages/app-runtime/src/host/index.mjs'
import { validateAppPackage } from '../packages/app-runtime/src/packages/index.mjs'
import { generateMcpApp } from '../packages/app-runtime/src/packages/generate-mcp-app.mjs'

const core = fileURLToPath(new URL('..', import.meta.url))
const apps = process.env.MOSS_APPS_ROOT || path.resolve(core, '../moss-apps')
const output = path.resolve(process.env.MOSS_MCP_PROOF_OUTPUT || path.join(core, 'output/mcp-app-proof'))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-mcp-app-proof-'))
process.env.MOSS_HOME = path.join(temp, 'home')
process.env.MOSS_CONFIG_DIR = process.env.MOSS_HOME
const { AppCredentialAdapter, installAppArchive } = await import('../ui/src/apps/app-runtime.mjs')
const { AppMcpHost, createMcpProtocolDefinition, MCP_PROTOCOL, MCP_METHODS } = await import('../ui/src/apps/app-mcp-host.mjs')
const { publishAppFromBuild, getPublishedApp, listAppsFromRegistry, setAppInstallationActivation } = await import('../ui/src/app-platform.mjs')
const { createSessionApps } = await import('../ui/src/apps/session-apps.mjs')
const { inspectDesktopMcpServer } = await import('../ui/electron-direct.mjs')
const require = createRequire(path.join(core, 'ui/package.json'))
const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')))
const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')))
await fs.mkdir(output, { recursive: true })
let runtime, host, client
const checks = []
const record = (name, detail = {}) => { checks.push({ name, ...detail }); console.log(`PASS ${name}`) }
const pack = async (directory, name) => {
  const pkg = await validateAppPackage(directory)
  const entries = Object.fromEntries(await Promise.all(pkg.files.map(async file => [file.relativePath, [new Uint8Array(await fs.readFile(file.absolutePath)), { mtime: new Date('2020-01-01T00:00:00Z') }]])))
  const archive = path.join(output, name)
  await fs.writeFile(archive, zipSync(entries)); return archive
}
const startRuntime = async () => {
  runtime = new AppRuntimeHost({ rootDir: process.env.MOSS_HOME, nodeExecutable: process.execPath,
    credentialAdapter: new AppCredentialAdapter(process.env.MOSS_HOME), hostCapabilityOptions: { protocols: [createMcpProtocolDefinition()] } })
  host = new AppMcpHost({ getRuntime: () => runtime, inspect: inspectDesktopMcpServer })
  for (const method of MCP_METHODS) runtime.registerHostHandler(MCP_PROTOCOL, method, (input, context) => host.handle(method, input, context))
  await runtime.initialize()
  await host.refresh()
}
try {
  const definition = JSON.parse(await fs.readFile(path.join(apps, 'mcp-apps/drawio/app.json'), 'utf8'))
  const generated = await generateMcpApp({ definition, resourcesDir: path.join(apps, 'mcp-apps/drawio/resources'), destination: path.join(temp, 'drawio') })
  const childZip = await pack(generated.root, `${generated.manifest.id}-${generated.manifest.version}.zip`)
  assert.ok(!generated.manifest.backend)
  assert.ok(generated.files.every(file => !/\.(?:[cm]?js|html|css)$/.test(file.relativePath)))
  record('Core generated a configuration-only App', { files: generated.files.map(file => file.relativePath) })

  await startRuntime()
  setAppInstallationActivation(async entry => { await runtime.registerInstalled(entry.id, entry.currentVersion); await host.refresh() })
  const install = archive => installAppArchive(runtime, archive, { installPackage: root => publishAppFromBuild(root) })
  await install(childZip)
  assert.ok(!runtime.installations.get('moss.mcp'))
  assert.deepEqual(runtime.installations.listAll().map(item => item.appId), [definition.id])
  const published = getPublishedApp(definition.id)
  assert.equal(published.bundleRoot, path.join(core, 'ui/dist/mcp-app/'))
  assert.notEqual(published.versionDir, published.bundleRoot)
  await fs.access(published.entryPath)
  assert.equal(listAppsFromRegistry().find(app => app.id === definition.id).displayName, 'Draw.io')
  assert.equal((await runtime.getApp(definition.id)).instances.length, 0)
  record('Standalone ZIP installation in an empty Host, using Core UI without a Backend')

  const instanceId = `${definition.id}--default`, serverName = 'moss_drawio__drawio'
  const invoke = (method, input = {}) => runtime.requestHostCapability(definition.id, instanceId, MCP_PROTOCOL, method, input, { timeoutMs: 90_000 })
  const sessionApps = createSessionApps({ getRuntime: () => runtime, getMcpHost: () => host, isBusy: () => false, disposeRuntime() {}, persist() {}, emit() {} })
  assert.deepEqual(await sessionApps.validateIds([definition.id]), [definition.id])
  assert.deepEqual(host.enabledServers([]), {})
  const config = host.enabledServers([definition.id], temp)[serverName]
  assert.equal(config.command, 'npx'); assert.deepEqual(config.args, ['-y', '@drawio/mcp'])
  assert.equal(host.serverOwners()[serverName].appId, definition.id)
  record('Independent App identity and session selection preserve the requested command')

  const inspected = await invoke('servers.inspect', { name: 'drawio' })
  assert.equal(inspected.servers[0].check?.state, 'connected', JSON.stringify(inspected))
  const toolNames = inspected.servers[0].check.tools.map(tool => tool.name)
  assert.ok(toolNames.includes('open_drawio_mermaid'))
  record('Core MCP handshake and tool discovery', { serverInfo: inspected.servers[0].check.serverInfo, tools: toolNames })
  const connect = async () => {
    const transport = new StdioClientTransport({ command: config.command, args: config.args, cwd: temp, env: { ...process.env, ...config.env }, stderr: 'pipe' })
    transport.stderr?.on('data', () => {})
    client = new Client({ name: 'moss-configuration-app-proof', version: '0.1.0' })
    await client.connect(transport, { timeout: 90_000 })
  }
  await connect()
  const result = await client.callTool({ name: 'open_drawio_mermaid', arguments: { content: 'flowchart LR\n A[App configuration] --> B[Moss Core]\n B --> C[Draw.io MCP]', lightbox: false } }, undefined, { timeout: 30_000 })
  assert.ok(!result.isError, JSON.stringify(result))
  assert.match(JSON.stringify(result), /https:\/\/(?:app\.diagrams\.net|www\.draw\.io)/)
  await fs.writeFile(path.join(output, 'drawio-tool-result.json'), JSON.stringify(result, null, 2) + '\n')
  record('Real open_drawio_mermaid call returns an editor URL')

  const diagramPath = path.join(temp, 'recovery.drawio')
  await fs.writeFile(diagramPath, '<mxfile><diagram id="main" name="Main"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>')
  const content = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="PERSISTED-DRAWIO-713" vertex="1" parent="1"><mxGeometry x="0" y="0" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel>'
  const saved = await client.callTool({ name: 'set_page', arguments: { path: diagramPath, page: '0', content } })
  assert.ok(!saved.isError, JSON.stringify(saved))
  await client.close(); client = null
  await connect()
  const restored = await client.callTool({ name: 'get_page', arguments: { path: diagramPath, page: '0' } })
  assert.ok(!restored.isError, JSON.stringify(restored))
  assert.equal(restored.content[0].text, content)
  await fs.copyFile(diagramPath, path.join(output, 'drawio-recovery.drawio'))
  await client.close(); client = null
  record('Draw.io process restart restores the exact diagram saved by set_page')

  await assert.rejects(runtime.requestHostCapability(definition.id, instanceId, MCP_PROTOCOL, 'servers.list', { appId: 'another.app' }), /Invalid|参数/)
  await invoke('servers.set-enabled', { name: 'drawio', enabled: false })
  assert.equal(host.enabledServers([definition.id])[serverName], undefined)
  await invoke('servers.set-enabled', { name: 'drawio', enabled: true })
  await runtime.setAppEnabled(definition.id, false)
  assert.equal(host.enabledServers([definition.id])[serverName], undefined)
  await runtime.setAppEnabled(definition.id, true)
  await host.refresh()
  await runtime.setAppGrants(definition.id, ['mcp:read'])
  assert.equal(host.enabledServers([definition.id])[serverName], undefined)
  await runtime.setAppGrants(definition.id, generated.manifest.permissions)
  await host.refresh()
  record('Service/App toggles and permission isolation')
  const identity = host.toolCatalog(definition.id)[0].serviceId
  await runtime.shutdown()
  await startRuntime()
  assert.equal(host.toolCatalog(definition.id)[0].serviceId, identity)
  assert.deepEqual(host.enabledServers([definition.id])[serverName].args, ['-y', '@drawio/mcp'])
  record('Restart restores configuration without App code')
  await runtime.uninstall(definition.id, { deleteData: true, deleteCredentials: true })
  await host.refresh()
  assert.equal(host.enabledServers([definition.id])[serverName], undefined)
  record('Uninstall removes the App and its tools')
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: true, at: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, hostApi: '3.9.0', checks,
    packages: [childZip], command: { command: 'npx', args: ['-y', '@drawio/mcp'] } }, null, 2) + '\n')
  console.log(`Evidence: ${output}`)
} catch (error) {
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: false, checks, error: error.stack }, null, 2) + '\n')
  throw error
} finally {
  setAppInstallationActivation(null)
  await client?.close().catch(() => {})
  await runtime?.shutdown()
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
