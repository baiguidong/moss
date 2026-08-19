import { homedir } from 'os'
import { readFile, readdir, stat } from 'fs/promises'
import path from 'path'
import { parseFrontmatter } from './frontmatterParser.js'

const MOSS_HOME = process.env.MOSS_HOME || path.join(homedir(), '.moss')
const ASSISTANTS_DIR = path.join(MOSS_HOME, 'assistants')
const SKILLS_DIR = path.join(MOSS_HOME, 'skills')
const ASSISTANT_META_FILE = '_moss_meta.json'
const SKILL_META_FILE = '_moss_meta.json'
const ASSISTANT_RULE_FILES = [
  'system.md',
  'prompt.md',
  'assistant.md',
  'instructions.md',
  'rules.md',
] as const

type LocalMeta = Record<string, unknown>

export type LocalInstalledSkill = {
  name: string
  displayName: string
  description: string
  enabled: boolean
}

async function readJsonObject(filePath: string): Promise<LocalMeta | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as LocalMeta)
      : null
  } catch {
    return null
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

async function findAssistantDir(assistantName: string): Promise<string | null> {
  const normalized = assistantName.trim()
  if (!normalized || normalized.includes('/') || normalized.includes('\\')) {
    return null
  }
  const names = normalized.startsWith('builtin-')
    ? [normalized, normalized.slice('builtin-'.length)]
    : [normalized]
  const roots = [
    ASSISTANTS_DIR,
    path.join(ASSISTANTS_DIR, 'system'),
    path.join(ASSISTANTS_DIR, 'hub'),
    path.join(ASSISTANTS_DIR, '_my-custom-assistant'),
  ]

  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, name)
      try {
        if ((await stat(candidate)).isDirectory()) return candidate
      } catch {}
    }
  }

  for (const root of roots) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = path.join(root, entry.name)
      const meta = await readJsonObject(path.join(candidate, ASSISTANT_META_FILE))
      if (meta?.name === normalized) return candidate
    }
  }
  return null
}

export async function getAssistantSystemPrompt(
  assistantName: string,
): Promise<string | null> {
  const assistantDir = await findAssistantDir(assistantName)
  if (!assistantDir) return null
  const meta = await readJsonObject(path.join(assistantDir, ASSISTANT_META_FILE))
  const candidates = [
    typeof meta?.ruleFile === 'string' ? meta.ruleFile : '',
    `${assistantName}.md`,
    ...ASSISTANT_RULE_FILES,
  ].filter(candidate => candidate && path.basename(candidate) === candidate)

  for (const candidate of candidates) {
    const fullPath = path.join(assistantDir, candidate)
    if (!candidate.toLowerCase().endsWith('.md') || !(await isFile(fullPath))) {
      continue
    }
    const content = (await readFile(fullPath, 'utf8')).trim()
    if (content) return content
  }
  return null
}

export async function getLocalInstalledSkills(): Promise<LocalInstalledSkill[]> {
  let entries
  try {
    entries = await readdir(SKILLS_DIR, { withFileTypes: true })
  } catch {
    return []
  }

  const skills = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(async entry => {
        const skillDir = path.join(SKILLS_DIR, entry.name)
        const [meta, markdown] = await Promise.all([
          readJsonObject(path.join(skillDir, SKILL_META_FILE)),
          readFile(path.join(skillDir, 'SKILL.md'), 'utf8').catch(() => ''),
        ])
        if (!meta && !markdown) return null
        const frontmatter = markdown ? parseFrontmatter(markdown).frontmatter : {}
        return {
          name: typeof meta?.name === 'string' ? meta.name : entry.name,
          displayName:
            (typeof meta?.display_name === 'string' && meta.display_name) ||
            (typeof frontmatter.name === 'string' && frontmatter.name) ||
            entry.name,
          description:
            (typeof meta?.description === 'string' && meta.description) ||
            (typeof frontmatter.description === 'string' && frontmatter.description) ||
            '',
          enabled: meta?.enabled !== false,
        } satisfies LocalInstalledSkill
      }),
  )
  return skills.filter((skill): skill is LocalInstalledSkill => skill !== null)
}
