import { getSessionMemorySettings } from '../sessionMemorySettings.js'

export function isSessionMemoryEnabled(): boolean {
  return getSessionMemorySettings().enabled
}

export function isSessionMemoryCompactEnabled(): boolean {
  return getSessionMemorySettings().compactEnabled
}
