export function createTaskStateBase(): Record<string, unknown> {
  return {}
}

export function generateTaskId(): string {
  return ''
}

export type TaskType = string
export type TaskStatus = string

export function isTerminalTaskStatus(_status: string): boolean {
  return false
}