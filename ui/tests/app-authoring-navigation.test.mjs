import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fixture, writeApp } from './helpers/app-authoring-fixture.mjs'
import { writeJson } from '../src/apps/app-authoring-source.mjs'

test('new builds reject unresolved navigation before executing build commands', async () => {
  const f = await fixture()
  try {
    const project = await f.prepare()
    await writeApp(project)
    const file = `${project.path}/app.moss.json`
    const raw = JSON.parse(await fs.readFile(file, 'utf8')); delete raw.navigation
    await writeJson(file, raw)
    await assert.rejects(() => f.build(project), /explicitly declare navigation/)
    assert.equal(f.commands.length, 0)
  } finally { await f.close() }
}, 30000)

for (const location of ['more', 'settings', 'none']) test(`navigation ${location} survives build, install and recovery from installed source`, async () => {
  const f = await fixture({ waitTimeoutMs: 30000 })
  try {
    const project = await f.prepare()
    await writeApp(project, { backend: location === 'none' })
    const file = `${project.path}/app.moss.json`
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    if (location === 'settings') {
      raw.navigation.location = 'settings'
      raw.contributes.views[0].route = '#/settings'
      raw.contributes.settings = [{ id: 'preferences', title: 'Preferences', viewId: 'home', group: 'integrations' }]
    }
    if (location === 'none') raw.toolScope = 'global'
    await writeJson(file, raw)
    const built = await f.wait((await f.build(project)).operationRef)
    assert.equal(built.status, 'succeeded', built.error)
    const prepared = await f.call('release.prepare', { artifactRef: built.result.artifactRef, submissionKey: randomUUID(), expectedBaseVersion: null, expectedInstallationRevision: 0, dataCompatibility: 'unchanged' })
    await f.call('release.commit', { releaseRef: prepared.operationRef, submissionKey: randomUUID() })
    const receipt = await f.wait(prepared.operationRef, 'release')
    assert.equal(receipt.status, 'succeeded', receipt.error)
    const installed = `${f.appsDir}/${project.appId}/versions/0.1.0`
    for (const suffix of ['app.moss.json', 'source/app.moss.json']) {
      const result = JSON.parse(await fs.readFile(`${installed}/${suffix}`, 'utf8'))
      assert.deepEqual(result.navigation, raw.navigation)
      if (location === 'settings') assert.equal(result.contributes.settings[0].group, 'integrations')
      if (location === 'none') assert.equal(result.toolScope, 'global')
    }
    await fs.rm(project.sourceRoot || project.path, { recursive: true, force: true })
    await f.restart()
    const target = await f.call('target.inspect', { appId: project.appId }, { read: true })
    const restored = await f.call('project.prepare', { intent: 'edit', projectId: randomUUID(), targetRef: target.targetRef })
    const recovered = JSON.parse(await fs.readFile(`${restored.path}/app.moss.json`, 'utf8'))
    assert.deepEqual(recovered.navigation, raw.navigation)
    if (location === 'settings') assert.equal(recovered.contributes.settings[0].group, 'integrations')
    if (location === 'none') assert.equal(recovered.toolScope, 'global')
  } finally { await f.close() }
}, 60000)
