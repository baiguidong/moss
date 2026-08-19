import { homedir } from 'os'
import { join } from 'path'

export function getMossConfigHomeDir(): string {
  return (process.env.MOSS_CONFIG_DIR || join(homedir(), '.moss')).normalize('NFC')
}

export const MOSS_HOME = process.env.MOSS_HOME || join(homedir(), '.moss')
export const MOSS_SKILLS_DIR = join(MOSS_HOME, 'skills')
export const SKILL_HUB_META_FILE = '_moss_meta.json'
export const MANAGED_SKILL_SEARCH_DIRS = [MOSS_SKILLS_DIR] as const
