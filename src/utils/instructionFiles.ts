export const PROJECT_INSTRUCTION_FILENAMES = ['MOSS.md'] as const
export const LOCAL_INSTRUCTION_FILENAMES = ['MOSS.local.md'] as const

export const PRIMARY_PROJECT_INSTRUCTION_FILENAME = 'MOSS.md'
export const PRIMARY_LOCAL_INSTRUCTION_FILENAME = 'MOSS.local.md'

const ALL_INSTRUCTION_FILENAMES = [
  ...PROJECT_INSTRUCTION_FILENAMES,
  ...LOCAL_INSTRUCTION_FILENAMES,
] as const

export function isInstructionFilename(filename: string): boolean {
  return (ALL_INSTRUCTION_FILENAMES as readonly string[]).includes(filename)
}
