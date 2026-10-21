import fs from 'node:fs/promises'
import path from 'node:path'
import { createReusableTestInstance } from './reusable-instance.mjs'
import { TEST_APP_ID, TEST_BROWSER_SERVER } from './browser.mjs'
import { resolveReviewEvidence } from './review-evidence.mjs'
import { captureTargetFrame, sendTargetInput } from './target-view.mjs'

export const TESTING_PROTOCOL = 'moss.testing/v1'
const message = error => error instanceof Error ? error.message : String(error)
const keyOf = context => JSON.stringify([context.owner?.key || '', context.appId, context.instanceId])

/** Owns target processes and temporary controller connections, never test cases/results. */
export function createAppTestingHost(options) {
  const entries = new Map()
  const { getRuntime, getSettings, isTarget, createController, executeController, interruptController, stopController } = options
  const emit = (entry, state) => {
    void getRuntime()?.publishHostEvent(entry.appId, entry.instanceId, TESTING_PROTOCOL, 'target.changed', state).catch(() => {})
  }
  function live(entry) {
    const runtime = getRuntime()
    const installed = runtime?.installations.get(entry.appId)
    return entries.get(entry.key) === entry && !entry.lifecycle.signal.aborted
      && installed?.enabled && installed.activeVersion === entry.version
      && installed.grants?.includes('testing:control') && installed.grants?.includes('agent:permissions:bypass')
      && runtime.runtimeForInstance(entry.appId, entry.instanceId)?.generation === entry.generation
  }
  function assertLive(entry) { if (!live(entry)) throw new Error('自测 App 已停止或授权已改变。') }
  async function entryFor(context) {
    context.assertCurrent?.()
    if (context.appId !== TEST_APP_ID) throw new Error('此能力仅供 AI 自测 App 使用。')
    context.assertPermission?.('agent:permissions:bypass')
    if (isTarget) throw new Error('被测实例不能再次启动自测，请回到主 Moss。')
    const key = keyOf(context)
    let entry = entries.get(key)
    if (entry && (entry.generation !== context.generation || entry.version !== context.version)) {
      await deactivate(context.appId, context.instanceId)
      entry = null
    }
    if (!entry) {
      entry = { key, appId: context.appId, instanceId: context.instanceId, owner: context.owner,
        version: context.version, generation: context.generation, dataDir: context.dataDir,
        lifecycle: new AbortController(), fixtureOptions: {}, controller: null, operation: null, operationError: null }
      entry.target = createReusableTestInstance({
        directory: path.join(context.dataDir, 'target'), getSettings, getAppRuntime: getRuntime,
        getRuntimeHome: options.getRuntimeHome, executable: options.executable, args: options.args, cwd: options.cwd,
        getFixtures: () => entry.fixtureOptions,
        notify: state => emit(entry, { ...state, operation: entry.operation }),
        ...(options.launch ? { launch: options.launch } : {}),
      })
      entries.set(key, entry)
    }
    assertLive(entry)
    return entry
  }
  async function targetStatus(entry) {
    return { ...await entry.target.getStatus(), operation: entry.operation, operationError: entry.operationError }
  }
  async function manageTarget(entry, method, input) {
    if (method === 'open' && entry.run && entry.targetProcess?.isAlive()) {
      // A run owns this process and its environment until it finishes.
      entry.targetProcess.focus?.()
      return targetStatus(entry)
    }
    if (entry.controller) throw new Error('请先停止自测，再管理测试实例。')
    if (entry.operation && method !== 'close') throw new Error('正在准备测试实例，请等待完成。')
    if (input.fixtures) entry.fixtureOptions = { fixtures: input.fixtures, fixtureTitle: input.title || '' }
    entry.operationError = null
    const operation = entry.operation = method
    const pending = method === 'close' ? entry.target.close()
      : entry.target[method === 'sync' ? 'refresh' : method === 'reset' ? 'clearData' : 'open']({ signal: entry.lifecycle.signal })
    entry.pending = pending.catch(error => { entry.operationError = message(error) }).finally(async () => {
      if (entry.pending === tracked) { entry.operation = null; emit(entry, await targetStatus(entry)) }
    })
    const tracked = entry.pending
    return { ...await targetStatus(entry), operation }
  }
  function controllerFor(entry, sessionId) {
    const controller = entry.controller
    if (!controller || controller.sessionId !== sessionId) throw new Error('本轮控制会话已结束或不属于当前 App。')
    return controller
  }
  const turnStatus = controller => ({ sessionId: controller.sessionId, state: controller.state, error: controller.error || null })
  async function dispose(entry) {
    const controller = entry.controller
    if (!controller) return
    if (controller.disposing) return controller.disposing
    controller.disposing = (async () => {
      await controller.creating?.catch(() => {})
      if (!controller.sessionId) return
      controller.abort?.abort(new Error('测试控制会话已结束。'))
      await interruptController(controller.sessionId)
      await controller.pending
      await stopController(controller.sessionId)
      if (entry.controller === controller) entry.controller = null
    })()
    return controller.disposing
  }
  async function deactivate(appId, instanceId) {
    await Promise.all([...entries.values()].filter(entry => entry.appId === appId && (!instanceId || entry.instanceId === instanceId)).map(async entry => {
      entry.lifecycle.abort(new Error('自测 App 已停止。'))
      // Cancel target preparation before waiting for its queue.
      const closing = entry.target.close()
      await dispose(entry)
      await entry.pending
      await closing
      if (entries.get(entry.key) === entry) entries.delete(entry.key)
    }))
  }
  return {
    deactivate,
    close: () => deactivate(TEST_APP_ID),
    isRunning: () => [...entries.values()].some(entry => entry.controller || entry.operation),
    isControllerActive: record => [...entries.values()].some(entry => live(entry) && entry.controller?.sessionId === record?.id
      && entry.controller.runId === record.appTestRunId && entry.targetProcess?.isAlive() && !entry.controller.disposing),
    async handle(method, input, context) {
      if (method === 'environment') {
        context.assertCurrent?.()
        const settings = getSettings()
        return { appVersion: options.appVersion, model: settings.model || '', appearance: settings.appearance || {}, disabled: Boolean(isTarget), web: options.web === true,
          ...(options.hostBuildId ? { hostBuildId: options.hostBuildId } : {}) }
      }
      const entry = await entryFor(context)
      if (method === 'controller.caller') return { sessionId: context.invocation?.surface === 'tool' ? context.invocation.sessionId || null : null }
      if (method === 'target.status') return targetStatus(entry)
      if (method === 'target.frame' || method === 'target.input') {
        if (!options.web) throw new Error('测试实例画面仅供 Web 页面使用。')
        const target = entry.targetProcess?.isAlive() ? entry.targetProcess : entry.target.current()
        if (method === 'target.frame') return captureTargetFrame(target)
        return sendTargetInput(target, input)
      }
      if (['target.open', 'target.close', 'target.sync', 'target.reset'].includes(method)) {
        options.assertWorkAllowed?.()
        return manageTarget(entry, method.slice(7), input)
      }
      if (method === 'target.attach') {
        if (entry.operation) throw new Error('测试环境仍在准备。')
        if (entry.controller) throw new Error('已有自测正在运行。')
        const run = { id: input.runId }
        entry.targetProcess = await entry.target.attachRun(run, { signal: entry.lifecycle.signal })
        assertLive(entry)
        entry.run = run
        return { ...run, endpoint: entry.targetProcess.endpoint }
      }
      if (method === 'controller.create') {
        options.assertWorkAllowed?.()
        if (entry.controller || entry.run?.id !== input.runId || !entry.targetProcess?.isAlive()) throw new Error('测试实例或运行标识无效。')
        const controller = { runId: input.runId, sessionId: null, state: 'idle', error: null, evidenceReview: input.evidenceReview === true }
        entry.controller = controller
        controller.creating = (async () => {
          try {
            const pkg = await getRuntime().getActivePackage(entry.appId)
            const packageRoot = await fs.realpath(pkg.root)
            const engine = await fs.realpath(path.resolve(packageRoot, input.engineEntry))
            if (!engine.startsWith(packageRoot + path.sep) || !(await fs.stat(engine)).isFile()) throw new Error('浏览器引擎必须位于当前 App 安装包中。')
            const directory = path.join(entry.dataDir, 'runs', input.runId)
            const evidenceDir = path.join(directory, 'evidence')
            const actualRoot = await fs.realpath(entry.dataDir)
            if (await fs.realpath(evidenceDir) !== path.join(actualRoot, 'runs', input.runId, 'evidence')) throw new Error('测试证据目录无效。')
            const node = await options.getNodeExecutable()
            assertLive(entry)
            controller.evidenceDir = evidenceDir
            controller.sessionId = await createController({ ...entry.run, instanceId: entry.instanceId, directory, evidenceDir, title: input.title, evidenceReview: controller.evidenceReview }, {
              type: 'stdio', command: node, args: [engine, '--cdp-endpoint', entry.targetProcess.endpoint, '--output-dir', evidenceDir],
              env: { ELECTRON_RUN_AS_NODE: '1' }, disabledTools: input.disabledTools,
            })
            assertLive(entry)
            return { sessionId: controller.sessionId, browserServer: TEST_BROWSER_SERVER }
          } catch (error) {
            if (controller.sessionId) await stopController(controller.sessionId)
            if (entry.controller === controller) entry.controller = null
            throw error
          }
        })()
        return controller.creating
      }
      if (method === 'controller.open') {
        const record = options.getSession(input.sessionId)
        if (!record?.appTestRunId || record.appTestInstanceId !== entry.instanceId) throw new Error('测试会话不属于当前 App。')
        options.openSession(input.sessionId)
        return { opened: true }
      }
      const controller = controllerFor(entry, input.sessionId)
      if (method === 'controller.turn.start') {
        if (controller.state === 'running' || controller.disposing) throw new Error('控制会话仍在执行。')
        if (!entry.targetProcess?.isAlive()) throw new Error('测试实例提前退出。')
        controller.abort = new AbortController()
        controller.state = 'running'; controller.error = null
        const signal = AbortSignal.any([controller.abort.signal, entry.lifecycle.signal])
        controller.pending = Promise.resolve().then(async () => {
          assertLive(entry); signal.throwIfAborted()
          const evidence = controller.evidenceReview || input.evidence?.length
            ? await resolveReviewEvidence(input.prompt, input.evidence, controller.evidenceDir)
            : { content: input.prompt, attachments: [] }
          assertLive(entry); signal.throwIfAborted()
          return executeController(controller.sessionId, evidence.content, signal, evidence.attachments)
        }).then(() => { controller.state = signal.aborted ? 'canceled' : 'completed' }, error => {
          controller.state = signal.aborted ? 'canceled' : 'failed'; controller.error = message(error)
        })
        return turnStatus(controller)
      }
      if (method === 'controller.turn.status') {
        if (!entry.targetProcess?.isAlive() && controller.state === 'running') {
          controller.abort.abort(new Error('测试实例提前退出。'))
          await interruptController(controller.sessionId)
          return { ...turnStatus(controller), state: 'failed', error: '测试实例提前退出。' }
        }
        return turnStatus(controller)
      }
      if (method === 'controller.turn.abort') {
        controller.abort?.abort(new Error('控制回合已停止。'))
        await interruptController(controller.sessionId)
        await controller.pending?.catch(() => {})
        return turnStatus(controller)
      }
      if (method === 'controller.turn.finish') {
        if (controller.state === 'running' && !controller.disposing) {
          if (!options.finishController) throw new Error('当前宿主不支持结果提交后正常结束。')
          await options.finishController(controller.sessionId)
        }
        return turnStatus(controller)
      }
      if (method === 'controller.dispose') { await dispose(entry); return { disposed: true } }
      throw new Error('未知测试宿主操作。')
    },
  }
}
