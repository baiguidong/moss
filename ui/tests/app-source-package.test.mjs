import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fixture, writeApp } from './helpers/app-authoring-fixture.mjs'
import { attachSourcePackage, validateSourcePackage } from '../../packages/app-runtime/src/packages/source.mjs'
import { writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'
import { writeJson } from '../src/apps/app-authoring-source.mjs'

async function installBuild(f, project) {
  const build = await f.wait((await f.build(project)).operationRef)
  assert.equal(build.status, 'succeeded', build.error)
  const release = await f.call('release.prepare', { artifactRef: build.result.artifactRef, submissionKey: randomUUID(), expectedBaseVersion: project.baseVersion, expectedInstallationRevision: project.installationRevision, dataCompatibility: 'unchanged' })
  await f.call('release.commit', { releaseRef: release.operationRef, submissionKey: randomUUID() })
  const receipt = await f.wait(release.operationRef, 'release')
  assert.equal(receipt.status, 'succeeded', receipt.error)
}

test('installed Builder source survives deletion of workspace and caches, restart, and transfer to another home', async () => {
  const f = await fixture(), next = await fixture()
  try {
    const project = await f.prepare()
    await writeApp(project)
    await installBuild(f, project)
    const installed = path.join(f.appsDir, project.appId, 'versions/0.1.0')
    const source = await validateSourcePackage(installed, { required: true })
    await fs.access(path.join(source.root, '.moss-sdk/packages/app-sdk/src/index.mjs'))
    await fs.rm(f.workspace, { recursive: true, force: true }); await fs.mkdir(f.workspace)
    for (const name of ['artifacts', 'sources', 'dependency-cache']) await fs.rm(path.join(f.home, 'app-authoring', name), { recursive: true, force: true })
    await f.restart()
    const target = await f.call('target.inspect', { appId: project.appId })
    const restored = await f.prepare({ intent: 'edit', targetRef: target.targetRef })
    assert.equal(restored.sourceKind, 'package')
    assert.equal(await fs.readFile(path.join(restored.path, 'src/index.html'), 'utf8'), '<h1>Created App</h1>')
    await writeApp(restored, { version: '0.2.0', content: '<h1>Edited after restart</h1>' })
    await installBuild(f, restored)
    const transferred = path.join(f.appsDir, project.appId, 'versions/0.2.0')
    await next.runtime.installFromDirectory(transferred)
    await writeJson(path.join(next.appsDir, project.appId, 'current.json'), { version: '0.2.0' })
    const target2 = await next.call('target.inspect', { appId: project.appId })
    const restored2 = await next.prepare({ intent: 'edit', targetRef: target2.targetRef })
    assert.equal(await fs.readFile(path.join(restored2.path, 'src/index.html'), 'utf8'), '<h1>Edited after restart</h1>')
    await writeApp(restored2, { version: '0.3.0' })
    await installBuild(next, restored2)
  } finally { await f.close(); await next.close() }
}, 60000)

test('Bun workspace restores appRoot and builds at the correct cwd with a frozen lockfile', async () => {
  const f = await fixture({ waitTimeoutMs: 90000, bunCommand: null })
  try {
    const workspace = path.join(f.home, 'exported'), appRoot = 'apps/example', app = path.join(workspace, appRoot)
    await fs.mkdir(app, { recursive: true })
    await writeApp({ path: app, appId: 'test.created' })
    await writeJson(path.join(workspace, 'package.json'), { name: 'workspace-fixture', private: true, packageManager: 'bun@1.3.10', workspaces: [appRoot] })
    execFileSync('bun', ['install', '--lockfile-only', '--ignore-scripts'], { cwd: workspace, stdio: 'pipe' })
    const pkg = path.join(f.home, 'package'); await fs.mkdir(path.join(pkg, 'dist'), { recursive: true })
    await fs.copyFile(path.join(app, 'app.moss.json'), path.join(pkg, 'app.moss.json'))
    await fs.copyFile(path.join(app, 'src/index.html'), path.join(pkg, 'dist/index.html'))
    await attachSourcePackage(pkg, workspace, { appRoot }); await writePackageChecksums(pkg)
    await f.runtime.installFromDirectory(pkg)
    await writeJson(path.join(f.appsDir, 'test.created/current.json'), { version: '0.1.0' })
    const target = await f.call('target.inspect', { appId: 'test.created' })
    const project = await f.prepare({ intent: 'edit', targetRef: target.targetRef })
    assert.equal(project.path, path.join(project.sourceRoot, appRoot))
    assert.equal(project.toolchain.packageManager.name, 'bun')
    await writeApp(project, { version: '0.2.0' })
    await installBuild(f, project)
    assert(f.commands.some(command => command.includes('--frozen-lockfile')))
    const source = await validateSourcePackage(path.join(f.appsDir, 'test.created/versions/0.2.0'), { required: true })
    assert.equal(source.descriptor.appRoot, appRoot)
  } finally { await f.close() }
}, 120000)

test('source gate rejects missing locks, changed metadata, escaped paths, and runtime-only SDK dependencies', async () => {
  const f = await fixture()
  try {
    const project = await f.prepare(); await writeApp(project, { backend: true })
    await fs.writeFile(path.join(project.path, 'src/main.mjs'), "import {AppBackendClient} from '@moss/app-sdk';new AppBackendClient().start();")
    const failed = await f.wait((await f.build(project)).operationRef)
    assert.equal(failed.status, 'failed')
    assert.match(failed.error, /Cannot find package|ERR_MODULE_NOT_FOUND/)
    await writeApp(project)
    const build = await f.wait((await f.build(project)).operationRef)
    assert.equal(build.status, 'succeeded', build.error)
    const pkg = path.join(f.home, 'app-authoring/artifacts', build.result.artifactRef)
    const descriptor = JSON.parse(await fs.readFile(path.join(pkg, 'source-manifest.json'), 'utf8'))
    await writeJson(path.join(pkg, 'source-manifest.json'), { ...descriptor, appRoot: '../outside' })
    await assert.rejects(() => validateSourcePackage(pkg), /unsafe path/)
    await writeJson(path.join(pkg, 'source-manifest.json'), { ...descriptor, toolchain: { ...descriptor.toolchain, packageManager: { name: 'bun', version: '1.3.10' } } })
    await assert.rejects(() => validateSourcePackage(pkg), /metadata/)
    await writeJson(path.join(project.path, 'package.json'), { name: 'missing-lock', dependencies: { react: '19.2.0' }, scripts: { build: 'node build.mjs' } })
    await assert.rejects(() => f.build(project), /lockfile|lock/)
  } finally { await f.close() }
}, 30000)
