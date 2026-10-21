import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { validateAppManifest } from '../../app-sdk/src/schemas/index.mjs'
import { AppPackageStore, validateAppPackage, writePackageChecksums } from '../src/packages/index.mjs'
import { generateMcpApp } from '../src/packages/generate-mcp-app.mjs'
import { normalizeMcpAppConfig } from '../src/packages/mcp-app.mjs'

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-mcp-definition-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const definition = { schemaVersion: 1, id: 'test.diagram', version: '1.0.0', displayName: 'Diagram',
    presentation: { headline: 'Create diagrams', examples: ['Draw a flowchart'] },
    mcpServers: { diagram: { command: 'npx', args: ['-y', '@drawio/mcp'] } } }
  const generate = (patch = {}, options = {}) => generateMcpApp({ definition: { ...definition, ...patch }, destination: path.join(root, `generated-${crypto.randomUUID()}`), ...options })
  return { root, definition, generate }
}

test('configuration App installs alone into an empty store and uses the builtin Core UI', async t => {
  const f = await fixture(t), generated = await f.generate()
  const store = new AppPackageStore({ appsDir: path.join(f.root, 'installed') })
  const installed = await store.installFromDirectory(generated.root)
  assert.equal(installed.manifest.ui.builtin, 'mcp')
  assert.equal(installed.manifest.ui.entry, undefined)
  assert.equal(installed.manifest.backend, undefined)
  assert.equal(installed.manifest.mcpApp.base, undefined)
  assert.equal((await store.get('test.diagram', '1.0.0')).manifest.id, 'test.diagram')
  assert.ok(installed.files.every(file => file.relativePath.endsWith('.json')))
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(installed.root, 'mcp.json'))).mcpServers.diagram.args, ['-y', '@drawio/mcp'])
  assert.equal((await store.installFromDirectory(generated.root)).installed, false)
  assert.deepEqual(installed.manifest.mcpApp.presentation, f.definition.presentation)
})

test('generation rejects executable resources, traversal, invalid configurations and colliding names', async t => {
  const f = await fixture(t)
  const resources = path.join(f.root, 'resources'); await fs.mkdir(resources)
  await fs.writeFile(path.join(resources, 'inject.js'), 'throw new Error("must not run")')
  await assert.rejects(f.generate({}, { resourcesDir: resources }), /Unsupported.*resource/)
  await assert.rejects(f.generate({ icon: '../outside.svg' }), /inside/)
  await assert.rejects(f.generate({ mcpServers: {} }), /1–100/)
  assert.throws(() => normalizeMcpAppConfig({ mcpServers: { 'same-name': { command: 'node' }, same_name: { command: 'node' } } }), /collide/)
  assert.throws(() => normalizeMcpAppConfig({ mcpServers: { bad: { type: 'stdio' } } }), /command/)
  assert.throws(() => normalizeMcpAppConfig({ mcpServers: { bad: { url: 'file:///tmp/config' } } }), /URL/)
  assert.throws(() => normalizeMcpAppConfig({ mcpServers: { bad: { command: 'node', args: 'not-an-array' } } }), /Invalid/)
})

test('bundled MCP executables are confined to runtime and referenced by the App config', async t => {
  const f = await fixture(t)
  const runtimeDir = path.join(f.root, 'runtime')
  await fs.mkdir(runtimeDir)
  await fs.writeFile(path.join(runtimeDir, 'server.mjs'), 'process.stdin.resume()\n')
  const bundled = await f.generate({ mcpServers: { diagram: { command: 'node', args: ['@app/runtime/server.mjs'] } } }, { runtimeDir })
  assert.equal((await validateAppPackage(bundled.root)).manifest.id, 'test.diagram')
  await assert.rejects(f.generate({}, { runtimeDir }), /requires an @app/)
  await assert.rejects(f.generate({ mcpServers: { diagram: { command: 'node', args: ['@app/other/server.mjs'] } } }, { runtimeDir }), /requires an @app\/runtime/)
  await fs.rm(path.join(bundled.root, 'runtime/server.mjs'))
  await writePackageChecksums(bundled.root)
  await assert.rejects(validateAppPackage(bundled.root), /does not exist/)
})

test('builtin UI requires a data-only MCP App with Host API 3.9 and MCP permissions', async t => {
  const f = await fixture(t), { manifest } = await f.generate()
  assert.deepEqual(validateAppManifest(manifest).mcpApp, manifest.mcpApp)
  assert.throws(() => validateAppManifest({ ...manifest, hostApi: '^3.8.0' }), /3.9/)
  assert.throws(() => validateAppManifest({ ...manifest, mcpApp: undefined }), /builtin UI/)
  assert.throws(() => validateAppManifest({ ...manifest, ui: { entry: 'dist/ui/index.html' } }), /3.17/)
  assert.equal(validateAppManifest({ ...manifest, hostApi: '^3.17.0', ui: { entry: 'dist/ui/index.html' } }).ui.entry, 'dist/ui/index.html')
  assert.throws(() => validateAppManifest({ ...manifest, ui: { builtin: 'mcp', entry: 'other.html' } }), /Invalid/)
  assert.throws(() => validateAppManifest({ ...manifest, backend: { entry: 'run.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'persistent', actions: [] } }), /no Backend/)
  assert.throws(() => validateAppManifest({ ...manifest, permissions: [...manifest.permissions, 'desktop:control'] }), /only the MCP/)
  assert.throws(() => validateAppManifest({ ...manifest, permissions: ['mcp:read'] }), /MCP Host/)
})

test('custom MCP UI packages keep MCP configuration and isolated UI assets', async t => {
  const f = await fixture(t), generated = await f.generate()
  const uiDir = path.join(generated.root, 'dist', 'ui')
  await fs.mkdir(uiDir, { recursive: true })
  await fs.writeFile(path.join(uiDir, 'index.html'), '<!doctype html><script src="app.js"></script>')
  await fs.writeFile(path.join(uiDir, 'app.js'), 'document.title = "Diagram"')
  const manifest = { ...generated.manifest, hostApi: '^3.17.0', ui: { entry: 'dist/ui/index.html' },
    permissions: [...generated.manifest.permissions, 'mcp:auth'] }
  await fs.writeFile(path.join(generated.root, 'app.moss.json'), JSON.stringify(manifest))
  await writePackageChecksums(generated.root)
  assert.equal((await validateAppPackage(generated.root)).manifest.ui.entry, 'dist/ui/index.html')
  await fs.writeFile(path.join(uiDir, 'native.node'), 'binary')
  await writePackageChecksums(generated.root)
  await assert.rejects(validateAppPackage(generated.root), /only configuration/)
})

test('installation validates data files and config even when checksums are valid', async t => {
  const f = await fixture(t), generated = await f.generate()
  await fs.writeFile(path.join(generated.root, 'unexpected.html'), '<script>bad()</script>')
  await writePackageChecksums(generated.root)
  await assert.rejects(validateAppPackage(generated.root), /only configuration/)
  await fs.rm(path.join(generated.root, 'unexpected.html'))
  await fs.writeFile(path.join(generated.root, 'mcp.json'), '{}')
  await writePackageChecksums(generated.root)
  await assert.rejects(validateAppPackage(generated.root), /1–100/)
})

test('stateful is the default; only explicit stateless Apps can opt into idle recycling', async t => {
  const f = await fixture(t)
  assert.equal((await f.generate()).manifest.mcpApp.runtime, undefined)
  const policy = { state: 'stateless', idleTimeoutMs: 60_000 }
  const generated = await f.generate({ runtime: policy })
  assert.deepEqual((await validateAppPackage(generated.root)).manifest.mcpApp.runtime, policy)
  await assert.rejects(f.generate({ runtime: { state: 'session', idleTimeoutMs: 60_000 } }), /stateless/)
  await assert.rejects(f.generate({ runtime: { state: 'stateless', idleTimeoutMs: 0 } }), /Invalid/)
  await assert.rejects(f.generate({ runtime: { state: 'shared' } }), /Invalid/)
})

test('directory-bound Apps require Host 3.10 and validate their portable directory configuration', async t => {
  const f = await fixture(t)
  const roots = { includeWorkspace: true, delivery: 'arguments', directories: ['~/Documents'] }
  const generated = await f.generate({ mcpServers: { files: { command: 'npx', args: ['server'], roots } } })
  assert.equal(generated.manifest.hostApi, '^3.10.0')
  await assert.rejects(f.generate({ mcpServers: { files: { command: 'npx', roots: { ...roots, directories: ['relative'] } } } }), /绝对路径/)
  await assert.rejects(f.generate({ mcpServers: { files: { url: 'https://example.com', roots } } }), /stdio/)
  await fs.writeFile(path.join(generated.root, 'app.moss.json'), JSON.stringify({ ...generated.manifest, hostApi: '^3.9.0' }))
  await writePackageChecksums(generated.root)
  await assert.rejects(validateAppPackage(generated.root), /3.10/)
})

test('Python environments and argument bindings require Host 3.11 and pinned dependencies', async t => {
  const f = await fixture(t)
  const service = { command: 'python3', args: ['-m', 'mcp_server_git'], python: { requirements: ['mcp-server-git==2026.8.18'] },
    roots: { directories: [], includeWorkspace: true, delivery: 'roots' }, pathBindings: [{ argument: 'repo_path', kind: 'git-repository' }] }
  const generated = await f.generate({ mcpServers: { git: service } })
  assert.equal(generated.manifest.hostApi, '^3.11.0')
  await assert.rejects(f.generate({ mcpServers: { git: { ...service, python: { requirements: ['mcp-server-git'] } } } }), /固定版本/)
  await assert.rejects(f.generate({ mcpServers: { git: { ...service, roots: undefined } } }), /目录配置/)
  await fs.writeFile(path.join(generated.root, 'app.moss.json'), JSON.stringify({ ...generated.manifest, hostApi: '^3.10.0' }))
  await writePackageChecksums(generated.root)
  await assert.rejects(validateAppPackage(generated.root), /3.11/)
})

test('MCP source is accepted only with a validated source descriptor; runtime remains data only', async t => {
  const { attachSourcePackage } = await import('../src/packages/source.mjs')
  const f = await fixture(t), generated = await f.generate({ publisher: { id: 'test', name: 'Test' } })
  assert.equal(generated.manifest.publisher.id, 'test')
  const source = path.join(f.root, 'project')
  await fs.mkdir(source)
  await fs.writeFile(path.join(source, 'app.json'), JSON.stringify(f.definition))
  await fs.writeFile(path.join(source, 'app.moss.json'), JSON.stringify(generated.manifest))
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'test-mcp-source', packageManager: 'bun@1.3.10', scripts: { build: 'node build.mjs' } }))
  await fs.writeFile(path.join(source, 'bun.lock'), '{}')
  await fs.writeFile(path.join(source, 'build.mjs'), '// shared generator source')
  await attachSourcePackage(generated.root, source)
  await writePackageChecksums(generated.root)
  assert.equal((await validateAppPackage(generated.root, { requireSource: true })).manifest.id, f.definition.id)
  const store = new AppPackageStore({ appsDir: path.join(f.root, 'installed') })
  assert.equal((await store.installFromDirectory(generated.root)).manifest.ui.builtin, 'mcp')
  await fs.rm(path.join(generated.root, 'source-manifest.json'))
  await writePackageChecksums(generated.root)
  await assert.rejects(validateAppPackage(generated.root), /source is required/)
})

test('resource files cannot supply reserved source descriptors or source trees', async t => {
  const f = await fixture(t), resourcesDir = path.join(f.root, 'resources')
  await fs.mkdir(resourcesDir)
  await fs.writeFile(path.join(resourcesDir, 'source-manifest.json'), '{}')
  await assert.rejects(f.generate({}, { resourcesDir }), /Reserved/)
  await fs.rm(path.join(resourcesDir, 'source-manifest.json'))
  await fs.mkdir(path.join(resourcesDir, 'source'))
  await fs.writeFile(path.join(resourcesDir, 'source/config.json'), '{}')
  await assert.rejects(f.generate({}, { resourcesDir }), /Reserved/)
})
