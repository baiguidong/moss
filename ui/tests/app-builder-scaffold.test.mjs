import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fixture, developerCatalog } from './helpers/app-authoring-fixture.mjs'

const appsRoot = process.env.MOSS_APPS_ROOT || path.resolve(import.meta.dirname, '../../../moss-apps')
const { scaffold } = await import(pathToFileURL(path.join(appsRoot, 'apps/app-builder/resources/authoring/scaffold.mjs')))

test('Builder scaffold uses exported SDK, builds a real App and tests immutable backend without a UI', async () => {
  const f = await fixture({ waitTimeoutMs: 30000 })
  try {
    const project = await f.prepare()
    await f.call('sdk.export', { projectRef: project.projectRef, sdkHash: developerCatalog.info.sdkHash }, { protocol: 'moss.host/v1' })
    const result = await scaffold({ dest: project.path, id: project.appId, name: '文本统计测试' })
    assert.ok(result.files.includes('package-lock.json'))
    await assert.rejects(scaffold({ dest: project.path, id: project.appId, name: '覆盖' }), /overwrite/)
    assert.ok((await fs.readFile(path.join(project.path, '.moss-sdk/packages/app-sdk/authoring.md'), 'utf8')).includes('主会话'))
    const build = await f.wait((await f.build(project)).operationRef)
    assert.equal(build.status, 'succeeded', JSON.stringify(build))
    const preview = await f.call('artifact.preview', { artifactRef: build.result.artifactRef, submissionKey: 'preview' })
    const ready = await f.wait(preview.operationRef, 'artifact')
    assert.equal(ready.status, 'ready', JSON.stringify(ready))
    for (const [key, input, expected] of [['unicode', { text: '你好🌳\r\nMoss' }, { characters: 9, lines: 2 }], ['empty', { text: '' }, { characters: 0, lines: 0 }]]) {
      const operation = await f.call('artifact.test', { previewRef: preview.operationRef, action: 'text_stats', input, submissionKey: key })
      const tested = await f.wait(operation.operationRef, 'artifact')
      assert.equal(tested.status, 'succeeded', JSON.stringify(tested))
      assert.deepEqual(tested.result.value, expected)
    }
    const bad = await f.call('artifact.test', { previewRef: preview.operationRef, action: 'text_stats', input: { text: 42 }, submissionKey: 'bad-input' })
    assert.equal((await f.wait(bad.operationRef, 'artifact')).status, 'failed')
    assert.equal(f.runtime.installations.get(project.appId), null)
  } finally { await f.close() }
}, 60000)
