import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import os from 'os'
import path from 'path'
import {
  MOSS_HOME,
  MOSS_SKILLS_HUB_DIR,
  MOSS_SKILLS_SYSTEM_DIR,
  MOSS_SKILLS_CUSTOM_DIR,
  USER_SKILLS_DIR,
  SKILL_HUB_META_FILE,
} from './skills/localSkillDirectories.js'
import {
  ASSISTANT_HUB_DIR,
  ASSISTANT_SYSTEM_DIR,
  ASSISTANT_SEARCH_DIRS,
  ASSISTANT_META_FILE,
} from '../server/agentStore.js'

function getNexusSudocodeDir(configDir?: string): string {
  if (configDir) {
    return path.join(configDir, '.nexus', 'sudocode')
  }
  const home = os.homedir()
  return path.join(home, '.nexus', 'sudocode')
}

function getSkillBridgeDir(configDir?: string): string {
  return path.join(getNexusSudocodeDir(configDir), 'skills')
}

function getAgentBridgeDir(configDir?: string): string {
  return path.join(getNexusSudocodeDir(configDir), 'agents')
}

function getInstructionsPath(configDir?: string): string {
  return path.join(getNexusSudocodeDir(configDir), 'instructions.md')
}

function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true })
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    const content = readFileSync(filePath, 'utf8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

function isSkillEnabled(skillDir: string): boolean {
  const metaPath = path.join(skillDir, SKILL_HUB_META_FILE)
  const meta = readJsonFile<Record<string, unknown>>(metaPath)
  if (meta && typeof meta.enabled === 'boolean') {
    return meta.enabled
  }
  return true
}

function getSkillNameAndDescription(skillDir: string): {
  name: string
  description: string
} | null {
  const dirName = path.basename(skillDir)
  const metaPath = path.join(skillDir, SKILL_HUB_META_FILE)
  const meta = readJsonFile<Record<string, unknown>>(metaPath)

  if (meta) {
    const name =
      (typeof meta.display_name === 'string' && meta.display_name.trim()) ||
      (typeof meta.name === 'string' && meta.name.trim()) ||
      dirName
    const description =
      typeof meta.description === 'string' ? meta.description : ''
    return { name, description }
  }

  try {
    const skillMdPath = path.join(skillDir, 'SKILL.md')
    const content = readFileSync(skillMdPath, 'utf8')
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1]
      let name = dirName
      let description = ''
      for (const line of frontmatter.split('\n')) {
        const colonIdx = line.indexOf(':')
        if (colonIdx === -1) continue
        const key = line.slice(0, colonIdx).trim()
        let value = line.slice(colonIdx + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        if (key === 'name' || key === 'displayName') {
          name = value || name
        }
        if (key === 'description') {
          description = value
        }
      }
      return { name, description }
    }
  } catch {
    // SKILL.md not readable
  }

  return { name: dirName, description: '' }
}

function isAssistantEnabled(assistantDir: string): boolean {
  const metaPath = path.join(assistantDir, ASSISTANT_META_FILE)
  const meta = readJsonFile<Record<string, unknown>>(metaPath)
  if (meta && typeof meta.enabled === 'boolean') {
    return meta.enabled
  }
  return true
}

function getAssistantRuleFileContent(assistantDir: string): string | null {
  const COMMON_RULE_FILES = [
    'system.md',
    'prompt.md',
    'assistant.md',
    'instructions.md',
    'rules.md',
  ]
  const dirName = path.basename(assistantDir)
  const metaPath = path.join(assistantDir, ASSISTANT_META_FILE)
  const meta = readJsonFile<Record<string, unknown>>(metaPath)

  const candidateFiles: string[] = []
  if (meta && typeof meta.ruleFile === 'string' && meta.ruleFile.trim()) {
    const normalized = meta.ruleFile.replace(/\\/g, '/').replace(/^\.\/+/, '')
    if (normalized && !normalized.startsWith('/') && !normalized.startsWith('..')) {
      candidateFiles.push(normalized)
    }
  }
  candidateFiles.push(`${dirName}.md`)
  candidateFiles.push(...COMMON_RULE_FILES)

  for (const candidate of candidateFiles) {
    if (!candidate.toLowerCase().endsWith('.md')) continue
    const fullPath = path.resolve(assistantDir, candidate)
    try {
      const stat = lstatSync(fullPath)
      if (stat.isFile()) {
        return readFileSync(fullPath, 'utf8').trim() || null
      }
    } catch {
      // continue
    }
  }

  try {
    const entries = readdirSync(assistantDir, { withFileTypes: true })
    const mdFiles = entries
      .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .filter(
        e =>
          !/^readme/i.test(e.name) &&
          !/^changelog/i.test(e.name) &&
          !/^license/i.test(e.name) &&
          !/^contributing/i.test(e.name),
      )
    if (mdFiles.length === 1) {
      return readFileSync(path.join(assistantDir, mdFiles[0]!.name), 'utf8').trim() || null
    }
  } catch {
    // ignore
  }

  return null
}

function getAssistantNameAndDescription(assistantDir: string): {
  name: string
  displayName: string
  description: string
} | null {
  const dirName = path.basename(assistantDir)
  const metaPath = path.join(assistantDir, ASSISTANT_META_FILE)
  const meta = readJsonFile<Record<string, unknown>>(metaPath)

  if (meta) {
    const name =
      (typeof meta.name === 'string' && meta.name.trim()) || dirName
    const displayName =
      (typeof meta.display_name === 'string' && meta.display_name.trim()) ||
      (typeof meta.name === 'string' && meta.name.trim()) ||
      dirName
    const description =
      typeof meta.description === 'string' ? meta.description : ''
    return { name, displayName, description }
  }

  return { name: dirName, displayName: dirName, description: '' }
}

function getEnabledAssistantName(): string | null {
  return process.env.MOSS_ASSISTANT_NAME?.trim() || null
}

const SKILL_SEARCH_DIRS = [
  MOSS_SKILLS_HUB_DIR,
  MOSS_SKILLS_SYSTEM_DIR,
  MOSS_SKILLS_CUSTOM_DIR,
  USER_SKILLS_DIR,
]

export function bridgeSkill(
  skillName: string,
  sourcePath: string,
  configDir?: string,
): void {
  const bridgeDir = getSkillBridgeDir(configDir)
  ensureDir(bridgeDir)
  const linkPath = path.join(bridgeDir, skillName)

  if (existsSync(linkPath)) {
    try {
      const stat = lstatSync(linkPath)
      if (stat.isSymbolicLink()) {
        const realTarget = readlinkSync(linkPath)
        const resolvedTarget = path.resolve(
          path.dirname(linkPath),
          realTarget,
        )
        if (resolvedTarget === path.resolve(sourcePath)) {
          return
        }
        // Target changed, remove old symlink and continue
        unlinkSync(linkPath)
      } else {
        // Real file/dir exists, don't overwrite
        console.warn(
          `[scodeBridge] Skipping skill bridge for "${skillName}": real file exists at ${linkPath}`,
        )
        return
      }
    } catch {
      // Fall through to recreate
    }
    try {
      unlinkSync(linkPath)
    } catch {
      rmSync(linkPath, { recursive: true, force: true })
    }
  }

  symlinkSync(sourcePath, linkPath)
}



export function unbridgeSkill(skillName: string, configDir?: string): void {
  const bridgeDir = getSkillBridgeDir(configDir)
  const linkPath = path.join(bridgeDir, skillName)

  if (!existsSync(linkPath)) return

  try {
    const stat = lstatSync(linkPath)
    if (stat.isSymbolicLink()) {
      unlinkSync(linkPath)
    }
  } catch {
    // Not a symlink or doesn't exist, ignore
  }
}

export function bridgeAgent(
  assistantName: string,
  sourcePath: string,
  configDir?: string,
): void {
  const bridgeDir = getAgentBridgeDir(configDir)
  ensureDir(bridgeDir)

  const info = getAssistantNameAndDescription(sourcePath)
  const displayName = info?.displayName || assistantName
  const description = info?.description || ''

  const tomlContent = [
    `name = "${assistantName}"`,
    `description = "Moss Agent: ${displayName}${description ? ' - ' + description : ''}"`,
    `model = ""`,
    `model_reasoning_effort = ""`,
  ].join('\n')

  const tomlPath = path.join(bridgeDir, `${assistantName}.toml`)
  writeFileSync(tomlPath, tomlContent, 'utf8')
}

export function unbridgeAgent(assistantName: string, configDir?: string): void {
  const bridgeDir = getAgentBridgeDir(configDir)
  const tomlPath = path.join(bridgeDir, `${assistantName}.toml`)

  try {
    if (existsSync(tomlPath)) {
      unlinkSync(tomlPath)
    }
  } catch {
    // Ignore errors
  }
}

export async function refreshInstructionsFile(configDir?: string): Promise<void> {
  const {
    getInstalledSkills,
  } = await import('../server/skillStore.js')
  const {
    getAssistantSystemPrompt,
    getInstalledAssistants,
  } = await import('../server/agentStore.js')

  const installedSkills = await getInstalledSkills()
  const enabledSkills = installedSkills.filter(s => s.enabled)

  const installedAssistants = await getInstalledAssistants()
  const enabledAssistants = installedAssistants.filter(a => a.enabled)

  const lines: string[] = []

  if (enabledAssistants.length > 0) {
    lines.push('# Moss 已安装 Agent')
    lines.push(
      `调用方式：使用 Agent 工具，在 subagent_type 参数中指定标识符。需复杂规划、架构设计时主动委托给对应的智能体。`,
    )
    lines.push('')
    const agentItems = enabledAssistants.map(agent => {
      // 截短描述，避免超出 scode 的 4000 字符限制
      let desc = agent.description ? ` — ${agent.description}` : ''
      if (desc.length > 50) desc = desc.substring(0, 47) + '...'
      return `- **${agent.name}**${desc}`
    })
    lines.push(agentItems.join('\n'))
    lines.push('')
  }

  if (enabledSkills.length > 0) {
    lines.push('# Moss 已安装技能')
    lines.push(
      `调用方式：Skill("技能名")。当用户需求匹配时主动调用。使用 Skill 工具或执行 /skills 命令可查详情。`,
    )
    lines.push('')

    // 如果技能非常多，我们可能需要将其整理成更紧凑的列表，甚至只显示名字
    // 由于 scode 限制 instruction files 最大 4000 字符，我们要非常精简
    const skillNames = enabledSkills.map(s => s.name)
    // 每行显示几个技能名称，以逗号分隔，节省行数和字符数
    lines.push('可用技能列表（仅名称）：')
    lines.push(skillNames.join(', '))
    lines.push('')
  }

  const assistantName = getEnabledAssistantName()
  if (assistantName) {
    const prompt = await getAssistantSystemPrompt(assistantName)
    if (prompt) {
      lines.push('# 当前智能体指令')
      lines.push('')
      lines.push(
        `你正在使用 **${assistantName}** 智能体。请遵循以下指令：`,
      )
      lines.push('')
      lines.push(prompt)
      lines.push('')
    }
  }

  const instructionsPath = getInstructionsPath(configDir)
  ensureDir(path.dirname(instructionsPath))

  if (lines.length > 0) {
    writeFileSync(instructionsPath, lines.join('\n'), 'utf8')
  } else {
    try {
      unlinkSync(instructionsPath)
    } catch {
      // File may not exist, that's fine
    }
  }
}

export function syncAllSkillBridges(configDir?: string): void {
  const bridgeDir = getSkillBridgeDir(configDir)
  ensureDir(bridgeDir)

  // Clean up existing symlinks in bridge dir
  try {
    const entries = readdirSync(bridgeDir, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(bridgeDir, entry.name)
      try {
        const stat = lstatSync(entryPath)
        if (stat.isSymbolicLink()) {
          // Check if target still exists
          try {
            const target = readlinkSync(entryPath)
            const resolvedTarget = path.resolve(path.dirname(entryPath), target)
            if (!existsSync(resolvedTarget)) {
              unlinkSync(entryPath)
            }
          } catch {
            unlinkSync(entryPath)
          }
        }
      } catch {
        // Ignore
      }
    }
  } catch {
    // Bridge dir doesn't exist yet, that's fine
  }

  // Create symlinks for all enabled skills from moss skill directories
  for (const baseDir of SKILL_SEARCH_DIRS) {
    try {
      const entries = readdirSync(baseDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const skillDir = path.join(baseDir, entry.name)
        const skillMdPath = path.join(skillDir, 'SKILL.md')
        try {
          lstatSync(skillMdPath)
        } catch {
          continue // No SKILL.md, skip
        }

        if (!isSkillEnabled(skillDir)) continue

        const skillName = entry.name
        try {
          bridgeSkill(skillName, skillDir, configDir)
        } catch (err) {
          console.warn(
            `[scodeBridge] Failed to bridge skill "${skillName}": ${err}`,
          )
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }
}

export function syncAllAgentBridges(configDir?: string): void {
  const bridgeDir = getAgentBridgeDir(configDir)
  ensureDir(bridgeDir)

  // Clean up existing TOML files for agents that no longer exist
  try {
    const entries = readdirSync(bridgeDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.toml')) continue
      const assistantName = entry.name.replace(/\.toml$/, '')
      let found = false
      for (const searchDir of ASSISTANT_SEARCH_DIRS) {
        const candidateDir = path.join(searchDir, assistantName)
        try {
          if (lstatSync(candidateDir).isDirectory()) {
            found = true
            break
          }
        } catch {
          // Continue
        }
      }
      if (!found) {
        try {
          unlinkSync(path.join(bridgeDir, entry.name))
        } catch {
          // Ignore
        }
      }
    }
  } catch {
    // Bridge dir doesn't exist yet
  }

  // Create TOML files for all enabled agents
  for (const searchDir of ASSISTANT_SEARCH_DIRS) {
    try {
      const entries = readdirSync(searchDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue
        const assistantDir = path.join(searchDir, entry.name)
        if (!isAssistantEnabled(assistantDir)) continue

        try {
          bridgeAgent(entry.name, assistantDir, configDir)
        } catch (err) {
          console.warn(
            `[scodeBridge] Failed to bridge agent "${entry.name}": ${err}`,
          )
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }
}

export function syncAllBridges(configDir?: string): void {
  syncAllSkillBridges(configDir)
  syncAllAgentBridges(configDir)
  // refreshInstructionsFile is async, but we need to call it for the initial sync
  // It will be called separately or via the async version below
}

export async function syncAllBridgesAsync(configDir?: string): Promise<void> {
  syncAllSkillBridges(configDir)
  syncAllAgentBridges(configDir)
  await refreshInstructionsFile(configDir)
}
export async function buildDynamicMcpServers(): Promise<any[]> {
  const { getInstalledSkills } = await import('../server/skillStore.js')
  const installedSkills = await getInstalledSkills()
  const enabledSkills = installedSkills.filter(s => s.enabled)
  
  const mcpServers: any[] = []
  
  for (const skill of enabledSkills) {
    const commandPath = skill.source
    mcpServers.push({
      name: skill.name,
      type: "stdio",
      command: commandPath,
      description: skill.description || ''
    })
  }
  
  return mcpServers
}

export async function buildDynamicAgents(): Promise<any[]> {
  const { getInstalledAssistants, getAssistantSystemPrompt } = await import('../server/agentStore.js')
  const installedAssistants = await getInstalledAssistants()
  const enabledAssistants = installedAssistants.filter(a => a.enabled)
  
  const agents: any[] = []
  
  for (const agent of enabledAssistants) {
    const prompt = await getAssistantSystemPrompt(agent.name)
    agents.push({
      name: agent.name,
      displayName: agent.displayName || agent.name,
      description: agent.description || '',
      instructions: prompt || '',
      model: agent.meta?.model || '',
      mcpServers: agent.meta?.enabledSkills || [],
      enabled: true
    })
  }
  
  return agents
}

export async function buildDynamicInstructions(mcpServers: any[], agents: any[], currentAssistantName: string | null): Promise<string> {
  const lines: string[] = []
  
  if (agents.length > 0) {
    lines.push('# Moss 已安装 Agent')
    lines.push('调用方式：使用 Agent 工具，在 subagent_type 参数中指定标识符。需复杂规划、架构设计时主动委托给对应的智能体。\n')
    lines.push(agents.map(a => `- **${a.name}** — ${a.description.substring(0, 50)}`).join('\n'))
    lines.push('')
  }
  
  if (mcpServers.length > 0) {
    lines.push('# Moss 已安装技能')
    lines.push('调用方式：Skill("技能名")。当用户需求匹配时主动调用。使用 Skill 工具或执行 /skills 命令可查详情。\n')
    lines.push('可用技能列表（仅名称）：')
    lines.push(mcpServers.map(s => s.name).join(', '))
    lines.push('')
  }
  
  if (currentAssistantName) {
    const agent = agents.find(a => a.name === currentAssistantName)
    if (agent && agent.instructions) {
      lines.push('# 当前智能体指令\n')
      lines.push(`你正在使用 **${currentAssistantName}** 智能体。请遵循以下指令：\n`)
      lines.push(agent.instructions)
      lines.push('')
    }
  }
  
  const fullText = lines.join('\n')
  return fullText.length > 3900 ? fullText.substring(0, 3900) + '... (truncated)' : fullText
}
