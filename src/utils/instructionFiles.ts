import { join } from 'path'

// Legacy Claude files load first so AGENTS.md wins when both exist.
export const PROJECT_INSTRUCTION_FILENAMES = ['CLAUDE.md', 'AGENTS.md'] as const
export const LOCAL_INSTRUCTION_FILENAMES = [
  'CLAUDE.local.md',
  'AGENTS.local.md',
] as const

export const PRIMARY_PROJECT_INSTRUCTION_FILENAME = 'AGENTS.md'
export const PRIMARY_LOCAL_INSTRUCTION_FILENAME = 'AGENTS.local.md'

const ALL_INSTRUCTION_FILENAMES = [
  ...PROJECT_INSTRUCTION_FILENAMES,
  ...LOCAL_INSTRUCTION_FILENAMES,
] as const

export function isInstructionFilename(filename: string): boolean {
  return (ALL_INSTRUCTION_FILENAMES as readonly string[]).includes(filename)
}

export function getProjectInstructionFilePaths(directory: string): string[] {
  return PROJECT_INSTRUCTION_FILENAMES.flatMap(filename => [
    join(directory, filename),
    join(directory, '.moss', filename),
  ])
}
