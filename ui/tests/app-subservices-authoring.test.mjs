import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fixture, writeApp } from './helpers/app-authoring-fixture.mjs'
import { writeJson } from '../src/apps/app-authoring-source.mjs'
import { appServiceKey } from '../../packages/app-sdk/src/tool-services.mjs'

test('subservice contract survives real build, installation, source restoration and runtime filtering', async () => {
  const f = await fixture({ waitTimeoutMs: 30000 })
  try {
    const project = await f.prepare()
    await writeApp(project, { backend: true })
    const file = `${project.path}/app.moss.json`
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    raw.hostApi = '^3.8.0'; raw.toolSelection = 'services'
    raw.contributes = {
      services: ['sales', 'support'].map(id => ({ id, title: id })),
      tools: ['sales', 'support'].map(serviceId => ({ id: `read-${serviceId}`, serviceId, title: serviceId,
        description: `Read ${serviceId}`, effect: 'read', action: 'echo', inputSchema: 'schemas/echo.json' })),
    }
    await writeJson(file, raw)
    const built = await f.wait((await f.build(project)).operationRef)
    assert.equal(built.status, 'succeeded', built.error)
    const prepared = await f.call('release.prepare', { artifactRef: built.result.artifactRef, submissionKey: randomUUID(), expectedBaseVersion: null, expectedInstallationRevision: 0, dataCompatibility: 'unchanged' })
    await f.call('release.commit', { releaseRef: prepared.operationRef, submissionKey: randomUUID() })
    const receipt = await f.wait(prepared.operationRef, 'release')
    assert.equal(receipt.status, 'succeeded', receipt.error)
    for (const suffix of ['app.moss.json', 'source/app.moss.json']) {
      const manifest = JSON.parse(await fs.readFile(`${f.appsDir}/${project.appId}/versions/0.1.0/${suffix}`, 'utf8'))
      assert.equal(manifest.toolSelection, 'services')
      assert.deepEqual(manifest.contributes.services, raw.contributes.services)
      assert.deepEqual(manifest.contributes.tools.map(tool => tool.serviceId), ['sales', 'support'])
    }
    const selected = await f.runtime.listContributions({ appId: project.appId, kinds: ['tools'], loadSchemas: true,
      selectedAppIds: [], selectedAppServiceIds: [appServiceKey(project.appId, 'sales')] })
    assert.deepEqual(selected.tools.map(tool => tool.serviceId), ['sales'])
    await fs.rm(project.sourceRoot || project.path, { recursive: true, force: true })
    await f.restart()
    const target = await f.call('target.inspect', { appId: project.appId }, { read: true })
    const restored = await f.call('project.prepare', { intent: 'edit', projectId: randomUUID(), targetRef: target.targetRef })
    const restoredManifest = JSON.parse(await fs.readFile(`${restored.path}/app.moss.json`, 'utf8'))
    assert.equal(restoredManifest.toolSelection, 'services')
    assert.deepEqual(restoredManifest.contributes.tools.map(tool => tool.serviceId), ['sales', 'support'])
  } finally { await f.close() }
}, 60000)
