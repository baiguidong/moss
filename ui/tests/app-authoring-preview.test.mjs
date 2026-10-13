import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fixture, writeApp } from './helpers/app-authoring-fixture.mjs'
import { writeHostFixture } from './helpers/app-authoring-host-fixture.mjs'
import { contractDefinition } from '../../packages/app-sdk/src/host/contracts.mjs'
import { createAppPlatformHandlers } from '../src/apps/app-platform-host.mjs'

test('PV-02/03/04: real Backend-only previews are independent, Action tested, closed and not installed', async () => {
  const f = await fixture()
  try {
    const project = await f.prepare(); await writeApp(project, { backend: true })
    const build = await f.wait((await f.build(project)).operationRef)
    assert.equal(build.status, 'succeeded', build.error)
    const refs = []
    for (const submissionKey of ['one', 'two']) {
      const input = { artifactRef: build.result.artifactRef, submissionKey }
      const preview = await f.call('artifact.preview', input)
      assert.equal((await f.call('artifact.preview', input)).operationRef, preview.operationRef)
      const ready = await f.wait(preview.operationRef, 'artifact')
      assert.equal(ready.status, 'ready', ready.error)
      const test = await f.call('artifact.test', { previewRef: preview.operationRef, action: 'echo', input: { value: submissionKey }, submissionKey })
      const tested = await f.wait(test.operationRef, 'artifact')
      assert.equal(tested.status, 'succeeded', tested.error)
      assert.deepEqual(tested.result.value, { value: submissionKey })
      refs.push(preview.operationRef)
    }
    await f.call('artifact.close', { operationRef: refs[0] })
    assert.equal((await f.call('artifact.get', { operationRef: refs[1] }, { read: true })).status, 'ready')
    await assert.rejects(() => fs.stat(`${f.home}/previews/${refs[0]}`), /ENOENT/)
    assert.equal(f.runtime.installations.get(project.appId), null)
    const rejected = await f.call('artifact.test', { previewRef: refs[1], action: 'undeclared', submissionKey: 'undeclared' })
    assert.equal((await f.wait(rejected.operationRef, 'artifact')).status, 'failed')
    await f.service.stopSession('session')
    assert.equal((await f.call('artifact.get', { operationRef: refs[1] }, { read: true })).status, 'closed')
  } finally { await f.close() }
}, 20000)

test('PV-01/02/03: exported SDK builds UI+Backend; real file Host handler uses isolated target identity and grants', async () => {
  const f = await fixture()
  try {
    f.runtime.registerHostProtocol(contractDefinition('moss.platform/v1'))
    const handler = createAppPlatformHandlers({})['file.materialize']
    f.runtime.registerHostHandler('moss.platform/v1', 'file.materialize', handler)
    const project = await f.prepare(); await writeHostFixture(project)
    const build = await f.wait((await f.build(project)).operationRef)
    assert.equal(build.status, 'succeeded', build.error)
    const run = async (key, grants) => {
      const preview = await f.call('artifact.preview', { artifactRef: build.result.artifactRef, submissionKey: key, grants })
      assert.equal((await f.wait(preview.operationRef, 'artifact')).status, 'ready')
      const test = await f.call('artifact.test', { previewRef: preview.operationRef, action: 'write', input: { value: key }, submissionKey: key })
      return { preview, result: await f.wait(test.operationRef, 'artifact') }
    }
    const denied = await run('denied', [])
    assert.equal(denied.result.status, 'failed')
    assert.match(denied.result.error, /permission|grant/i)
    const first = await run('first', ['platform:files']), second = await run('second', ['platform:files'])
    for (const [key, item] of [['first', first], ['second', second]]) {
      assert.equal(item.result.status, 'succeeded', item.result.error)
      assert.equal(item.result.result.value.value, key)
      assert.equal(item.result.result.value.appId, project.appId)
      assert.ok(item.result.result.value.path.includes(item.preview.operationRef))
    }
    assert.notEqual(first.result.result.value.dataDir, second.result.result.value.dataDir)
    await f.call('artifact.close', { operationRef: first.preview.operationRef })
    await assert.rejects(() => fs.readFile(first.result.result.value.path), /ENOENT/)
    assert.equal(await fs.readFile(second.result.result.value.path, 'utf8'), 'second')
    assert.equal(f.runtime.installations.get(project.appId), null)
  } finally { await f.close() }
}, 20000)
