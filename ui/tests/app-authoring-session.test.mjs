import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fixture } from './helpers/app-authoring-fixture.mjs'

test('creation resources use the installed catalog and carry validated skill and assistant sources into the draft', async () => {
  const skills = [{ name: 'notes', displayName: '笔记整理', source: '/installed/skills/notes' },
    { name: 'notes', source: '/legacy/notes' }, { name: 'disabled', source: '/disabled', enabled: false }]
  const assistants = [{ name: 'writer', displayName: '写作助手', source: '/installed/assistants/writer' },
    { name: 'reviewer', source: '/installed/assistants/reviewer' }]
  const f = await fixture({ listSkills: async () => skills, listAssistants: async () => assistants })
  try {
    const owner = { appId: 'test.builder', owner: f.runtime.currentOwner() }
    const catalog = await f.service.handle('authoring.resources', {}, owner)
    assert.equal(catalog.items.length, 3)
    assert.ok(catalog.items.every(item => !('source' in item) && !('enabled' in item)))
    const refs = [{ kind: 'skill', name: 'notes', source: '/forged' }, { kind: 'assistant', name: 'writer' }]
    const draft = await f.service.prepareDraft({ intent: 'create', prompt: '保留整理与写作能力', ref: { resources: refs } }, owner)
    assert.equal(draft.prompt, '保留整理与写作能力')
    assert.deepEqual(draft.context.ref.resources.map(item => item.source), ['/installed/skills/notes', '/installed/assistants/writer'])
    assert.equal(f.service.operationsForSession('session').length, 0)
    assert.deepEqual(await fs.readdir(f.workspace), [])
    for (const resources of [[{ kind: 'app', name: 'notes' }], [{ kind: 'skill', name: 'disabled' }], [{ kind: 'skill', name: 'removed' }]]) {
      await assert.rejects(() => f.service.prepareDraft({ intent: 'create', ref: { resources } }, owner), /重新选择/)
    }
    await assert.rejects(() => f.service.prepareDraft({ intent: 'create', ref: { resources: assistants.map(item => ({ kind: 'assistant', name: item.name })) } }, owner), /一个助手/)
    skills[0].enabled = false; skills.splice(1, 1)
    await assert.rejects(() => f.service.prepareDraft({ intent: 'create', ref: { resources: refs } }, owner), /重新选择/)
  } finally { await f.close() }
})

test('SE-01/02/06/07: draft preparation is read-only; repeated preparation and parallel sessions preserve distinct source', async () => {
  const f = await fixture()
  try {
    const before = await fs.readdir(f.workspace)
    const draft = await f.service.prepareDraft({ intent: 'create' }, { appId: 'test.builder', owner: f.runtime.currentOwner() })
    assert.deepEqual(await fs.readdir(f.workspace), before)
    const input = { intent: 'create', appId: 'new.app', projectId: 'draft', draftRef: draft.context.ref.draftRef }
    const first = await f.call('project.prepare', input)
    await fs.writeFile(first.path + '/sentinel.txt', 'modified')
    assert.equal((await f.call('project.prepare', input)).projectRef, first.projectRef)
    f.sessions.set('other', { id: 'other', workspace: f.workspace, agentMode: 'local' })
    const other = await f.call('project.prepare', input, { sessionId: 'other' })
    assert.notEqual(other.path, first.path)
    assert.equal(await fs.readFile(first.path + '/sentinel.txt', 'utf8'), 'modified')
    await assert.rejects(() => f.call('project.prepare', { ...input, projectRef: first.projectRef }, { sessionId: 'other' }), /different session/)
    const owner = { appId: 'test.builder', owner: f.runtime.currentOwner() }
    assert.equal(f.service.resumeProject(first.projectRef, owner), 'session')
    f.sessions.get('session').busy = true
    assert.throws(() => f.service.resumeProject(first.projectRef, owner), /正在运行/)
    f.sessions.get('session').busy = false
    await f.restart()
    assert.equal((await f.call('project.prepare', input)).projectRef, first.projectRef)
  } finally { await f.close() }
})
