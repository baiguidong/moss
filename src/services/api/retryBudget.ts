export type RetryBudgetSnapshot = { attempts: number; maxAttempts: number; waitedMs: number; maxWaitMs: number; remainingWaitMs: number }

export class RetryBudgetExceededError extends Error {
  constructor(public readonly reason: 'attempts' | 'wait', public readonly budget: RetryBudgetSnapshot) {
    super(`模型请求重试已停止：${reason === 'attempts' ? '达到尝试次数上限' : '剩余等待额度不足'}。已尝试 ${budget.attempts}/${budget.maxAttempts} 次，累计等待 ${(budget.waitedMs / 1000).toFixed(1)} 秒，上限 ${budget.maxWaitMs / 1000} 秒。`)
    this.name = 'RetryBudgetExceededError'
  }
}

/** Owned by one logical model request, shared with its compatibility fallbacks. */
export class RetryBudget {
  private attempts = 0
  private waitedMs = 0
  readonly maxWaitMs: number
  readonly maxAttempts: number
  constructor(options: { unattended?: boolean; maxWaitMs?: number; maxAttempts?: number } = {}, readonly now = () => performance.now()) {
    this.maxWaitMs = options.maxWaitMs ?? (options.unattended ? 600_000 : 120_000)
    this.maxAttempts = options.maxAttempts ?? (options.unattended ? 20 : 12)
    if (!Number.isFinite(this.maxWaitMs) || this.maxWaitMs < 0 || !Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1) throw new Error('Invalid retry budget')
  }
  snapshot(): RetryBudgetSnapshot {
    return { attempts: this.attempts, maxAttempts: this.maxAttempts, waitedMs: Math.ceil(this.waitedMs), maxWaitMs: this.maxWaitMs, remainingWaitMs: Math.max(0, this.maxWaitMs - this.waitedMs) }
  }
  acquireAttempt() {
    if (this.attempts >= this.maxAttempts) throw new RetryBudgetExceededError('attempts', this.snapshot())
    if (this.waitedMs > this.maxWaitMs) throw new RetryBudgetExceededError('wait', this.snapshot())
    return ++this.attempts
  }
  checkWait(delayMs: number) {
    if (this.attempts >= this.maxAttempts) throw new RetryBudgetExceededError('attempts', this.snapshot())
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > this.maxWaitMs - this.waitedMs) throw new RetryBudgetExceededError('wait', this.snapshot())
  }
  recordWait(startedAt: number) { this.waitedMs += Math.max(0, this.now() - startedAt) }
}
