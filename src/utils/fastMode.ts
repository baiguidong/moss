import type { ModelSetting } from './model/model.js'

export const FAST_MODE_MODEL_DISPLAY = 'Opus 4.6'

export function isFastModeEnabled(): boolean {
  return false
}

export function isFastModeAvailable(): boolean {
  return false
}

export function getFastModeModel(): string {
  return 'opus'
}

export function getInitialFastModeSetting(_model: ModelSetting): boolean {
  return false
}

export function isFastModeSupportedByModel(_modelSetting: ModelSetting): boolean {
  return false
}

export function clearFastModeCooldown(): void {}

export function isFastModeCooldown(): boolean {
  return false
}

export function getFastModeState(
  _model: ModelSetting,
  _fastModeUserEnabled: boolean | undefined,
): 'off' | 'cooldown' | 'on' {
  return 'off'
}
