import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'

function normalizePath(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '~') {
    return homedir().normalize('NFC')
  }
  if (trimmed.startsWith('~/')) {
    return join(homedir(), trimmed.slice(2)).normalize('NFC')
  }
  return (isAbsolute(trimmed) ? trimmed : resolve(trimmed)).normalize('NFC')
}

export function getMossServerHomeDir(): string {
  const configured = process.env.MOSS_SERVER_HOME?.trim()
  if (configured) {
    return normalizePath(configured)
  }
  return normalizePath(join(homedir(), '.moss', 'server'))
}

export function getMossConfigHomeDir(): string {
  return getMossServerHomeDir()
}

export const MOSS_SERVER_HOME = getMossServerHomeDir()
export const MOSS_HOME = MOSS_SERVER_HOME
export const MOSS_SKILLS_DIR = join(MOSS_HOME, 'skills')
export const SKILL_HUB_META_FILE = '_moss_meta.json'
export const MANAGED_SKILL_SEARCH_DIRS = [MOSS_SKILLS_DIR] as const
