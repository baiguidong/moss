export function getRecordFilePath(): string | null {
  return null
}

export function _resetRecordingStateForTesting(): void {}

export function getSessionRecordingPaths(): string[] {
  return []
}

export async function renameRecordingForSession(): Promise<void> {}

export async function flushAsciicastRecorder(): Promise<void> {}

export function installAsciicastRecorder(): void {}
