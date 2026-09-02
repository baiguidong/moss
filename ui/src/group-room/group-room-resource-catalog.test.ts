import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { GroupRoomResourceCatalog } from './group-room-resource-catalog.mjs'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function teamFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moss-room-team-'))
  roots.push(root)
  await mkdir(path.join(root, 'agents'), { recursive: true })
  await writeFile(path.join(root, 'assistant.md'), 'Team charter')
  await writeFile(path.join(root, 'agents', 'reviewer.md'), 'Review carefully')
  await writeFile(path.join(root, 'agents', 'builder.md'), 'Build carefully')
  await writeFile(path.join(root, '_moss_meta.json'), JSON.stringify({
    name: 'review-team',
    display_name: 'Review Team',
    expert_type: 'team',
    prompt_file: 'assistant.md',
    enabledSkills: ['skills/review'],
    members: [
      { id: 'reviewer', displayName: 'Reviewer', promptFile: 'agents/reviewer.md' },
      { id: 'builder', displayName: 'Builder', promptFile: 'agents/builder.md' },
    ],
  }))
  return root
}

describe('GroupRoomResourceCatalog', () => {
  test('expands a team and keeps its charter separate from member prompts', async () => {
    const source = await teamFixture()
    const catalog = new GroupRoomResourceCatalog({
      listAssistants: async () => [
        { name: 'review-team', displayName: 'Review Team', source, enabled: true },
        { name: 'review-team', displayName: 'Review Team Legacy Copy', source, enabled: true },
      ],
    })

    const members = await catalog.resolveInvitations(['review-team'])
    expect(await catalog.listInviteables()).toHaveLength(1)
    expect(members.map(member => member.displayName)).toEqual(['Reviewer', 'Builder'])
    expect(members[0].teamCharterSnapshot).toBe('Team charter')
    expect(members[0].promptSnapshot).toBe('Review carefully')
    expect(members[0].grants.skills).toEqual(['review'])
  })

  test('rejects the whole team when a member prompt is missing', async () => {
    const source = await teamFixture()
    await rm(path.join(source, 'agents', 'builder.md'))
    const catalog = new GroupRoomResourceCatalog({
      listAssistants: async () => [{ name: 'review-team', displayName: 'Review Team', source, enabled: true }],
    })
    expect(await catalog.listInviteables()).toEqual([])
    expect(catalog.resolveInvitations(['review-team'])).rejects.toThrow('builder')
  })

  test('does not grant a forked expert skill to room members', async () => {
    const source = await teamFixture()
    await mkdir(path.join(source, 'skills', 'review'), { recursive: true })
    await writeFile(path.join(source, 'skills', 'review', 'SKILL.md'), '---\ncontext: fork\n---\nFork work')
    const catalog = new GroupRoomResourceCatalog({
      listAssistants: async () => [{ name: 'review-team', displayName: 'Review Team', source, enabled: true }],
    })
    const members = await catalog.resolveInvitations(['review-team'])
    expect(members[0].grants.skills).toEqual([])
  })

  test('creates custom prompt members with exact non-fork skill grants', async () => {
    const source = await teamFixture()
    const skillRoot = path.join(source, 'custom-skill')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(path.join(skillRoot, 'SKILL.md'), '---\nname: custom-skill\n---\nUse it')
    const catalog = new GroupRoomResourceCatalog({
      listAssistants: async () => [],
      listSkills: async () => [{ id: 'skill-id', name: 'custom-skill', displayName: 'Custom Skill', source: skillRoot, enabled: true }],
    })

    const [custom] = await catalog.resolveCustomMembers([{
      displayName: 'Skeptic',
      role: 'Challenge assumptions',
      prompt: 'Find unsupported claims and return evidence.',
      skillIds: ['skill-id'],
    }])

    expect(custom.source.kind).toBe('custom')
    expect(custom.promptSnapshot).toBe('Find unsupported claims and return evidence.')
    expect(custom.grants.skills).toEqual(['custom-skill'])
    expect(custom.resourceSnapshot.skillDirectories).toEqual({ 'custom-skill': [skillRoot] })
    const listed = await catalog.listSkills()
    expect(listed).toEqual([expect.objectContaining({ id: 'skill-id', command: 'custom-skill' })])
    expect(listed[0]).not.toHaveProperty('source')
  })
})
