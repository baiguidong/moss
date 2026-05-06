export function initSessionMemory(): void {}
export function getSessionMemoryContent(): string {
  return ''
}
export function setLastSummarizedMessageId(): void {}
export function trySessionMemoryCompaction(): Promise<void> {
  return Promise.resolve()
}