/** Small FIFO semaphore used to keep a hook event from spawning unbounded work. */
export class HookConcurrencyLimiter {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(public readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('Hook concurrency limit must be a positive integer')
    }
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++
      return this.release.bind(this)
    }
    await new Promise<void>(resolve => this.waiters.push(resolve))
    this.active++
    return this.release.bind(this)
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1)
    this.waiters.shift()?.()
  }

  get activeCount(): number {
    return this.active
  }

  get queuedCount(): number {
    return this.waiters.length
  }
}

export function getHookConcurrencyLimit(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number(env.MOSS_HOOK_MAX_CONCURRENT)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 16
}

export async function withHookConcurrency<T>(
  limiter: HookConcurrencyLimiter,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await limiter.acquire()
  try {
    return await operation()
  } finally {
    release()
  }
}
