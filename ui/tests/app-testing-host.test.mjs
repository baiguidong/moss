import { afterEach, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createAppTestingHost } from '../src/app-testing/host.mjs'
import { validateContract } from '../../packages/app-sdk/src/host/contracts.mjs'
const cleanup = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture(overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-testing-host-'))
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }))
  const appId = 'moss.self-test', instanceId = 'test-instance', version = '0.1.0', generation = 'generation-1'
  const dataDir = path.join(root, 'data'), pkg = path.join(root, 'package')
  await fs.mkdir(pkg); await fs.writeFile(path.join(pkg, 'engine.mjs'), '')
  const runId = randomUUID()
  await fs.mkdir(path.join(dataDir, 'runs', runId, 'evidence'), { recursive: true })
  const installed = { enabled: true, activeVersion: version, grants: ['testing:control', 'agent:permissions:bypass'] }
  let alive = false, launched = 0, closeTarget, releaseTurn
  const sessions = new Map(), calls = []
  const runtime = { installations: { get: () => installed }, runtimeForInstance: () => ({ generation }),
    getActivePackage: async () => ({ root: pkg }), publishHostEvent: async () => {} }
  const context = { appId, instanceId, version, generation, dataDir, grants: installed.grants,
    assertCurrent: () => {}, assertPermission: permission => { if (!installed.grants.includes(permission)) throw new Error('grant required') } }
  const host = createAppTestingHost({
    getRuntime: () => runtime, getSettings: () => ({ model: 'test-model', apiKey: 'must-not-leave-host' }), getRuntimeHome: () => '',
    executable: 'test', args: [], cwd: root, appVersion: 'host-test', getNodeExecutable: async () => 'node',
    launch: async options => {
      launched++; alive = true
      await fs.writeFile(path.join(options.run.home, 'settings.json'), JSON.stringify(options.settings))
      const exited = new Promise(resolve => { closeTarget = () => { alive = false; resolve() } })
      return { endpoint: 'http://127.0.0.1:1234', pid: 123, exited, isAlive: () => alive, close: async () => closeTarget() }
    },
    createController: async (run, config) => {
      calls.push({ kind: 'create', config })
      const sessionId = randomUUID()
      sessions.set(sessionId, { id: sessionId, appTestRunId: run.id, appTestInstanceId: instanceId })
      return sessionId
    },
    executeController: async () => new Promise(resolve => { releaseTurn = resolve }),
    interruptController: async () => releaseTurn?.(), stopController: async () => calls.push({ kind: 'stop' }),
    getSession: id => sessions.get(id), openSession: id => calls.push({ kind: 'open', id }),
    ...overrides,
  })
  cleanup.push(() => host.close())
  const request = (method, input = {}, overrides = {}) => {
    validateContract('moss.testing/v1', method, 'input', input)
    return host.handle(method, input, { ...context, ...overrides })
  }
  async function ready() {
    await request('target.open', { fixtures: [{ name: 'note.txt', content: 'fixture' }], title: 'sample' })
    while ((await request('target.status')).operation) await delay(1)
    await request('target.attach', { runId })
  }
  const create = () => request('controller.create', { runId, engineEntry: 'engine.mjs', disabledTools: ['browser_close'], title: 'test' })
  return { request, ready, create, installed, host, runId, dataDir, root, sessions, calls, context, alive: () => alive, launched: () => launched, exit: () => closeTarget() }
}
test('only Host metadata leaves environment; sessions bind an isolated target and current App engine', async () => {
  const f = await fixture()
  expect(await f.request('environment')).toEqual({ appVersion: 'host-test', model: 'test-model', appearance: {}, disabled: false, web: false })
  const web = await fixture({ web: true })
  expect((await web.request('environment')).web).toBe(true)
  await f.ready(); const controller = await f.create()
  expect(f.calls[0].config.args).toContain(path.join(f.dataDir, 'runs', f.runId, 'evidence'))
  expect(f.host.isControllerActive(f.sessions.get(controller.sessionId))).toBe(true)
  await f.request('target.open')
  expect(f.launched()).toBe(1)
  expect(await f.request('controller.caller')).toEqual({ sessionId: null })
  expect(await f.request('controller.caller', {}, { invocation: { surface: 'tool', sessionId: controller.sessionId } })).toEqual({ sessionId: controller.sessionId })
  await expect(f.request('target.reset')).rejects.toThrow('停止自测')
  await f.request('controller.turn.start', { sessionId: controller.sessionId, prompt: 'test' })
  await delay(1); await f.request('controller.turn.abort', { sessionId: controller.sessionId })
  await f.request('controller.dispose', { sessionId: controller.sessionId })
  expect(f.alive()).toBe(true)
  expect(f.host.isControllerActive(f.sessions.get(controller.sessionId))).toBe(false)
  await f.request('controller.open', { sessionId: controller.sessionId })
  await f.ready(); expect(f.launched()).toBe(1)
})
test('deactivation waits for the controller and closes its target; revoked grants reject new work', async () => {
  const f = await fixture(); await f.ready(); const { sessionId } = await f.create()
  await f.request('controller.turn.start', { sessionId, prompt: 'running' }); await delay(1)
  await f.host.deactivate('moss.self-test')
  expect(f.alive()).toBe(false); expect(f.host.isRunning()).toBe(false)
  expect(f.calls.some(call => call.kind === 'stop')).toBe(true)
  f.installed.grants = ['testing:control']
  await expect(f.request('target.open')).rejects.toThrow('grant')
})
test('evidence controller forwards native images and visible file attachments, rejecting missing evidence', async () => {
  const prompts = [], modes = [], attachments = []
  const f = await fixture({
    createController: async run => { modes.push(run.evidenceReview); return 'visual-review' },
    executeController: async (_sessionId, prompt, _signal, files) => { prompts.push(prompt); attachments.push(files) },
  })
  await f.ready()
  const { sessionId } = await f.request('controller.create', { runId: f.runId, engineEntry: 'engine.mjs', disabledTools: [], title: 'visual', evidenceReview: true })
  await fs.writeFile(path.join(f.dataDir, 'runs', f.runId, 'evidence', 'real.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
  await f.request('controller.turn.start', { sessionId, prompt: 'review', evidence: ['real.png'] })
  while ((await f.request('controller.turn.status', { sessionId })).state === 'running') await delay(1)
  expect(modes).toEqual([true]); expect(prompts[0][2].type).toBe('image')
  expect(attachments[0]).toEqual([await fs.realpath(path.join(f.dataDir, 'runs', f.runId, 'evidence', 'real.png'))])
  await f.request('controller.turn.start', { sessionId, prompt: 'review', evidence: ['missing.png'] })
  while ((await f.request('controller.turn.status', { sessionId })).state === 'running') await delay(1)
  expect((await f.request('controller.turn.status', { sessionId })).state).toBe('failed')
  expect(prompts).toHaveLength(1)
})
test('engine and evidence paths cannot escape the installed package and run directory', async () => {
  const f = await fixture(); await f.ready()
  await fs.writeFile(path.join(f.root, 'outside.mjs'), '')
  await expect(f.request('controller.create', { runId: f.runId, engineEntry: '../outside.mjs', disabledTools: [], title: 'test' })).rejects.toThrow('安装包')
  const evidence = path.join(f.dataDir, 'runs', f.runId, 'evidence')
  await fs.rm(evidence, { recursive: true }); await fs.symlink(f.root, evidence)
  await expect(f.create()).rejects.toThrow('证据目录')
})
test('an exited target fails a running controller, and unrelated sessions cannot open its history', async () => {
  const f = await fixture(); await f.ready(); const { sessionId } = await f.create()
  await f.request('controller.turn.start', { sessionId, prompt: 'running' }); await delay(1); f.exit()
  expect(await f.request('controller.turn.status', { sessionId })).toMatchObject({ state: 'failed', error: '测试实例提前退出。' })
  await expect(f.request('controller.open', { sessionId: 'unrelated' })).rejects.toThrow('不属于')
})
test('deactivation during controller creation waits and releases the late session; duplicate creation is rejected', async () => {
  let release, entered
  const ready = new Promise(resolve => { entered = resolve })
  const stopped = []
  const f = await fixture({
    createController: () => { entered(); return new Promise(resolve => { release = resolve }) },
    stopController: async id => { stopped.push(id) },
  })
  await f.ready()
  const creation = f.create()
  await ready
  await expect(f.create()).rejects.toThrow('运行标识无效')
  let disposed = false
  const closing = f.host.deactivate('moss.self-test').then(() => { disposed = true })
  await delay(1)
  expect(disposed).toBe(false)
  release('late-session')
  await expect(creation).rejects.toThrow('已停止')
  await closing
  expect(stopped).toContain('late-session')
  expect(f.alive()).toBe(false)
  expect(f.host.isRunning()).toBe(false)
})
