export function builtInCommandNames(): Set<string> {
  return new Set<string>()
}

export type Command = Record<string, unknown>
export type PromptCommand = Record<string, unknown>

export function getCommands(): Command[] {
  return []
}

export function getCommandName(_command: Command): string {
  return ''
}

export function isCommandEnabled(_command: Command): boolean {
  return false
}

export function getSkillToolCommands(): unknown[] {
  return []
}

export function getMcpSkillCommands(): unknown[] {
  return []
}

export function splitCommand_DEPRECATED(_input: string): { command: string; args: string } {
  return { command: '', args: '' }
}

export function clearCommandsCache(): void {}