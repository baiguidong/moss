import isEqual from 'lodash-es/isEqual.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logError } from '../../utils/log.js'
import { createSignal } from '../../utils/signal.js'

type FeatureFlagRefreshListener = () => void | Promise<void>

const refreshed = createSignal()

let envOverrides: Record<string, unknown> | null = null
let envOverridesParsed = false

function callSafe(listener: FeatureFlagRefreshListener): void {
  try {
    const result = listener()
    if (result && typeof result.then === 'function') {
      void result.catch(error => logError(error))
    }
  } catch (error) {
    logError(error)
  }
}

export function onFeatureFlagsRefresh(
  listener: FeatureFlagRefreshListener,
): () => void {
  return refreshed.subscribe(() => callSafe(listener))
}

function parseOverrideObject(raw: string): Record<string, unknown> | null {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  return parsed as Record<string, unknown>
}

function getEnvOverrides(): Record<string, unknown> | null {
  if (!envOverridesParsed) {
    envOverridesParsed = true
    const raw = process.env.MOSS_FEATURE_FLAG_OVERRIDES
    if (raw) {
      try {
        envOverrides = parseOverrideObject(raw)
      } catch (error) {
        logError(error)
      }
    }
  }
  return envOverrides
}

function getConfigOverrides(): Record<string, unknown> | undefined {
  try {
    return getGlobalConfig().featureFlagOverrides
  } catch {
    return undefined
  }
}

function getLocalFeatureValue<T>(feature: string, defaultValue: T): T {
  const env = getEnvOverrides()
  if (env && feature in env) {
    return env[feature] as T
  }

  const config = getConfigOverrides()
  if (config && feature in config) {
    return config[feature] as T
  }

  return defaultValue
}

export function hasFeatureFlagEnvOverride(feature: string): boolean {
  const overrides = getEnvOverrides()
  return overrides !== null && feature in overrides
}

export function getAllFeatureFlags(): Record<string, unknown> {
  return {
    ...(getConfigOverrides() ?? {}),
    ...(getEnvOverrides() ?? {}),
  }
}

export function getFeatureFlagConfigOverrides(): Record<string, unknown> {
  return getConfigOverrides() ?? {}
}

export function setFeatureFlagConfigOverride(
  feature: string,
  value: unknown,
): void {
  try {
    saveGlobalConfig(config => {
      const current = config.featureFlagOverrides ?? {}
      if (value === undefined) {
        if (!(feature in current)) return config
        const { [feature]: _removed, ...rest } = current
        if (Object.keys(rest).length === 0) {
          const { featureFlagOverrides: _overrides, ...withoutOverrides } = config
          return withoutOverrides
        }
        return { ...config, featureFlagOverrides: rest }
      }

      if (isEqual(current[feature], value)) return config
      return {
        ...config,
        featureFlagOverrides: { ...current, [feature]: value },
      }
    })
    refreshed.emit()
  } catch (error) {
    logError(error)
  }
}

export function clearFeatureFlagConfigOverrides(): void {
  try {
    saveGlobalConfig(config => {
      if (
        !config.featureFlagOverrides ||
        Object.keys(config.featureFlagOverrides).length === 0
      ) {
        return config
      }
      const { featureFlagOverrides: _overrides, ...withoutOverrides } = config
      return withoutOverrides
    })
    refreshed.emit()
  } catch (error) {
    logError(error)
  }
}

export async function initializeFeatureFlags(): Promise<null> {
  return null
}

export async function getFeatureValue_DEPRECATED<T>(
  feature: string,
  defaultValue: T,
): Promise<T> {
  return getLocalFeatureValue(feature, defaultValue)
}

export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  feature: string,
  defaultValue: T,
): T {
  return getLocalFeatureValue(feature, defaultValue)
}

export function getFeatureValue_CACHED_WITH_REFRESH<T>(
  feature: string,
  defaultValue: T,
): T {
  return getLocalFeatureValue(feature, defaultValue)
}

export function checkFeatureGate_CACHED_MAY_BE_STALE(
  gate: string,
): boolean {
  return Boolean(getLocalFeatureValue(gate, false))
}

export async function checkSecurityRestrictionGate(
  gate: string,
): Promise<boolean> {
  return Boolean(getLocalFeatureValue(gate, false))
}

export async function checkGate_CACHED_OR_BLOCKING(
  gate: string,
): Promise<boolean> {
  return Boolean(getLocalFeatureValue(gate, false))
}

export function refreshFeatureFlagsAfterAuthChange(): void {
  return
}

export function resetFeatureFlags(): void {
  return
}

export async function refreshFeatureFlags(): Promise<void> {
  return
}

export function setupPeriodicFeatureFlagRefresh(): void {
  return
}

export function stopPeriodicFeatureFlagRefresh(): void {
  return
}

export async function getDynamicConfig_BLOCKS_ON_INIT<T>(
  configName: string,
  defaultValue: T,
): Promise<T> {
  return getLocalFeatureValue(configName, defaultValue)
}

export function getDynamicConfig_CACHED_MAY_BE_STALE<T>(
  configName: string,
  defaultValue: T,
): T {
  return getLocalFeatureValue(configName, defaultValue)
}
