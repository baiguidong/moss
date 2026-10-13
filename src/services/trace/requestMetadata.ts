import { AsyncLocalStorage } from 'node:async_hooks'

const metadata = new AsyncLocalStorage<Record<string, string>>()
export function getTraceRequestMetadata() { return metadata.getStore() ?? {} }

// Async generators resume in the caller's context. Scope every iterator step
// so concurrent sessions and child agents cannot inherit each other's IDs.
export async function* withTraceRequestMetadata<T>(values: Record<string, string>, factory: () => AsyncGenerator<T, any, any>): AsyncGenerator<T> {
  const scope = { ...getTraceRequestMetadata(), ...values }
  const iterator = metadata.run(scope, factory)
  try {
    while (true) {
      const step = await metadata.run(scope, () => iterator.next())
      if (step.done) return
      yield step.value
    }
  } finally {
    await metadata.run(scope, () => iterator.return(undefined))
  }
}
