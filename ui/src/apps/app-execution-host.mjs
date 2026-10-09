import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { Ajv } from 'ajv'
import { validateExecutionInput } from '../../../packages/app-sdk/src/execution/index.mjs'

const SETTLED = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
const stable = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  )
const digest = (value) =>
  createHash('sha256').update(stable(value)).digest('hex')
const identity = (context) =>
  digest({
    appId: context.appId,
    instanceId: context.instanceId,
    owner: context.owner ?? null,
  })
const id = (prefix) => prefix + '_' + randomUUID()
const clone = (value) => structuredClone(value)
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = file + '.' + randomUUID() + '.tmp'
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 })
  fs.renameSync(temp, file)
}

/** Generic task and Agent execution ownership. No workflow definitions or scheduling. */
export class AppExecutionHost {
  constructor({
    directory,
    createSource,
    validateSource = async () => {},
    execute,
    onChanged = () => {},
    notify = async () => {},
    authorize = async () => {},
  }) {
    this.directory = directory
    this.file = path.join(directory, 'tasks.json')
    this.createSource = createSource
    this.validateSource = validateSource
    this.execute = execute
    this.onChanged = onChanged
    this.notify = notify
    this.authorize = authorize
    this.validating = new Set()
    this.delivering = new Set()
    this.controllers = new Map()
    this.running = new Set()
    this.contextQueues = new Map()
    this.creating = new Map()
    this.tasks = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, 'utf8')).tasks
      : {}
    for (const task of Object.values(this.tasks)) {
      delete task.delivering
      if (!SETTLED.has(task.status)) task.status = 'interrupted'
      for (const execution of Object.values(task.executions))
        if (!SETTLED.has(execution.status)) execution.status = 'interrupted'
    }
    this.persist()
    this.timer = setInterval(() => this.expire(), 1000)
    this.timer.unref?.()
  }
  persist() {
    atomic(this.file, { version: 1, tasks: this.tasks })
  }
  event(task, execution, type, data = {}) {
    const event = {
      sequence: ++execution.sequence,
      eventId: execution.id + ':' + execution.sequence,
      executionId: execution.id,
      type,
      timestamp: Date.now(),
      ...data,
    }
    execution.events.push(event)
    if (execution.events.length > 2000)
      execution.events.splice(0, execution.events.length - 2000)
    task.updatedAt = Date.now()
    this.persist()
    this.onChanged(this.publicTask(task), event)
  }
  changed(task) {
    task.updatedAt = Date.now()
    task.revision++
    this.persist()
    this.onChanged(this.publicTask(task))
  }
  publicTask(task) {
    const {
      source,
      key,
      fingerprint,
      identity: _identity,
      contexts,
      executions,
      notificationPending,
      ...summary
    } = task
    return clone({
      ...summary,
      sessionId: source.sessionId,
      workspace: source.workspace,
      executionCount: Object.keys(executions).length,
      tokens: Object.values(executions).reduce(
        (n, item) => n + (item.tokens || 0),
        0,
      ),
    })
  }
  publicExecution(execution) {
    const { input, events, fingerprint, ...result } = execution
    return clone(result)
  }
  task(taskId, context) {
    const task = this.tasks[taskId]
    if (!task || task.identity !== identity(context))
      throw new Error('Task is outside this App owner scope')
    return task
  }
  findExecution(executionId, context) {
    for (const task of Object.values(this.tasks))
      if (task.executions[executionId]) {
        this.task(task.id, context)
        return { task, execution: task.executions[executionId] }
      }
    throw new Error('Unknown execution')
  }
  checkRevision(task, revision) {
    if (task.revision !== revision)
      throw new Error('Task revision conflict; refresh before changing it')
  }
  async handle(protocol, method, raw, context) {
    const input = validateExecutionInput(protocol, method, raw)
    await this.authorize(context)
    if (method === 'capabilities')
      return {
        environment: 'local',
        structuredOutput: true,
        contextReuse: true,
        maxConcurrency: 16,
        events: true,
      }
    if (method === 'task.create') {
      const key = identity(context) + ':' + input.idempotencyKey
      const existing = Object.values(this.tasks).find(
        (task) => task.key === key,
      )
      if (existing) {
        if (existing.fingerprint !== digest(input))
          throw new Error('Task idempotency conflict')
        return this.publicTask(existing)
      }
      if (this.creating.has(key)) {
        await this.creating.get(key)
        return this.handle(protocol, method, input, context)
      }
      const operation = (async () => {
        const source = await this.createSource(context, input)
        await this.authorize(context)
        const taskId = id('apptask')
        const limits = {
          maxConcurrency: Math.min(16, input.limits?.maxConcurrency ?? 4),
          maxCalls: Math.min(256, input.limits?.maxCalls ?? 256),
          maxDurationMs: Math.min(
            1_800_000,
            input.limits?.maxDurationMs ?? 1_800_000,
          ),
          maxTokens: Math.min(2_000_000, input.limits?.maxTokens ?? 2_000_000),
        }
        const task = {
          id: taskId,
          key,
          fingerprint: digest(input),
          identity: identity(context),
          appId: context.appId,
          instanceId: context.instanceId,
          source,
          title: input.title,
          route: input.route ?? '#/',
          status: 'running',
          revision: 1,
          scopeRef: id('scope'),
          attempt: 1,
          limits,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deadlineAt: Date.now() + limits.maxDurationMs,
          contexts: {},
          executions: {},
        }
        this.tasks[taskId] = task
        this.persist()
        this.onChanged(this.publicTask(task))
        return this.publicTask(task)
      })()
      this.creating.set(key, operation)
      try {
        return await operation
      } finally {
        this.creating.delete(key)
      }
    }
    if (method === 'task.list')
      return {
        tasks: Object.values(this.tasks)
          .filter((task) => task.identity === identity(context))
          .map((task) => this.publicTask(task))
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(input.offset ?? 0, (input.offset ?? 0) + Math.min(input.limit ?? 10, 10)),
      }
    if (method.startsWith('task.')) {
      const task = this.task(input.taskId, context)
      if (method === 'task.get') return this.publicTask(task)
      if (method === 'task.cancel') {
        this.cancelTask(task, input.reason ?? 'Cancelled by user')
        return this.publicTask(task)
      }
      this.checkRevision(task, input.revision)
      if (method === 'task.resume') {
        if (!['interrupted', 'failed', 'cancelled'].includes(task.status))
          throw new Error('Task cannot resume in its current state')
        await this.validateSource(task.source)
        task.status = 'running'
        task.attempt++
        task.scopeRef = id('scope')
        task.deadlineAt = Date.now() + task.limits.maxDurationMs
        delete task.error
        delete task.notificationPending
        this.changed(task)
        return this.publicTask(task)
      }
      if (SETTLED.has(task.status)) throw new Error('Task has already ended')
      if (method === 'task.update') {
        task.summary = input.summary ?? task.summary
        task.progress = input.progress ?? task.progress
      }
      if (method === 'task.finish') {
        if (
          input.status === 'completed' &&
          Object.values(task.executions).some(
            (item) => !SETTLED.has(item.status),
          )
        )
          throw new Error('Task still has active executions')
        if (input.status === 'failed')
          this.cancelExecutions(task, 'Parent task failed')
        task.status = input.status
        task.summary = input.summary
        task.result = input.result
        task.notificationPending = true
      }
      this.changed(task)
      if (task.notificationPending) void this.deliver(task)
      return this.publicTask(task)
    }
    if (method === 'execution.list')
      return {
        executions: Object.values(
          this.task(input.taskId, context).executions,
        ).map((item) => this.publicExecution(item)),
      }
    if (method === 'execution.start') {
      const task = Object.values(this.tasks).find(
        (item) => item.scopeRef === input.scopeRef,
      )
      if (!task) throw new Error('Invalid execution scope')
      this.task(task.id, context)
      const fingerprint = digest({ ...input, scopeRef: undefined })
      const prior = Object.values(task.executions).find(
        (item) => item.key === input.idempotencyKey,
      )
      if (prior && prior.fingerprint !== fingerprint)
        throw new Error('Execution idempotency conflict')
      const duplicate = Object.values(task.executions).find(
        (item) =>
          item.key === input.idempotencyKey &&
          (item.status === 'completed' || item.attempt === task.attempt),
      )
      if (duplicate) {
        if (duplicate.fingerprint !== fingerprint)
          throw new Error('Execution idempotency conflict')
        return this.publicExecution(duplicate)
      }
      if (task.status !== 'running' || Date.now() >= task.deadlineAt)
        throw new Error('Task is not accepting executions')
      if (
        Object.keys(task.executions).length >= task.limits.maxCalls ||
        this.publicTask(task).tokens >= task.limits.maxTokens
      )
        throw new Error('Task resource limit reached')
      new Ajv({ strict: false }).compile(input.outputSchema)
      await this.validateSource(task.source)
      await this.authorize(context)
      // Re-enter after awaited checks; reserve atomically with no further await.
      const raced = Object.values(task.executions).find(
        (item) =>
          item.key === input.idempotencyKey &&
          (item.status === 'completed' || item.attempt === task.attempt),
      )
      if (raced) {
        if (raced.fingerprint !== fingerprint)
          throw new Error('Execution idempotency conflict')
        return this.publicExecution(raced)
      }
      if (
        task.status !== 'running' ||
        Date.now() >= task.deadlineAt ||
        this.publicTask(task).tokens >= task.limits.maxTokens ||
        Object.keys(task.executions).length >= task.limits.maxCalls
      )
        throw new Error('Task no longer accepts executions')
      const execution = {
        id: id('exec'),
        key: input.idempotencyKey,
        taskId: task.id,
        contextKey: input.contextKey,
        contextRef: Object.hasOwn(task.contexts, input.contextKey)
          ? task.contexts[input.contextKey]
          : randomUUID(),
        status: 'queued',
        input: clone(input),
        fingerprint,
        sequence: 0,
        events: [],
        tokens: 0,
        toolCalls: 0,
        createdAt: Date.now(),
        attempt: task.attempt,
      }
      Object.defineProperty(task.contexts, input.contextKey, {
        value: execution.contextRef,
        enumerable: true,
        configurable: true,
        writable: true,
      })
      task.executions[execution.id] = execution
      this.event(task, execution, 'queued')
      void this.drain()
      return this.publicExecution(execution)
    }
    if (method === 'execution.result.read') {
      const { execution } = this.findExecution(input.resultRef, context)
      if (!execution.resultRef) throw new Error('Result is unavailable')
      const value = fs.readFileSync(
        path.join(this.directory, execution.id + '.result.json'),
        'utf8',
      )
      const offset = input.offset ?? 0
      const limit = Math.min(input.limit ?? 100_000, 100_000)
      return {
        text: value.slice(offset, offset + limit),
        nextOffset: offset + limit < value.length ? offset + limit : null,
      }
    }
    const { task, execution } = this.findExecution(input.executionId, context)
    if (method === 'execution.get') return this.publicExecution(execution)
    if (method === 'execution.events')
      return {
        events: execution.events
          .filter((event) => event.sequence > (input.afterSequence ?? 0))
          .slice(0, Math.min(input.limit ?? 100, 200)),
        earliestSequence: execution.events[0]?.sequence ?? 0,
      }
    if (method === 'execution.cancel') {
      this.cancelExecution(task, execution, input.reason ?? 'Cancelled by user')
      return this.publicExecution(execution)
    }
    throw new Error('Unsupported execution method')
  }
  async drain() {
    for (const task of Object.values(this.tasks)) {
      if (task.status !== 'running') continue
      for (const execution of Object.values(task.executions)) {
        if (this.running.size >= 16) return
        if (execution.status !== 'queued') continue
        const active = Object.values(task.executions).filter((item) =>
          this.running.has(item.id),
        )
        if (
          active.length >= task.limits.maxConcurrency ||
          active.some((item) => item.contextKey === execution.contextKey)
        )
          continue
        this.running.add(execution.id)
        void this.run(task, execution)
          .catch(() => {})
          .finally(() => {
            this.running.delete(execution.id)
            void this.drain()
          })
      }
    }
  }
  async run(task, execution) {
    const controller = new AbortController()
    this.controllers.set(execution.id, controller)
    const timeoutMs = Math.max(
      1,
      Math.min(
        execution.input.timeoutMs ?? 1_800_000,
        task.deadlineAt - Date.now(),
      ),
    )
    const timer = setTimeout(
      () => controller.abort(new Error('Agent execution timed out')),
      timeoutMs,
    )
    timer.unref?.()
    let lastProgress = 0
    try {
      await this.validateSource(task.source)
      if (task.status !== 'running' || execution.status !== 'queued') return
      execution.status = 'running'
      this.event(task, execution, 'running')
      const result = await this.execute({
        source: task.source,
        appId: task.appId,
        taskId: task.id,
        agentId: execution.contextRef,
        input: execution.input,
        controller,
        onProgress: (progress) => {
          if (SETTLED.has(execution.status)) return
          execution.tokens = progress.tokens
          execution.toolCalls = progress.toolCalls
          if (this.publicTask(task).tokens >= task.limits.maxTokens) {
            this.cancelTask(task, 'Task token budget reached')
            return
          }
          if (Date.now() - lastProgress > 300) {
            lastProgress = Date.now()
            this.event(task, execution, 'progress', progress)
          }
        },
      })
      if (controller.signal.aborted)
        throw controller.signal.reason ?? new Error('Cancelled')
      if (SETTLED.has(execution.status)) return
      const validator = new Ajv({ strict: false }).compile(
        execution.input.outputSchema,
      )
      if (!validator(result.value))
        throw new Error('Agent result does not match outputSchema')
      atomic(
        path.join(this.directory, execution.id + '.result.json'),
        result.value,
      )
      execution.resultRef = execution.id
      execution.status = 'completed'
      execution.tokens = result.tokens || 0
      execution.toolCalls = result.toolCalls || 0
      this.event(task, execution, 'completed')
    } catch (error) {
      if (!SETTLED.has(execution.status)) {
        execution.status = controller.signal.aborted ? 'cancelled' : 'failed'
        execution.error = String(error?.message ?? error).slice(0, 4000)
        this.event(task, execution, execution.status, {
          error: execution.error,
        })
      }
    } finally {
      clearTimeout(timer)
      this.controllers.delete(execution.id)
    }
  }
  cancelExecution(task, execution, reason) {
    if (SETTLED.has(execution.status)) return
    execution.status = 'cancelled'
    execution.error = reason
    this.controllers.get(execution.id)?.abort(new Error(reason))
    this.event(task, execution, 'cancelled')
  }
  cancelExecutions(task, reason) {
    for (const execution of Object.values(task.executions))
      this.cancelExecution(task, execution, reason)
  }
  cancelTask(task, reason, status = 'cancelled') {
    if (SETTLED.has(task.status)) return
    task.status = status
    task.error = reason
    this.cancelExecutions(task, reason)
    this.changed(task)
  }
  cancelSession(sessionId) {
    for (const task of Object.values(this.tasks))
      if (task.source.sessionId === sessionId)
        this.cancelTask(task, 'Source session stopped')
  }
  deactivate(appId, reason = 'App stopped', instanceId) {
    for (const task of Object.values(this.tasks))
      if (
        task.appId === appId &&
        (!instanceId || task.instanceId === instanceId)
      )
        this.cancelTask(task, reason, 'interrupted')
  }
  listSession(sessionId) {
    return Object.values(this.tasks)
      .filter((task) => task.source.sessionId === sessionId)
      .map((task) => this.publicTask(task))
  }
  expire() {
    for (const task of Object.values(this.tasks)) {
      if (task.status === 'running' && !this.validating.has(task.id)) {
        this.validating.add(task.id)
        Promise.resolve()
          .then(async () => { await this.authorize({appId:task.appId,instanceId:task.instanceId}); await this.validateSource(task.source) })
          .catch((error) =>
            this.cancelTask(task, String(error?.message ?? error)),
          )
          .finally(() => this.validating.delete(task.id))
      }
      if (task.status === 'running' && Date.now() >= task.deadlineAt)
        this.cancelTask(task, 'Task deadline reached')
      if (task.notificationPending) void this.deliver(task)
    }
  }
  async deliver(task) {
    if (this.delivering.has(task.id)) return
    this.delivering.add(task.id)
    try {
      await this.notify(this.publicTask(task))
      task.notificationPending = false
      this.persist()
    } catch {
    } finally {
      this.delivering.delete(task.id)
    }
  }
  close() {
    clearInterval(this.timer)
    for (const task of Object.values(this.tasks))
      this.cancelTask(task, 'Moss shut down', 'interrupted')
  }
}
