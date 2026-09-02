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

  test('keeps connector secrets in main-process runtime resources only', async () => {
    const source = await teamFixture()
    let credential = 'secret-one'
    const catalog = new GroupRoomResourceCatalog({
      listAssistants: async () => [{ name: 'review-team', displayName: 'Review Team', source, enabled: true }],
      listConnectors: async () => [{ id: 'mail', name: 'Mail', enabled: true, connected: true }],
      getConnectorMcpServers: () => ({ mail: { type: 'stdio', env: { TOKEN: credential } } }),
      getConnectorCredentialEnv: () => ({ TOKEN: credential }),
      getConnectorAddDirs: () => [],
    })
    const [member] = await catalog.resolveInvitations(['review-team'])
    member.grants.connectors = [{ id: 'mail', access: 'write' }]
    const runtime = await catalog.resolveRuntimeResources(member)

    expect(runtime.environment.TOKEN).toBe('secret-one')
    expect(JSON.stringify(member)).not.toContain('secret-one')
    expect(runtime.mcpServerNames).toEqual(['mail'])
    credential = 'secret-two'
    const rotated = await catalog.resolveRuntimeResources(member)
    expect(rotated.fingerprint).not.toBe(runtime.fingerprint)
    expect(rotated.fingerprint).not.toContain('secret-two')
  })

  test('does not advertise connector skills or add-dirs to a read-only grant', async () => {
    const source = await teamFixture()
    const connectorRoot = path.join(source, 'mail-connector')
    const skillRoot = path.join(connectorRoot, 'skills')
    await mkdir(path.join(skillRoot, 'connector-mail'), { recursive: true })
    await writeFile(path.join(skillRoot, 'connector-mail', 'SKILL.md'), '---\nname: connector-mail\n---\nMail actions')
    const catalog = new GroupRoomResourceCatalog({
      listAssistants: async () => [{ name: 'review-team', displayName: 'Review Team', source, enabled: true }],
      listConnectors: async () => [{ id: 'mail', name: 'Mail', enabled: true, connected: true, skillRoot }],
      getConnectorMcpServers: () => ({ mail: { type: 'http', url: 'https://example.test/mcp' } }),
      getConnectorCredentialEnv: () => ({}),
      getConnectorAddDirs: (ids: string[]) => ids.includes('mail') ? [connectorRoot] : [],
      getConnectorCliCommandNames: (ids: string[]) => ids.includes('mail') ? ['mail-cli'] : [],
    })
    const [member] = await catalog.resolveInvitations(['review-team'])
    member.grants.connectors = [{ id: 'mail', access: 'read' }]
    const readOnly = await catalog.resolveRuntimeResources(member)
    expect(readOnly.addDirs).not.toContain(connectorRoot)
    expect(readOnly.skillCommands).not.toContain('connector-mail')

    member.grants.connectors = [{ id: 'mail', access: 'write', exec: true }]
    const executable = await catalog.resolveRuntimeResources(member)
    expect(executable.addDirs).toContain(connectorRoot)
    expect(executable.skillCommands).toContain('connector-mail')
    expect(executable.cliCommandNames).toEqual(['mail-cli'])
    expect(executable.fingerprint).not.toBe(readOnly.fingerprint)
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
    expect(await catalog.listSkills()).toEqual([expect.objectContaining({ id: 'skill-id', command: 'custom-skill' })])
  })
})
