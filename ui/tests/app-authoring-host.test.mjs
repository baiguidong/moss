import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers/app-authoring-fixture.mjs'
import fs from 'node:fs/promises'
import { writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'

test('EN-01/02: discovery follows enabled/granted state and accepts on-demand idle', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.service.availability()).available, true)
    const getStatus = f.runtime.getInstanceStatus.bind(f.runtime)
    for (const state of ['error', 'crash-loop']) {
      f.runtime.getInstanceStatus = async () => ({ state })
      assert.equal((await f.service.availability()).reason, 'backend-failed')
    }
    f.runtime.getInstanceStatus = getStatus
    await f.runtime.setAppEnabled('test.builder', false)
    assert.equal((await f.service.availability()).available, false)
    await f.runtime.setAppEnabled('test.builder', true)
    await f.runtime.setAppGrants('test.builder', ['apps:read'])
    assert.equal((await f.service.availability()).available, false)
  } finally { await f.close() }
})
test('discovery isolates a damaged unrelated App, rejects ambiguous providers and detects missing Host methods', async () => {
  const f = await fixture()
  try {
    await f.runtime.installations.upsert('broken.other', { enabled: true, activeVersion: '1.0.0', grants: [] })
    assert.equal((await f.service.availability()).available, true)
    const copy = `${f.home}/second-provider`
    await fs.cp(`${f.home}/provider`, copy, { recursive: true })
    const manifest = JSON.parse(await fs.readFile(`${copy}/app.moss.json`, 'utf8'))
    manifest.id = 'test.second-builder'
    await fs.writeFile(`${copy}/app.moss.json`, JSON.stringify(manifest)); await writePackageChecksums(copy)
    await f.runtime.installFromDirectory(copy)
    assert.equal((await f.service.availability()).reason, 'provider-conflict')
    await f.runtime.setAppEnabled(manifest.id, false)
    assert.equal((await f.service.availability()).available, true)
    f.runtime.hostCapabilities.handlers.get('moss.apps/v1').delete('build.start')
    assert.equal((await f.service.availability()).reason, 'host-upgrade-required')
  } finally { await f.close() }
})
test('EN-05/06: UI surface=tool, read contributions and stale tickets cannot prepare source', async () => {
  const f = await fixture()
  try {
    const input = { intent: 'create', projectId: 'p', appId: 'new.app' }
    await assert.rejects(() => f.runtime.invoke('test.builder', 'default', 'proxy', { method: 'project.prepare', input }, { invocation: { surface: 'tool', sessionId: 'session', workspace: f.workspace, origin: 'agent-tool', ticket: 'forged' } }))
    await assert.rejects(() => f.call('project.prepare', input, { read: true }), /write tool/)
    assert.equal((await f.call('catalog.list', {}, { read: true })).items.length, 1)
  } finally { await f.close() }
})
