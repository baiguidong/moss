import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fixture, writeApp, developerCatalog } from './helpers/app-authoring-fixture.mjs'

test('BU-01/03/05: build uses an immutable snapshot and survives duplicate submission', async () => {
  const f = await fixture()
  try {
    const project = await f.prepare()
    const hash = await writeApp(project, { category: 'knowledge', keywords: ['资料', '目录'] })
    const input = { projectRef: project.projectRef, submissionKey: randomUUID(), sourceHash: hash, contractHash: developerCatalog.info.contractHash, sdkHash: developerCatalog.info.sdkHash }
    const started = await f.call('build.start', input)
    assert.equal((await f.call('build.start', input)).operationRef, started.operationRef)
    await fs.writeFile(project.path + '/src/index.html', '<h1>Next edit</h1>')
    const finished = await f.wait(started.operationRef)
    assert.equal(finished.status, 'succeeded', finished.error)
    const artifact = await f.call('artifact.validate', { artifactRef: finished.result.artifactRef }, { read: true })
    assert.equal(artifact.valid, true)
    assert.match(f.commands[0], /npm.*run.*build/)
    assert.equal(await fs.readFile(`${f.home}/app-authoring/artifacts/${started.operationRef}/dist/index.html`, 'utf8'), '<h1>Created App</h1>')
    for (const relative of ['app.moss.json', 'source/app.moss.json']) {
      const manifest = JSON.parse(await fs.readFile(`${f.home}/app-authoring/artifacts/${started.operationRef}/${relative}`, 'utf8'))
      assert.equal(manifest.category, 'knowledge')
      assert.deepEqual(manifest.keywords, ['资料', '目录'])
    }
  } finally { await f.close() }
})
test('BU-02: a denied ordinary command creates no build process or side effect', async () => {
  const f = await fixture()
  try {
    const project = await f.prepare(), sentinel = `${f.home}/forbidden`
    const hash = await writeApp(project, { buildCode: `await fs.writeFile(${JSON.stringify(sentinel)},'executed')` })
    await assert.rejects(() => f.call('build.start', { projectRef: project.projectRef, submissionKey: 'deny', sourceHash: hash, contractHash: developerCatalog.info.contractHash, sdkHash: developerCatalog.info.sdkHash }, { authorize: async () => { throw new Error('policy denied') } }), /denied/)
    await assert.rejects(() => fs.stat(sentinel), /ENOENT/)
    assert.equal(f.service.operationsForSession('session').length, 0)
  } finally { await f.close() }
})
test('BU-04/05/06: per-project quota, cancel, shutdown and retained receipts bound long-running work', async () => {
  const f = await fixture()
  try {
    const project = await f.prepare()
    await writeApp(project, { buildCode: 'await new Promise(resolve=>setTimeout(resolve,30000))' })
    const first = await f.build(project)
    await assert.rejects(() => f.build(project), /already active/)
    await f.service.stopSession('session')
    assert.equal((await f.wait(first.operationRef)).status, 'canceled')
    await f.service.shutdown()
    assert.deepEqual(await fs.readdir(`${f.workspace}/.moss-app-builds`), [])
    await f.service.collectGarbage(Date.now() + 8 * 86400000)
    assert.equal(f.service.operationsForSession('session').length, 0)
  } finally { await f.close() }
})
test('global queue runs only two builds and cancels queued work; output is capped at 10 MiB', async () => {
  const f = await fixture()
  try {
    const refs = []
    for (let index = 0; index < 3; index++) {
      const project = await f.prepare({ appId: `test.queue-${index}` })
      await writeApp(project, { buildCode: 'await new Promise(resolve=>setTimeout(resolve,30000))' })
      refs.push((await f.build(project)).operationRef)
    }
    const operations = f.service.operationsForSession('session')
    assert.equal(operations.filter(item => item.status === 'running').length, 2)
    assert.equal(operations.filter(item => item.status === 'queued').length, 1)
    await f.service.stopSession('session')
    for (const ref of refs) assert.equal((await f.wait(ref)).status, 'canceled')
    // Wait for the killed process trees before starting another project.
    const project = await f.prepare({ appId: 'test.log-limit' })
    await writeApp(project, { buildCode: "process.stdout.write('x'.repeat(11*1024*1024));await new Promise(resolve=>setTimeout(resolve,30000))" })
    const built = await f.wait((await f.build(project)).operationRef)
    assert.equal(built.status, 'failed')
    assert.match(built.error, /log limit/)
    assert.ok((await fs.stat(`${f.home}/app-authoring/${built.operationRef}.log`)).size <= 10 * 1024 * 1024)
  } finally { await f.close() }
})
