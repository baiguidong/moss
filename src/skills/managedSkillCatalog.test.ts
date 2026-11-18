import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCommands, getSkillToolCommands } from '../commands.js'

test('the command and Skill tool catalogs follow changes to the active server grants', async () => {
  const home = await mkdtemp(join(tmpdir(), 'moss-command-grants-'))
  const originalHome = process.env.MOSS_HOME
  process.env.MOSS_HOME = home
  const source = join(home, 'managed-resources', 'package', 'assigned-skill')
  const projectSkill = join(home, '.moss', 'skills', 'old-project-skill')
  const stateFile = join(home, 'managed-resource-control.json')
  try {
    for (const dir of [source, projectSkill]) {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'SKILL.md'), '---\ndescription: A test skill\n---\nSample instructions.')
    }
    await writeFile(stateFile, JSON.stringify({ enabled: true, resources: [{ kind: 'skill', source }] }))
    const commands = await getCommands(home)
    expect(commands.some(c => c.name === 'old-project-skill')).toBe(false)
    const granted = (await getSkillToolCommands(home)).find(c => c.name === 'assigned-skill')
    expect(granted?.type).toBe('prompt')
    await writeFile(stateFile, JSON.stringify({ enabled: true, resources: [] }))
    expect((await getSkillToolCommands(home)).some(c => c.name === 'assigned-skill')).toBe(false)
    if (granted?.type === 'prompt') await expect(granted.getPromptForCommand('', {} as never)).rejects.toThrow('未获')
  } finally {
    if (originalHome === undefined) delete process.env.MOSS_HOME
    else process.env.MOSS_HOME = originalHome
    await rm(home, { recursive: true, force: true })
  }
})
