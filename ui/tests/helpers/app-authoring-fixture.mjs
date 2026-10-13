import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createAppRuntime } from '../../src/apps/app-runtime.mjs'
import { createAppAuthoringHost } from '../../src/apps/app-authoring-host.mjs'
import { createDeveloperCatalog } from '../../src/apps/app-developer-catalog.mjs'
import { createAuthoringPreview } from '../../src/apps/app-authoring-preview.mjs'
import { contracts } from '../../../packages/host-contracts/src/index.mjs'
import { contractDefinition } from '../../../packages/app-sdk/src/host/contracts.mjs'
import { writePackageChecksums } from '../../../packages/app-runtime/src/index.mjs'
import { writeJson, sourceHash } from '../../src/apps/app-authoring-source.mjs'

export const developerCatalog = await createDeveloperCatalog()
export async function fixture(overrides = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-authoring-test-')), appsDir = path.join(home, 'apps')
  const workspace = path.join(home, 'workspace'); await fs.mkdir(workspace)
  const sessions = new Map([['session', { id: 'session', workspace, agentMode: 'local' }]])
  const revisions = new Map(), changes = [], commands = [], bindings = []
  let service
  // Use the real system Node, not the Bun test executable, for service fixtures.
  const node = process.env.MOSS_TEST_NODE || (process.env.PATH || '').split(path.delimiter).map(directory => path.join(directory, process.platform === 'win32' ? 'node.exe' : 'node')).find(existsSync)
  const runtime = await createAppRuntime({ mossHome: home, appsDir, nodeExecutable: node, hostProtocols: [contractDefinition('moss.apps/v1')],
    hostHandlers: {
      'moss.apps/v1': Object.fromEntries(Object.keys(contracts['moss.apps/v1'].methods).map(method => [method, (input, context) => service.handle(method, input, context)])),
      'moss.host/v1': { 'info.get': () => developerCatalog.info, 'contracts.list': input => developerCatalog.list(input), 'contracts.get': input => developerCatalog.get(input), 'sdk.export': (input, context) => service.exportSdk(input, context) },
    },
  })
  const provider = path.join(home, 'provider'); await fs.mkdir(path.join(provider, 'dist'), { recursive: true })
  const sdkUrl = new URL('../../../packages/app-sdk/src/index.mjs', import.meta.url).href
  await fs.writeFile(path.join(provider, 'dist/main.mjs'), `import {AppBackendClient} from ${JSON.stringify(sdkUrl)}; const b=new AppBackendClient(); b.registerAction('proxy', i=>b.host.request(i.protocol||'moss.apps/v1',i.method,i.input||{})); b.registerAction('list',()=>[]); b.registerAction('resolve',()=>({instruction:'Use provider tools',tools:['write','read']})); b.start();`)
  const schema = { type: 'object', additionalProperties: true }
  await writeJson(path.join(provider, 'input.json'), schema)
  const manifest = { schemaVersion: 2, id: 'test.builder', version: '1.0.0', displayName: 'Test provider', hostApi: '^3.0.0', host: { protocols: ['moss.host/v1', 'moss.apps/v1'] },
    permissions: ['apps:read', 'apps:author', 'apps:build', 'apps:install'], backend: { entry: 'dist/main.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand', actions: ['proxy', 'list', 'resolve'].map(name => ({ name, inputSchema: 'input.json' })) },
    contributes: { tools: ['write', 'read'].map(effect => ({ id: effect, title: effect, description: effect, effect, action: 'proxy', inputSchema: 'input.json' })), resourceProviders: [{ id: 'projects', schemes: ['moss-app-project'], listAction: 'list', resolveAction: 'resolve', authoring: { target: 'moss-app', intents: ['create', 'edit'] } }] } }
  await writeJson(path.join(provider, 'app.moss.json'), manifest); await writePackageChecksums(provider); await runtime.installFromDirectory(provider)
  const previewRoot = path.join(home, 'previews'); await fs.mkdir(previewRoot)
  const options = {
    home, appsDir, catalog: developerCatalog, getRuntime: () => runtime, getSession: id => sessions.get(id),
    listApps: async () => (await runtime.listApps()).map(app => ({ id: app.manifest?.id, currentVersion: app.installation.activeVersion, displayName: app.manifest?.displayName, packageStatus: 'ready' })),
    getInstallationRevision: id => revisions.get(id) || 0,
    onChanged: (operation, project) => changes.push({ operation: structuredClone(operation), project: structuredClone(project) }),
    onBind: (session, context) => bindings.push({ session: session.id, context }),
    authorizeInstall: async () => true, authorizePreview: async () => true,
    install: async (artifact, expected) => {
      const id = artifact.manifest.id
      if ((revisions.get(id) || 0) !== expected.expectedInstallationRevision) throw new Error('Installation changed')
      await overrides.beforeInstall?.(artifact, expected)
      await runtime.installFromDirectory(artifact.directory)
      await runtime.registerInstalled(id, artifact.manifest.version)
      revisions.set(id, (revisions.get(id) || 0) + 1)
      await writeJson(path.join(appsDir, id, 'current.json'), { version: artifact.manifest.version })
      return { version: artifact.manifest.version }
    },
    isActive: (id, version) => runtime.installations.get(id)?.activeVersion === version,
    preview: createAuthoringPreview({ root: previewRoot, getRuntime: () => runtime, nodeExecutable: node, openWindow: async () => ({ close() {} }) }),
    ...overrides,
  }
  service = await createAppAuthoringHost(options)
  const call = async (method, input = {}, { sessionId = 'session', read = false, authorize = async command => commands.push(command), protocol = 'moss.apps/v1' } = {}) => {
    const event = { input: { contributionId: `test.builder/${read ? 'read' : 'write'}`, input: { method, input, protocol } }, authorizeCommand: authorize }
    return service.withTool(event, sessions.get(sessionId), invocation => runtime.invokeToolContribution(event.input.contributionId, event.input.input, { invocation }))
  }
  const prepare = input => call('project.prepare', { intent: 'create', projectId: randomUUID(), appId: 'test.created', ...input })
  const build = async project => {
    const source = await call('source.inspect', { projectRef: project.projectRef }, { read: true })
    return call('build.start', { projectRef: project.projectRef, submissionKey: randomUUID(), sourceHash: source.sourceHash, contractHash: developerCatalog.info.contractHash, sdkHash: developerCatalog.info.sdkHash })
  }
  const wait = async (reference, family = 'build') => {
    for (let i = 0; i < (overrides.waitTimeoutMs || 10000) / 20; i++) {
      const result = await call(`${family}.get`, { operationRef: reference }, { read: true })
      if (['succeeded', 'failed', 'canceled', 'interrupted', 'ready', 'closed'].includes(result.status)) return result
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error(`Timed out waiting for ${reference}`)
  }
  return { home, workspace, appsDir, runtime, service, sessions, commands, changes, bindings, revisions, call, prepare, build, wait,
    restart: async () => { await service.shutdown(); service = await createAppAuthoringHost(options); return service },
    close: async () => { await service.shutdown(); await runtime.shutdown(); await fs.rm(home, { recursive: true, force: true }) },
  }
}
export async function writeApp(project, { version = '0.1.0', content = '<h1>Created App</h1>', buildCode = '', backend = false, category, keywords } = {}) {
  const root = project.path
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'src/index.html'), content)
  const sdkUrl = './sdk/packages/app-sdk/src/index.mjs'
  if (backend) await fs.writeFile(path.join(root, 'src/main.mjs'), `import {AppBackendClient} from ${JSON.stringify(sdkUrl)};const b=new AppBackendClient();b.registerAction('echo',input=>({value:input.value}));b.start();`)
  const manifest = { schemaVersion: 2, id: project.appId, version, displayName: 'Created App', hostApi: '^3.4.0', navigation: backend ? { location: 'none' } : { location: 'more', viewId: 'home' }, permissions: [], ...(backend ? { backend: { entry: 'dist/main.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand', actions: [{ name: 'echo', inputSchema: 'schemas/echo.json' }] } } : { ui: { entry: 'dist/index.html' }, contributes: { views: [{ id: 'home', title: 'Home', route: '#/' }] } }) }
  if (category !== undefined) manifest.category = category
  if (keywords !== undefined) manifest.keywords = keywords
  if (backend) await writeJson(path.join(root, 'schemas/echo.json'), { type: 'object', required: ['value'], properties: { value: { type: 'string' } }, additionalProperties: false })
  await writeJson(path.join(root, 'app.moss.json'), manifest)
  await writeJson(path.join(root, 'package.json'), { name: 'created-fixture', version, type: 'module', scripts: { build: 'node build.mjs' } })
  await fs.writeFile(path.join(root, 'build.mjs'), `import fs from 'node:fs/promises';${buildCode};await fs.mkdir('dist',{recursive:true});${backend ? "await fs.cp('.moss-sdk','dist/sdk',{recursive:true});" : ''}await fs.copyFile('src/${backend ? 'main.mjs' : 'index.html'}','dist/${backend ? 'main.mjs' : 'index.html'}');`)
  return sourceHash(root)
}
