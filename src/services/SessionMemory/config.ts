import { getSessionMemorySettings } from '../sessionMemorySettings.js'

export function isSessionMemoryEnabled(): boolean {
  return getSessionMemorySettings().enabled
}
