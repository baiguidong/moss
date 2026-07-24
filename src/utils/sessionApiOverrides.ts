import { AsyncLocalStorage } from 'async_hooks'

export type SessionApiOverrides = {
  anthropicBaseUrl?: string
  anthropicAuthToken?: string
}

const sessionApiOverridesStorage = new AsyncLocalStorage<SessionApiOverrides>()

export function getSessionApiOverrides(): SessionApiOverrides | undefined {
  return sessionApiOverridesStorage.getStore()
}

export function getSessionAnthropicBaseUrl(): string | undefined {
  return sessionApiOverridesStorage.getStore()?.anthropicBaseUrl
}

export function getSessionAnthropicAuthToken(): string | undefined {
  return sessionApiOverridesStorage.getStore()?.anthropicAuthToken
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
