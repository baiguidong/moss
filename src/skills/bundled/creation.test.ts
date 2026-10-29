import { afterAll, expect, test } from 'bun:test'
import { readFile, rm, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { registerCreationSkills } from './creation.js'
import { clearBundledSkills, getBundledSkills } from '../bundledSkills.js'
import { mergeBuiltinSkills } from '../mergeBuiltinSkills.js'
import type { Command } from '../../types/command.js'

const oldMacro = (globalThis as any).MACRO
const oldDirectory = process.env.MOSS_BUNDLED_SKILLS_DIR
;(globalThis as any).MACRO = { VERSION: 'creation-test' }
const extracted: string[] = []
afterAll(async () => {
  (globalThis as any).MACRO = oldMacro
  if (oldDirectory === undefined) delete process.env.MOSS_BUNDLED_SKILLS_DIR
  else process.env.MOSS_BUNDLED_SKILLS_DIR = oldDirectory
  clearBundledSkills()
  await Promise.all(extracted.map(directory => rm(directory, { recursive: true, force: true })))
})

test('CLI builtin skills extract complete runnable resources on invocation', async () => {
  delete process.env.MOSS_BUNDLED_SKILLS_DIR
  clearBundledSkills(); registerCreationSkills()
  const skills = getBundledSkills()
  expect(skills.map(skill => skill.name)).toEqual(['skill-creator', 'skill-installer', 'imagegen'])
  for (const skill of skills) {
    if (skill.type !== 'prompt') throw new Error('Expected prompt')
    extracted.push(skill.skillRoot!)
    const prompt = await skill.getPromptForCommand('测试请求', {} as any)
    expect(prompt[0]).toMatchObject({ type: 'text' })
    expect((prompt[0] as any).text).toContain(skill.skillRoot)
    expect((prompt[0] as any).text).toContain('测试请求')
    expect(await readFile(path.join(skill.skillRoot!, 'SKILL.md'), 'utf8')).toContain(`name: ${skill.name}`)
    if (skill.name !== 'imagegen') {
      const file = path.join(skill.skillRoot!, 'scripts', skill.name === 'skill-creator' ? 'skill.py' : 'install.py')
      const run = Bun.spawn(['python3', '-B', file, '--help'], { stdout: 'pipe', stderr: 'pipe' })
      expect(await run.exited).toBe(0)
      expect(await new Response(run.stdout).text()).toContain('usage:')
    }
  }
})

test('desktop uses resource catalog without duplicate compiled skills', () => {
  clearBundledSkills(); process.env.MOSS_BUNDLED_SKILLS_DIR = '/bundle/skills'
  registerCreationSkills(); expect(getBundledSkills()).toEqual([])
})

test('local customizations override shipped copies in both delivery modes', () => {
  const make = (name: string, root?: string) => ({ name, type: 'prompt', skillRoot: root } as Command)
  const personal = make('imagegen', '/user/skills/imagegen')
  const packaged = make('imagegen', '/bundle/skills/imagegen')
  expect(mergeBuiltinSkills([make('imagegen')], [personal])).toEqual([personal])
  expect(mergeBuiltinSkills([], [personal, packaged], '/bundle/skills')).toEqual([personal])
  expect(mergeBuiltinSkills([], [packaged], '/bundle/skills')).toEqual([packaged])
})

test('Moss filesystem loader reads every builtin and resolves its prompt resources', async () => {
  // A subprocess isolates loader settings and environment from other test files.
  const directory = await mkdtemp(path.join(os.tmpdir(), 'moss-skill-loader-'))
  try {
    const script = `globalThis.MACRO={VERSION:'test'}; const {getSkillDirCommands}=await import(${JSON.stringify(path.resolve('src/skills/loadSkillsDir.ts'))}); const commands=await getSkillDirCommands(${JSON.stringify(directory)}); const skills=commands.filter(s=>['skill-creator','skill-installer','imagegen'].includes(s.name)); for(const skill of skills) { const prompt=await skill.getPromptForCommand('',{}); if(!prompt.some(p=>p.type==='text'&&p.text.includes(skill.skillRoot))) throw new Error('Missing base directory'); } console.log(JSON.stringify(skills.map(s=>s.name).sort()));`
    const run = Bun.spawn(['bun', '-e', script], { env: { ...process.env, MOSS_HOME: directory, MOSS_CONFIG_DIR: directory, MOSS_BUNDLED_SKILLS_DIR: path.resolve('skills') }, stdout: 'pipe', stderr: 'pipe' })
    const output = await new Response(run.stdout).text(), errors = await new Response(run.stderr).text()
    expect(await run.exited, errors).toBe(0)
    expect(JSON.parse(output.trim())).toEqual(['imagegen', 'skill-creator', 'skill-installer'])
  } finally { await rm(directory, { recursive: true, force: true }) }
})
