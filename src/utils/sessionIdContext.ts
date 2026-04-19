import { AsyncLocalStorage } from 'async_hooks'
import type { SessionId } from '../types/ids.js'

type SessionIdContext = {
  sessionId: SessionId
}

const sessionIdStorage = new AsyncLocalStorage<SessionIdContext>()

export function getSessionIdContext(): SessionId | undefined {
  return sessionIdStorage.getStore()?.sessionId
}

export function runWithSessionIdContext<T>(
  sessionId: SessionId,
  fn: () => T,
): T {
  return sessionIdStorage.run({ sessionId }, fn)
}

function runWithExistingSessionIdContext<T>(
  context: SessionIdContext,
  fn: () => T,
): T {
  return sessionIdStorage.run(context, fn)
}

export async function* runWithSessionIdContextGenerator<T, TReturn = void>(
  sessionId: SessionId,
  fn: () => AsyncGenerator<T, TReturn, unknown>,
): AsyncGenerator<T, TReturn, unknown> {
  const context: SessionIdContext = { sessionId }
  const iterator = runWithExistingSessionIdContext(context, fn)

  try {
    while (true) {
      const result = await runWithExistingSessionIdContext(context, () =>
        iterator.next(),
      )
      if (result.done) {
        return result.value
      }
      yield result.value
    }
  } finally {
    if (typeof iterator.return === 'function') {
      await runWithExistingSessionIdContext(context, () => iterator.return!())
    }
  }
}
