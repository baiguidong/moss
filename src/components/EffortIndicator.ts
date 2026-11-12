import {
  EFFORT_HIGH,
  EFFORT_LOW,
  EFFORT_MAX,
  EFFORT_MEDIUM,
} from '../constants/figures.js'
import {
  type EffortLevel,
  type EffortValue,
  getDisplayedEffortLevel,
  modelSupportsEffort,
} from '../utils/effort.js'

/**
 * Build the text for the effort-changed notification, e.g. "◐ 中等强度 · /effort".
 * Returns undefined if the model doesn't support effort.
 */
export function getEffortNotificationText(
  effortValue: EffortValue | undefined,
  model: string,
): string | undefined {
  if (!modelSupportsEffort(model)) return undefined
  const level = getDisplayedEffortLevel(model, effortValue)
  const label = {
    low: '低强度',
    medium: '中等强度',
    high: '高强度',
    max: '最高强度',
    xhigh: '最高强度',
  }[level]
  return `${effortLevelToSymbol(level)} ${label} · /effort`
}

export function effortLevelToSymbol(level: EffortLevel): string {
  switch (level) {
    case 'low':
      return EFFORT_LOW
    case 'medium':
      return EFFORT_MEDIUM
    case 'high':
      return EFFORT_HIGH
    case 'max':
    case 'xhigh':
      return EFFORT_MAX
    default:
      // Defensive: level can originate from remote config. If an unknown
      // value slips through, render the high symbol rather than undefined.
      return EFFORT_HIGH
  }
}
