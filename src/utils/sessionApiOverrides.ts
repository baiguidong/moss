import { AsyncLocalStorage } from 'async_hooks'

export type SessionApiOverrides = {
  mossBaseUrl?: string
  mossAuthToken?: string
  mossModel?: string
  mossFastModel?: string
  webSearch?: SessionWebSearchSettings
}

export type SessionModelRole = 'primary' | 'fast'

export type SessionWebSearchSettings = {
  mode: 'auto' | 'tavily' | 'brave' | 'native' | 'disabled'
  tavilyApiKey?: string
  braveApiKey?: string
  nativeCapability?: 'supported' | 'compatible' | 'unsupported' | 'unknown'
}

const sessionApiOverridesStorage = new AsyncLocalStorage<SessionApiOverrides>()

export function getSessionApiOverrides(): SessionApiOverrides | undefined {
  return sessionApiOverridesStorage.getStore()
}

export function getSessionMossBaseUrl(): string | undefined {
  return sessionApiOverridesStorage.getStore()?.mossBaseUrl
}

export function getSessionMossAuthToken(): string | undefined {
  return sessionApiOverridesStorage.getStore()?.mossAuthToken
}

export function getSessionMossModel(): string | undefined {
  return sessionApiOverridesStorage.getStore()?.mossModel
}

export function getSessionMossFastModel(): string | undefined {
  return sessionApiOverridesStorage.getStore()?.mossFastModel
}

export function getSessionWebSearchSettings(): SessionWebSearchSettings | undefined {
  return sessionApiOverridesStorage.getStore()?.webSearch
}

export function resolveSessionMossModel(
  model: string,
  modelRole: SessionModelRole = 'primary',
): string {
  const overrides = sessionApiOverridesStorage.getStore()
  if (!overrides) return model
  if (modelRole === 'fast') {
    return overrides.mossFastModel || overrides.mossModel || model
  }
  return overrides.mossModel || model
}

export function applySessionMossModel<
  T extends {
    model: string
    modelRole?: SessionModelRole
    fallbackModel?: string
    advisorModel?: string
  },
>(options: T): T {
  const configuredModel = options.modelRole === 'fast'
    ? getSessionMossFastModel() || getSessionMossModel()
    : getSessionMossModel()
  if (!configuredModel) return options
  if (
    options.model === configuredModel &&
    options.fallbackModel === undefined &&
    options.advisorModel === undefined
  ) return options
  return {
    ...options,
    model: configuredModel,
    fallbackModel: undefined,
    advisorModel: undefined,
  }
}

export function runWithSessionApiOverrides<T>(
  overrides: SessionApiOverrides | undefined,
  fn: () => T,
): T {
  if (!overrides) return fn()
  return sessionApiOverridesStorage.run(overrides, fn)
}

function runWithExistingSessionApiOverrides<T>(
  overrides: SessionApiOverrides | undefined,
  fn: () => T,
): T {
  if (!overrides) return fn()
  return sessionApiOverridesStorage.run(overrides, fn)
}

export async function* runWithSessionApiOverridesGenerator<
  T,
  TReturn = void,
>(
  overrides: SessionApiOverrides | undefined,
  fn: () => AsyncGenerator<T, TReturn, unknown>,
): AsyncGenerator<T, TReturn, unknown> {
  const iterator = runWithExistingSessionApiOverrides(overrides, fn)

  try {
    while (true) {
      const result = await runWithExistingSessionApiOverrides(overrides, () =>
        iterator.next(),
      )
      if (result.done) {
        return result.value
      }
      yield result.value
    }
  } finally {
    if (typeof iterator.return === 'function') {
      await runWithExistingSessionApiOverrides(overrides, () =>
        iterator.return!(),
      )
    }
  }
}
