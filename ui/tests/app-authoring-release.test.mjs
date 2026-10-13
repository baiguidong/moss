import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fixture, writeApp } from './helpers/app-authoring-fixture.mjs'
import { writeJson } from '../src/apps/app-authoring-source.mjs'

async function release(f, project, version) {
  await writeApp(project, { version })
  const build = await f.wait((await f.build(project)).operationRef)
  assert.equal(build.status, 'succeeded', build.error)
  const current = await f.call('project.prepare', { intent: 'edit', projectId: project.projectId, projectRef: project.projectRef })
  return f.call('release.prepare', { artifactRef: build.result.artifactRef, submissionKey: randomUUID(), expectedBaseVersion: current.baseVersion, expectedInstallationRevision: current.installationRevision, dataCompatibility: 'unchanged' })
}
test('RE-01 SE-05: consecutive installs advance baseline; lost response retries return one receipt', async () => {
  const f = await fixture()
  try {
    const project = await f.prepare()
    for (const version of ['0.1.0', '0.2.0']) {
      const prepared = await release(f, project, version)
      const input = { releaseRef: prepared.operationRef, submissionKey: randomUUID() }
      await f.call('release.commit', input)
      const receipt = await f.wait(prepared.operationRef, 'release')
      assert.equal(receipt.status, 'succeeded', receipt.error)
      assert.equal((await f.call('release.commit', input)).operationRef, receipt.operationRef)
      assert.equal(receipt.result.baseVersion, version)
      assert.match(f.service.promptForSession('session'), /succeeded/)
    }
    assert.equal(f.revisions.get(project.appId), 2)
    assert.equal((await f.service.contextForSession('session')).ref.projectRef, project.projectRef)
    await fs.access(`${f.appsDir}/${project.appId}/versions/0.2.0/source/src/index.html`)
  } finally { await f.close() }
}, 30000)
test('RE-02/03/07: ABA revision and grant changes invalidate prepared installation', async () => {
  const f = await fixture()
  try {
    const project = await f.prepare()
    const first = await release(f, project, '0.1.0')
    f.revisions.set(project.appId, 2)
    await assert.rejects(() => f.call('release.commit', { releaseRef: first.operationRef, submissionKey: 'stale' }), /changed/)
    f.revisions.set(project.appId, 0)
    await f.call('release.commit', { releaseRef: first.operationRef, submissionKey: 'first' })
    assert.equal((await f.wait(first.operationRef, 'release')).status, 'succeeded')
    const second = await release(f, project, '0.2.0')
    // Simulate a concurrent grant update without an installation version change.
    await f.runtime.installations.upsert(project.appId, { grants: ['apps:read'] })
    await assert.rejects(() => f.call('release.commit', { releaseRef: second.operationRef, submissionKey: 'grant' }), /permissions changed/)
  } finally { await f.close() }
}, 30000)
test('RE-03/08: cancellation and unknown migration state never install', async () => {
  const f = await fixture()
  try {
    const project = await f.prepare(), prepared = await release(f, project, '0.1.0')
    await f.call('release.cancel', { operationRef: prepared.operationRef })
    await assert.rejects(() => f.call('release.commit', { releaseRef: prepared.operationRef, submissionKey: 'canceled' }), /no longer usable/)
    assert.equal(f.revisions.get(project.appId), undefined)
    const build = f.service.operationsForSession('session').find(item => item.kind === 'build')
    await assert.rejects(() => f.call('release.prepare', { artifactRef: build.result.artifactRef, submissionKey: 'unknown', expectedBaseVersion: null, expectedInstallationRevision: 0, dataCompatibility: 'unknown' }), /compatibility/)
  } finally { await f.close() }
}, 30000)

for (const fault of ['none', 'package', 'source', 'revision']) {
  test(`RE-04: restart reconciles only the exact committed package, revision and source (${fault})`, async () => {
    const f = await fixture()
    try {
      const project = await f.prepare(), prepared = await release(f, project, '0.1.0')
      await f.call('release.commit', { releaseRef: prepared.operationRef, submissionKey: 'commit' })
      assert.equal((await f.wait(prepared.operationRef, 'release')).status, 'succeeded')
      await f.service.shutdown()
      const file = `${f.home}/app-authoring/state.json`, state = JSON.parse(await fs.readFile(file, 'utf8'))
      // Simulate loss of the final state write after disk/Runtime commit.
      state.operations[prepared.operationRef].status = 'committing'
      state.projects[project.projectRef].baseVersion = null
      state.projects[project.projectRef].installationRevision = 0
      await fs.writeFile(file, JSON.stringify(state))
      if (fault === 'package') await fs.writeFile(`${f.appsDir}/${project.appId}/versions/0.1.0/dist/index.html`, 'different package')
      if (fault === 'source') await fs.writeFile(`${f.appsDir}/${project.appId}/versions/0.1.0/source/src/index.html`, 'different source')
      if (fault === 'revision') f.revisions.set(project.appId, 3)
      const recovered = await f.restart()
      const receipt = recovered.operationsForSession('session').find(item => item.operationRef === prepared.operationRef)
      assert.equal(receipt.status, fault === 'none' ? 'succeeded' : 'failed', receipt.error)
      if (fault === 'none') assert.equal(receipt.result.recovered, true)
      else assert.match(receipt.error, /recovery failed/)
    } finally { await f.close() }
  }, 30000)
}

test('RE-04: an install failure preserves the previous active version and project baseline', async () => {
  let rejectInstall = false
  const f = await fixture({ beforeInstall: async () => { if (rejectInstall) throw new Error('Injected package copy failure') } })
  try {
    const project = await f.prepare(), first = await release(f, project, '0.1.0')
    await f.call('release.commit', { releaseRef: first.operationRef, submissionKey: 'first' })
    assert.equal((await f.wait(first.operationRef, 'release')).status, 'succeeded')
    const second = await release(f, project, '0.2.0')
    rejectInstall = true
    await f.call('release.commit', { releaseRef: second.operationRef, submissionKey: 'second' })
    const failed = await f.wait(second.operationRef, 'release')
    assert.equal(failed.status, 'failed')
    assert.match(failed.error, /Injected package copy failure/)
    assert.equal(f.runtime.installations.get(project.appId).activeVersion, '0.1.0')
    const current = await f.call('project.prepare', { projectId: project.projectId, projectRef: project.projectRef, intent: 'edit' })
    assert.equal(current.baseVersion, '0.1.0')
    assert.equal(current.installationRevision, 1)
  } finally { await f.close() }
}, 30000)

test('RE-06: provider self-update completes in Core after its old Backend is stopped', async () => {
  const f = await fixture()
  try {
    const source = `${f.workspace}/provider-source`
    await fs.mkdir(source)
    await writeApp({ path: source, appId: 'test.builder' }, { version: '2.0.0', backend: true })
    const manifest = JSON.parse(await fs.readFile(`${f.home}/provider/app.moss.json`, 'utf8'))
    manifest.version = '2.0.0'
    manifest.backend.entry = 'dist/main.mjs'
    manifest.backend.actions.forEach(action => { action.inputSchema = 'schemas/input.json' })
    manifest.contributes.tools.forEach(tool => { tool.inputSchema = 'schemas/input.json' })
    await writeJson(`${source}/app.moss.json`, manifest)
    await writeJson(`${source}/schemas/input.json`, { type: 'object', additionalProperties: true })
    await fs.writeFile(`${source}/src/main.mjs`, (await fs.readFile(`${f.home}/provider/dist/main.mjs`, 'utf8')).replace(/file:[^'\"]+packages\/app-sdk\/src\/index.mjs/, './sdk/packages/app-sdk/src/index.mjs'))
    await writeJson(`${f.appsDir}/test.builder/current.json`, { version: '1.0.0' })
    const target = await f.call('target.inspect', { appId: 'test.builder' }, { read: true })
    const project = await f.prepare({ intent: 'edit', appId: 'test.builder', targetRef: target.targetRef, sourcePath: 'provider-source' })
    const build = await f.wait((await f.build(project)).operationRef)
    assert.equal(build.status, 'succeeded', build.error)
    const prepared = await f.call('release.prepare', { artifactRef: build.result.artifactRef, submissionKey: 'self', expectedBaseVersion: '1.0.0', expectedInstallationRevision: 0, dataCompatibility: 'unchanged' })
    // Losing this Action response is allowed; the accepted receipt is independent.
    await f.call('release.commit', { releaseRef: prepared.operationRef, submissionKey: 'commit-self' }).catch(() => {})
    let receipt
    for (let index = 0; index < 300; index++) {
      receipt = f.service.operationsForSession('session').find(item => item.operationRef === prepared.operationRef)
      if (['succeeded', 'failed'].includes(receipt.status)) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(receipt.status, 'succeeded', receipt.error)
    assert.equal(f.runtime.installations.get('test.builder').activeVersion, '2.0.0')
    assert.equal(receipt.result.installationRevision, 1)
    assert.equal((await f.service.availability()).available, true)
  } finally { await f.close() }
}, 30000)
