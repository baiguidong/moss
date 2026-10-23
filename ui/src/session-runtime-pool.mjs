/** Bounds live runtimes, including creation and asynchronous disposal. Histories stay with Main. */
export class SessionRuntimePool {
  constructor({ getPolicy, blocked, persist, dispose, log = () => {}, now = Date.now, pollMs = 100, queueTimeoutMs = 60_000, maxQueued = 32 }) {
    Object.assign(this, { getPolicy, blocked, persist, dispose, log, now, pollMs, queueTimeoutMs, maxQueued });
    this.records = new Set();
    this.activity = new WeakMap();
    this.creating = new Set();
    this.closing = new Map();
    this.pending = new WeakMap();
    this.serial = Promise.resolve();
    this.queued = 0;
    this.stopped = false;
  }
  state(record) {
    let value = this.activity.get(record);
    if (!value) { value = { users: 0, revision: 0, lastUsed: this.now() }; this.activity.set(record, value); }
    return value;
  }
  async use(record, operation) {
    const state = this.state(record);
    state.users++;
    state.revision++;
    try {
      await this.closing.get(record);
      if (this.stopped || record.deleted) throw new Error('会话已停止。');
      return await operation();
    } finally { state.users--; state.lastUsed = this.now(); }
  }
  reason(record) {
    if (this.state(record).users || this.creating.has(record) || this.closing.has(record)) return 'in-use';
    return this.blocked(record);
  }
  prune() {
    for (const record of this.records) {
      if (!record.runtime && !this.creating.has(record) && !this.closing.has(record)) this.records.delete(record);
    }
    if (!this.records.size) { clearInterval(this.timer); this.timer = null; }
  }
  stats() {
    this.prune();
    return { runtimes: this.records.size, starting: this.creating.size, closing: this.closing.size, queued: this.queued };
  }
  trackDisposal(record, promise) {
    this.records.add(record);
    const pending = Promise.resolve(promise).finally(() => {
      if (this.closing.get(record) === pending) this.closing.delete(record);
      this.prune();
    });
    this.closing.set(record, pending);
    void pending.catch(() => {});
    return pending;
  }
  async retire(record) {
    if (!record.runtime || this.reason(record)) return false;
    const runtime = record.runtime;
    const revision = this.state(record).revision;
    // A new request may arrive while persistence awaits disk; recheck before disposal.
    await this.persist(record);
    if (runtime !== record.runtime || revision !== this.state(record).revision || this.reason(record)) return false;
    await this.dispose(record);
    this.prune();
    this.log('retired', record);
    return true;
  }
  candidates(exclude) {
    this.prune();
    return [...this.records].filter(record => record !== exclude && record.runtime && !this.reason(record))
      .sort((a, b) => this.state(a).lastUsed - this.state(b).lastUsed);
  }
  ensure(record, create) {
    const existing = this.pending.get(record);
    if (existing) return existing.then(() => this.ensure(record, create));
    if (this.stopped) return Promise.reject(new Error('Moss 正在退出。'));
    this.start();
    // Existing runtimes need no capacity reservation. Main's factory handles mode changes.
    if (record.runtime && !this.closing.has(record)) {
      this.records.add(record); this.creating.add(record);
      this.start();
      const operation = this.use(record, create).then(async result => {
        if (this.stopped || record.deleted) { await this.dispose(record); throw new Error('会话已停止。'); }
        return result;
      }).finally(() => {
        this.creating.delete(record);
        if (this.pending.get(record) === operation) this.pending.delete(record);
        this.prune();
      });
      this.pending.set(record, operation);
      return operation;
    }
    if (this.queued >= this.maxQueued) return Promise.reject(new Error('会话启动队列已满，请等待正在执行的任务完成。'));
    const deadline = this.now() + this.queueTimeoutMs;
    this.queued++;
    let expired = false;
    let timeoutHandle;
    const timeoutError = new Error('等待会话运行时超时，现有会话正在工作或已达到设置上限，请稍后重试。');
    const timeout = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => { expired = true; reject(timeoutError); }, this.queueTimeoutMs);
    });
    // The caller's deadline also covers serial predecessors and slow disposal.
    // Keep the actual work serialized after a timeout; it must never create a
    // runtime later for a request whose caller has already stopped waiting.
    const execution = this.serial.then(async () => {
      if (expired) throw timeoutError;
      await this.closing.get(record);
      if (expired) throw timeoutError;
      while (!record.runtime && this.stats().runtimes >= this.getPolicy().maxSessionRuntimes) {
        if (this.stopped || record.deleted) throw new Error('会话已停止。');
        if (expired || this.now() >= deadline) throw new Error('会话运行时已达到设置上限，现有会话正在工作或保留服务状态。请稍后重试、停用不使用的服务，或提高运行时数量上限。');
        let retired = false;
        for (const candidate of this.candidates(record)) {
          try { if (await this.retire(candidate)) { retired = true; break; } }
          catch (error) { this.log('persist-failed', candidate, error); }
        }
        if (!retired) await new Promise(resolve => setTimeout(resolve, this.pollMs));
      }
      if (this.stopped || record.deleted) throw new Error('会话已停止。');
      if (expired || this.now() >= deadline) throw timeoutError;
      clearTimeout(timeoutHandle);
      this.records.add(record); this.creating.add(record);
      this.start();
      try {
        const result = await this.use(record, create);
        if (this.stopped || record.deleted) { await this.dispose(record); throw new Error('会话已停止。'); }
        return result;
      }
      finally { this.creating.delete(record); this.prune(); }
    });
    const operation = Promise.race([execution, timeout]).finally(() => {
      clearTimeout(timeoutHandle);
      this.queued--;
      if (this.pending.get(record) === operation) this.pending.delete(record);
    });
    this.pending.set(record, operation);
    this.serial = execution.catch(() => {});
    return operation;
  }
  sweep() {
    if (this.stopped || this.sweeping) return this.sweeping || Promise.resolve();
    this.sweeping = this.serial.then(async () => {
      if (this.stopped) return;
      for (const record of this.candidates()) {
        const { sessionIdleMinutes, maxSessionRuntimes } = this.getPolicy();
        if (this.now() - this.state(record).lastUsed < sessionIdleMinutes * 60_000 && this.stats().runtimes <= maxSessionRuntimes) continue;
        try { await this.retire(record); } catch (error) { this.log('persist-failed', record, error); }
      }
    }).finally(() => { this.sweeping = null; });
    this.serial = this.sweeping.catch(() => {});
    return this.sweeping;
  }
  start(intervalMs = 30_000) {
    this.timer ??= setInterval(() => { void this.sweep().catch(error => this.log('sweep-failed', null, error)); }, intervalMs);
    this.timer.unref?.();
  }
  stop() { this.stopped = true; clearInterval(this.timer); }
}
