import { AbortError } from '../../utils/errors.js'

// Cleanup may outlive the terminal task entry. Track it by workspace so a
// resume cannot enter a directory which that cleanup is about to remove.
const pending = new Map<string, Promise<unknown>>()

export async function runAgentWorktreeCleanup<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const work = Promise.resolve().then(operation)
  pending.set(path, work)
  try { return await work }
  finally { if (pending.get(path) === work) pending.delete(path) }
}

export async function waitForAgentWorktreeCleanup(path: string | undefined, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) throw new AbortError()
  const work = path ? pending.get(path) : undefined
  if (!work) return false
  let onAbort!: () => void
  try {
    await Promise.race([
      // A failed cleanup preserves the directory. Resume re-reads metadata
      // and checks the path after the cleanup has stopped touching it.
      work.catch(() => {}),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new AbortError())
        signal.addEventListener('abort', onAbort, { once: true })
      }),
    ])
    if (signal.aborted) throw new AbortError()
    return true
  } finally { signal.removeEventListener('abort', onAbort) }
}
