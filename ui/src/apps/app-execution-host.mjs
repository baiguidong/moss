import { executionLimits } from '../../../packages/host-contracts/src/index.mjs'
import fsp from 'node:fs/promises'
import { ExecutionStore } from './execution-store.mjs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { Ajv } from 'ajv'
import { validateExecutionHostInput, MOSS_AGENT_EXECUTION_PROTOCOL, MOSS_TASKS_PROTOCOL } from '../../../packages/app-sdk/src/execution/index.mjs'
import { APP_ERROR_CODES, AppServiceError } from '../../../packages/app-sdk/src/protocol/index.mjs'

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

/** Generic task and Agent execution ownership. No workflow definitions or scheduling. */
export class AppExecutionHost {
  constructor({
    directory,
    createSource,
    validateSource = async () => {},
    execute,
    onChanged = () => {},
    publishEvent = null,
    notify = async () => {},
    authorize = async () => {},
  }) {
    this.directory = directory
    this.store = new ExecutionStore(directory)
    this.writes = new Set()
    this.executionsById = new Map()
    this.createSource = createSource
    this.validateSource = validateSource
    this.execute = execute
    this.onChanged = onChanged
    this.publishEvent = publishEvent
    this.notify = notify
    this.authorize = authorize
    this.validating = new Set()
    this.delivering = new Set()
    this.controllers = new Map()
    this.running = new Set()
    this.contextQueues = new Map()
    this.creating = new Map()
    this.tasks = {}
    this.ready = this.store.request('prune').then(() => this.store.request('load', { initial: true })).then(async tasks => {
      this.tasks = tasks
      for (const task of Object.values(tasks)) {
        for (const execution of Object.values(task.executions)) this.executionsById.set(execution.id, task)
        this.cancelTask(task, 'Moss restarted', 'interrupted')
      }
      await this.flush()
    })
    this.ready.catch(() => {})
    this.timer = setInterval(() => { void this.ready.then(() => { if (!this.closing) this.expire() }).catch(() => {}) }, 1000)
    this.timer.unref?.()
  }
  persist(task, execution, event) {
    const write = this.store.save(task, execution, event, this.publicTask(task)).catch(error => {
      this.persistenceError = error
      for (const controller of this.controllers.values()) controller.abort(error)
    }).finally(() => this.writes.delete(write))
    this.writes.add(write)
    return write
  }
  async flush() {
    while (this.writes.size) await Promise.all([...this.writes])
    if (this.persistenceError) throw this.persistenceError
  }
  async hydrate(query) {
    const loaded = await this.store.request('load', query)
    for (const [id, task] of Object.entries(loaded)) if (!this.tasks[id]) {
      this.tasks[id] = task
      for (const execution of Object.values(task.executions)) this.executionsById.set(execution.id, task)
    }
  }
  trimCache() {
    const settled = Object.values(this.tasks).filter(task => SETTLED.has(task.status) && !task.notificationPending && !Object.keys(task.executions).some(id => this.running.has(id)))
      .sort((a,b) => b.updatedAt-a.updatedAt)
    for (const task of settled.slice(100)) this.forget(task.id)
  }
  forget(id) {
    const task = this.tasks[id]
    if (!task) return
    for (const execution of Object.values(task.executions)) this.executionsById.delete(execution.id)
    delete this.tasks[id]
  }
  async updateSource(taskId, patch) {
    await this.ready
    const task = this.tasks[taskId]
    if (!task) throw new AppServiceError(APP_ERROR_CODES.notFound, 'Unknown task source')
    task.source = { ...task.source, ...patch }
    await this.persist(task)
    await this.flush()
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
    if (execution.events.length > executionLimits.eventHistory)
      execution.events.splice(0, execution.events.length - executionLimits.eventHistory)
    task.updatedAt = Date.now()
    this.executionsById.set(execution.id, task)
    const summary = this.publicTask(task), executionSummary = this.publicExecution(execution)
    const target = { appId: task.appId, instanceId: task.instanceId, owner: clone(task.owner) }
    void this.persist(task, execution, event).then(() => {
      if (this.persistenceError) return
      this.notifyChanged(summary, event)
      this.publishSnapshot(target, summary, executionSummary, event)
    })
  }
  changed(task) {
    task.updatedAt = Date.now()
    task.revision++
    const summary = this.publicTask(task), target = { appId: task.appId, instanceId: task.instanceId, owner: clone(task.owner) }
    void this.persist(task).then(() => {
      if (this.persistenceError) return
      this.notifyChanged(summary)
      this.publishSnapshot(target, summary)
    })
  }
  notifyChanged(task, event) {
    void Promise.resolve().then(() => this.onChanged(task, event)).catch(error => {
      console.warn('App task change observer failed:', error)
    })
  }
  publishChange(task, execution, event) {
    // Changes are hints; persisted get/events remain the source of truth after a disconnect.
    if (!this.publishEvent) return
    const target = { appId: task.appId, instanceId: task.instanceId, owner: task.owner }
    this.publishSnapshot(target, this.publicTask(task), execution && this.publicExecution(execution), event)
  }
  publishSnapshot(target, task, execution, event) {
    if (!this.publishEvent) return
    const send = (protocol, name, data, eventId) => {
      void Promise.resolve().then(() => this.publishEvent(target, protocol, name, data, {
        ...(eventId ? { eventId } : {}), timeoutMs: 5000, onlyIfRunning: true,
      })).catch(() => {})
    }
    send(MOSS_TASKS_PROTOCOL, 'task.changed', { task })
    if (execution) send(MOSS_AGENT_EXECUTION_PROTOCOL, 'execution.changed', {
      taskId: task.id, execution, event: clone(event),
    }, event.eventId)
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
      owner,
      ...summary
    } = task
    return clone({
      ...summary,
      ...(SETTLED.has(task.status) ? { expiresAt: task.updatedAt + executionLimits.retentionMs } : {}),
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
    if (!task || task.identity !== identity(context) || (SETTLED.has(task.status) && task.updatedAt + executionLimits.retentionMs <= Date.now()))
      throw new AppServiceError(APP_ERROR_CODES.notFound, 'Task is outside this App owner scope')
    return task
  }
  findExecution(executionId, context) {
    const task = this.executionsById.get(executionId)
    if (task) {
      this.task(task.id, context)
      return { task, execution: task.executions[executionId] }
    }
    throw new AppServiceError(APP_ERROR_CODES.notFound, 'Unknown execution')
  }
  checkRevision(task, revision) {
    if (task.revision !== revision)
      throw new AppServiceError(APP_ERROR_CODES.conflict, 'Task revision conflict; refresh before changing it', { kind: 'revision', currentRevision: task.revision })
  }
  async handle(protocol, method, raw, context) {
    await this.ready
    if (this.closing) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'Execution Host is closed')
    await this.flush()
    // Hydrate historical records on demand; ordinary startup retains a bounded working set.
    const checked = validateExecutionHostInput(protocol, method, raw)
    if (checked.taskId && !this.tasks[checked.taskId]) await this.hydrate({ taskId: checked.taskId })
    if ((checked.executionId || checked.resultRef) && !this.executionsById.has(checked.executionId || checked.resultRef)) await this.hydrate({ executionId: checked.executionId || checked.resultRef })
    if (checked.scopeRef && !Object.values(this.tasks).some(task => task.scopeRef === checked.scopeRef)) await this.hydrate({ scopeRef: checked.scopeRef })
    if (method === 'task.create') await this.hydrate({ key: identity(context) + ':' + checked.idempotencyKey })
    const result = await this.handleRequest(protocol, method, checked, context)
    await this.flush()
    this.trimCache()
    return result
  }
  async handleRequest(protocol, method, raw, context) {
    const input = validateExecutionHostInput(protocol, method, raw)
    await this.authorize(context)
    context.assertCurrent?.()
    context.signal?.throwIfAborted()
    if (method === 'capabilities')
      return {
        environment: 'local',
        structuredOutput: true,
        contextReuse: true,
        maxConcurrency: executionLimits.maxConcurrency,
        events: Boolean(this.publishEvent),
      }
    if (method === 'task.create') {
      const key = identity(context) + ':' + input.idempotencyKey
      const existing = Object.values(this.tasks).find(
        (task) => task.key === key && !(SETTLED.has(task.status) && task.updatedAt + executionLimits.retentionMs <= Date.now()),
      )
      if (existing) {
        if (existing.fingerprint !== digest(input))
          throw new AppServiceError(APP_ERROR_CODES.conflict, 'Task idempotency conflict', { kind: 'idempotency' })
        return this.publicTask(existing)
      }
      if (this.creating.has(key)) {
        await this.creating.get(key)
        return this.handle(protocol, method, input, context)
      }
      if (Object.values(this.tasks).filter(task => task.status === 'running').length + this.creating.size >= executionLimits.activeTasks) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Active task limit reached')
      const operation = (async () => {
        const source = await this.createSource(context, input)
        await this.authorize(context)
        context.assertCurrent?.()
        context.signal?.throwIfAborted()
        if (Object.values(this.tasks).filter(task => task.status === 'running').length >= executionLimits.activeTasks) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Active task limit reached')
        const taskId = id('apptask')
        const limits = {
          maxConcurrency: Math.min(executionLimits.maxConcurrency, input.limits?.maxConcurrency ?? 4),
          maxCalls: Math.min(executionLimits.maxCalls, input.limits?.maxCalls ?? executionLimits.maxCalls),
          maxDurationMs: Math.min(
            executionLimits.maxDurationMs,
            input.limits?.maxDurationMs ?? executionLimits.maxDurationMs,
          ),
          maxTokens: Math.min(executionLimits.maxTokens, input.limits?.maxTokens ?? executionLimits.maxTokens),
        }
        const task = {
          id: taskId,
          key,
          fingerprint: digest(input),
          identity: identity(context),
          appId: context.appId,
          instanceId: context.instanceId,
          owner: clone(context.owner ?? null),
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
        await this.persist(task)
        await this.flush()
        this.notifyChanged(this.publicTask(task))
        this.publishChange(task)
        return this.publicTask(task)
      })()
      this.creating.set(key, operation)
      try {
        return await operation
      } finally {
        this.creating.delete(key)
      }
    }
    if (method === 'task.list') {
      let page
      try { page = await this.store.request('list', { owner: identity(context), cursor: input.cursor, limit: input.limit ?? 10 }) }
      catch (error) { if (error.message.includes('cursor')) throw new AppServiceError(APP_ERROR_CODES.invalidInput, error.message); throw error }
      return page
    }
    if (method === 'task.changes') return this.store.request('changes', { owner: identity(context), afterCursor: input.afterCursor, limit: input.limit ?? 100 })
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
          throw new AppServiceError(APP_ERROR_CODES.conflict, 'Task cannot resume in its current state')
        await this.validateSource(task.source)
        context.assertCurrent?.()
        context.signal?.throwIfAborted()
        this.checkRevision(task, input.revision)
        if (Object.values(this.tasks).filter(task => task.status === 'running').length >= executionLimits.activeTasks) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Active task limit reached')
        task.status = 'running'
        task.attempt++
        task.scopeRef = id('scope')
        task.deadlineAt = Date.now() + task.limits.maxDurationMs
        delete task.error
        delete task.notificationPending
        this.changed(task)
        return this.publicTask(task)
      }
      if (SETTLED.has(task.status)) throw new AppServiceError(APP_ERROR_CODES.conflict, 'Task has already ended')
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
          throw new AppServiceError(APP_ERROR_CODES.conflict, 'Task still has active executions')
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
      if (!task) throw new AppServiceError(APP_ERROR_CODES.notFound, 'Invalid execution scope')
      this.task(task.id, context)
      const fingerprint = digest({ ...input, scopeRef: undefined })
      const prior = Object.values(task.executions).find(
        (item) => item.key === input.idempotencyKey,
      )
      if (prior && prior.fingerprint !== fingerprint)
        throw new AppServiceError(APP_ERROR_CODES.conflict, 'Execution idempotency conflict', { kind: 'idempotency' })
      const duplicate = Object.values(task.executions).find(
        (item) =>
          item.key === input.idempotencyKey &&
          (item.status === 'completed' || item.attempt === task.attempt),
      )
      if (duplicate) {
        if (duplicate.fingerprint !== fingerprint)
          throw new AppServiceError(APP_ERROR_CODES.conflict, 'Execution idempotency conflict', { kind: 'idempotency' })
        return this.publicExecution(duplicate)
      }
      if (task.status !== 'running' || Date.now() >= task.deadlineAt)
        throw new AppServiceError(APP_ERROR_CODES.conflict, 'Task is not accepting executions')
      if (
        Object.keys(task.executions).length >= task.limits.maxCalls ||
        this.publicTask(task).tokens >= task.limits.maxTokens
      )
        throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Task resource limit reached')
      try { new Ajv({ strict: false }).compile(input.outputSchema) }
      catch { throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid outputSchema') }
      await this.validateSource(task.source)
      await this.authorize(context)
      context.assertCurrent?.()
      context.signal?.throwIfAborted()
      // Re-enter after awaited checks; reserve atomically with no further await.
      const raced = Object.values(task.executions).find(
        (item) =>
          item.key === input.idempotencyKey &&
          (item.status === 'completed' || item.attempt === task.attempt),
      )
      if (raced) {
        if (raced.fingerprint !== fingerprint)
          throw new AppServiceError(APP_ERROR_CODES.conflict, 'Execution idempotency conflict', { kind: 'idempotency' })
        return this.publicExecution(raced)
      }
      if (
        task.status !== 'running' ||
        Date.now() >= task.deadlineAt
      )
        throw new AppServiceError(APP_ERROR_CODES.conflict, 'Task no longer accepts executions')
      if (
        this.publicTask(task).tokens >= task.limits.maxTokens ||
        Object.keys(task.executions).length >= task.limits.maxCalls
      )
        throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Task resource limit reached')
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
      if (!execution.resultRef) throw new AppServiceError(APP_ERROR_CODES.conflict, 'Result is unavailable')
      const offset = input.offset ?? 0, limit = Math.min(input.limit ?? executionLimits.resultChunkUnits, executionLimits.resultChunkUnits)
      const file = await fsp.open(path.join(this.directory, execution.id + '.result.utf16'), 'r')
      try {
        const size = (await file.stat()).size / 2
        const buffer = Buffer.alloc(Math.max(0, Math.min(limit, size - offset)) * 2)
        let read = 0
        while (read < buffer.length) {
          const chunk = await file.read(buffer, read, buffer.length - read, offset * 2 + read)
          if (!chunk.bytesRead) throw new Error('Truncated execution result')
          read += chunk.bytesRead
        }
        context.assertCurrent?.()
        context.signal?.throwIfAborted()
        return { text: buffer.toString('utf16le'), nextOffset: offset + read / 2 < size ? offset + read / 2 : null }
      } finally { await file.close() }
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
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'Unsupported execution method')
  }
  async drain() {
    for (const task of Object.values(this.tasks)) {
      if (task.status !== 'running') continue
      for (const execution of Object.values(task.executions)) {
        if (this.running.size >= executionLimits.maxConcurrency) return
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
        execution.input.timeoutMs ?? executionLimits.maxDurationMs,
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
      await this.flush()
      if (controller.signal.aborted || this.closing) return
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
      const resultFile = path.join(this.directory, execution.id + '.result.utf16')
      const temporary = resultFile + '.' + randomUUID() + '.tmp'
      try {
        await fsp.writeFile(temporary, JSON.stringify(result.value), { encoding: 'utf16le', mode: 0o600, signal: controller.signal })
        if (SETTLED.has(execution.status)) return
        await fsp.rename(temporary, resultFile)
        if (SETTLED.has(execution.status) || controller.signal.aborted) { await fsp.rm(resultFile, { force: true }); return }
      } finally { await fsp.rm(temporary, { force: true }) }
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
    return Object.values(this.tasks).filter(task => task.source.sessionId === sessionId && (task.status === 'running' || task.updatedAt + executionLimits.retentionMs > Date.now())).map(task => this.publicTask(task))
  }
  async listSessionHistory(sessionId) {
    await this.ready
    await this.flush()
    return this.store.request('session', { sessionId })
  }
  expire() {
    if (!this.pruning && (!this.lastPrune || Date.now()-this.lastPrune > 60000)) {
      this.lastPrune = Date.now()
      this.pruning = this.flush().then(() => this.store.request('prune')).then(ids => { for (const id of ids) this.forget(id); this.trimCache() }).catch(error => { this.persistenceError = error }).finally(() => { this.pruning = false })
    }
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
      await this.flush()
      if (this.closing) return
      await this.notify(this.publicTask(task))
      task.notificationPending = false
      if (!this.closing) await this.persist(task)
    } catch {
    } finally {
      this.delivering.delete(task.id)
    }
  }
  close() {
    if (this.closePromise) return this.closePromise
    this.closing = true
    clearInterval(this.timer)
    this.closePromise = (async () => {
      try {
        await this.ready
        await this.pruning
        for (const task of Object.values(this.tasks)) this.cancelTask(task, 'Moss shut down', 'interrupted')
        await this.flush()
      } finally { await this.store.close() }
    })()
    return this.closePromise
  }
}
