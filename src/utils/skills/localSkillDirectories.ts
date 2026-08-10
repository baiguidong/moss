import os from 'os'
import path from 'path'

// Support MOSS_HOME environment variable for Docker/container environments
export const MOSS_HOME = process.env.MOSS_HOME || path.join(os.homedir(), '.moss')
export const MOSS_SKILLS_DIR = path.join(MOSS_HOME, 'skills')
export const SKILL_HUB_META_FILE = '_moss_meta.json'

export const MANAGED_SKILL_SEARCH_DIRS = [
  MOSS_SKILLS_DIR,
] as const
