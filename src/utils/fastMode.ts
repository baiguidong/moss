import { createSignal } from './signal.js'
import type { ModelSetting } from './model/model.js'

export const FAST_MODE_MODEL_DISPLAY = 'Opus 4.6'

export type FastModeRuntimeState =
  | { status: 'active' }
  | { status: 'cooldown'; resetAt: number; reason: CooldownReason }

export type CooldownReason = 'rate_limit' | 'overloaded'

export type FastModeDisabledReason =
  | 'free'
  | 'preference'
  | 'extra_usage_disabled'
  | 'network_error'
  | 'unknown'

const cooldownTriggered =
  createSignal<[resetAt: number, reason: CooldownReason]>()
const cooldownExpired = createSignal()
const overageRejection = createSignal<[message: string]>()
const orgFastModeChange = createSignal<[orgEnabled: boolean]>()

export const onCooldownTriggered = cooldownTriggered.subscribe
export const onCooldownExpired = cooldownExpired.subscribe
export const onFastModeOverageRejection = overageRejection.subscribe
export const onOrgFastModeChanged = orgFastModeChange.subscribe

export function isFastModeEnabled(): boolean {
  return false
}

export function isFastModeAvailable(): boolean {
  return false
}

export function getFastModeUnavailableReason(): string | null {
  return 'Fast mode is not available'
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

export function getFastModeRuntimeState(): FastModeRuntimeState {
  return { status: 'active' }
}

export function triggerFastModeCooldown(
  _resetTimestamp: number,
  _reason: CooldownReason,
): void {}

export function clearFastModeCooldown(): void {}

export function handleFastModeRejectedByAPI(): void {}

export function handleFastModeOverageRejection(_reason: string | null): void {}

export function isFastModeCooldown(): boolean {
  return false
}

export function getFastModeState(
  _model: ModelSetting,
  _fastModeUserEnabled: boolean | undefined,
): 'off' | 'cooldown' | 'on' {
  return 'off'
}

export function resolveFastModeStatusFromCache(): void {}

export async function prefetchFastModeStatus(): Promise<void> {}
