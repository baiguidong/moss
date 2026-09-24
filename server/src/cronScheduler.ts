import { randomUUID } from 'node:crypto'
import { CronRepository, type CloudCronTask, type CronOwner } from './model/repositories/cron.js'
import type { RuntimeService } from './runtimeService.js'
import { runCronPrompt } from './cronRunner.js'

export class CloudCronScheduler {
  readonly hostId = randomUUID()
  private timer?: ReturnType<typeof setInterval>
  private ticking = false
  private stopped = false
  private readonly active = new Map<string, { controller: AbortController; done: Promise<void> }>()
  constructor(
    readonly repo: CronRepository,
    private readonly runtime: RuntimeService,
    private readonly authorize: (owner: CronOwner) => Promise<void>,
    private readonly log: (message: string) => void,
    private readonly now = Date.now,
    private readonly run = runCronPrompt,
  ) {}
  start(): void {
    if (this.timer) return
    this.stopped = false
    const tick = () => { void this.tick().catch(error => this.log(String(error))) }
    this.timer = setInterval(tick, 20000)
    this.timer.unref?.()
    tick()
  }
  async stop(): Promise<void> {
    this.stopped = true
    clearInterval(this.timer); this.timer = undefined
    for (const value of this.active.values()) value.controller.abort(new Error('服务端停止，执行结果未确认。'))
    await this.waitForIdle()
  }
  async waitForIdle(): Promise<void> { await Promise.allSettled([...this.active.values()].map(value => value.done)) }
  async tick(): Promise<void> {
    if (this.stopped || this.ticking) return
    this.ticking = true
    try {
      await this.repo.renew(this.hostId, this.now(), [...this.active.keys()])
      await this.repo.recover(this.now())
      for (const current of await this.repo.due(this.now())) {
        if (this.stopped) break
        await this.launch(current.id, current, false)
      }
    } finally { this.ticking = false }
  }
  async launch(id: string, owner: CronOwner, manual = true): Promise<boolean> {
    if (this.stopped) return false
    const claimed = await this.repo.claim(id, owner, this.hostId, manual, this.now())
    if (!claimed) return false
    if (this.stopped) { await this.repo.finish(claimed, '调度器已停止，任务未执行。', this.now()); return false }
    const controller = new AbortController()
    const done = this.execute(claimed, controller.signal, manual).catch(error => this.log(String(error)))
    this.active.set(id, { controller, done })
    void done.finally(() => this.active.delete(id))
    return true
  }
  private async execute(current: CloudCronTask, signal: AbortSignal, manual: boolean): Promise<void> {
    let error: string | null = null
    try {
      await this.authorize(current)
      const source = await this.runtime.getSession(current.ownerSessionId)
      if (!source || source.userId !== current.userId || source.orgId !== current.orgId) throw new Error('归属会话已删除或不可访问。')
      let execution = current.executionSessionId ? await this.runtime.getSession(current.executionSessionId) : null
      if (!execution) {
        execution = await this.runtime.createSession({
          orgId: current.orgId, userId: current.userId, role: source.role, scopes: source.scopes,
          cwd: source.cwd, title: `云端定时任务 · ${current.prompt.slice(0, 42)}`,
          dangerouslySkipPermissions: false, assistantName: source.assistantName ?? undefined,
          advancedSettings: source.advancedSettings, autoMemory: source.autoMemory,
          sessionMemory: source.sessionMemory, runtimeOptions: source.runtimeOptions,
          scheduledTask: { taskId: current.id, sourceSessionId: source.sessionId },
        })
        await this.repo.setExecution(current, execution.sessionId)
      }
      if (execution.userId !== current.userId || execution.orgId !== current.orgId || execution.cronTaskId !== current.id) throw new Error('执行会话归属不匹配。')
      const latest = await this.repo.get(current.id, current)
      if (!latest || latest.runId !== current.runId) return
      if (!manual && !latest.enabled) {
        await this.repo.db.prepare("UPDATE cron_tasks SET status='idle', run_id=NULL, run_host=NULL, lease_until=NULL WHERE id=? AND run_id=? AND status<>'deleted'")
          .run(current.id, current.runId)
        return
      }
      if (this.stopped) throw new Error('服务端停止，任务未执行。')
      await this.run(this.runtime, execution.sessionId, current.prompt, AbortSignal.any([signal, AbortSignal.timeout(30 * 60000)]))
    } catch (failure) { error = failure instanceof Error ? failure.message : String(failure) }
    finally { await this.repo.finish(current, error, this.now()) }
  }
}
