export function getSessionMemoryContent(): string {
  return ''
}

export function setLastSummarizedMessageId(): void {}

export function trySessionMemoryCompaction(): Promise<void> {
  return Promise.resolve()
}

export function getLastSummarizedMessageId(): string | null {
  return null
}

export function waitForSessionMemoryExtraction(): Promise<void> {
  return Promise.resolve()
}