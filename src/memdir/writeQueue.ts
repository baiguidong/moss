import { getAutoMemPath, isAutoMemPath } from './paths.js'

const autoMemoryWriteQueues = new Map<string, Promise<void>>()

export async function withAutoMemoryWriteLock<T>(
  filePath: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  if (!isAutoMemPath(filePath)) {
    return fn()
  }

  const key = getAutoMemPath()
  const previous = autoMemoryWriteQueues.get(key) ?? Promise.resolve()
  let release: () => void
  const pending = new Promise<void>(resolve => {
    release = resolve
  })
  const current = previous.catch(() => {}).then(() => pending)

  autoMemoryWriteQueues.set(key, current)

  await previous.catch(() => {})
  try {
    return await fn()
  } finally {
    release()
    if (autoMemoryWriteQueues.get(key) === current) {
      autoMemoryWriteQueues.delete(key)
    }
  }
}
