export type Input = Record<string, unknown>

export class FileReadTool {
  name = 'file_read'
}

export class MaxFileReadTokenExceededError extends Error {
  constructor() {
    super('Max file read token exceeded')
  }
}

export function readImageWithTokenBudget(): Promise<unknown> {
  return Promise.resolve(null)
}