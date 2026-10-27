import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createAppComposer } from '../src/apps/app-composer.mjs'
import { AppRuntimeHost, defaultInstanceId, writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'
import { APP_ERROR_CODES, AppServiceError } from '../../packages/app-sdk/src/errors.mjs'

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('ordinary composer uses attested workspace, bounded resources and only owning App tools', async () => {
  const calls = []
  const provider = { id:'example/flows', appId:'example', title:'工作流', listAction:'list', resolveAction:'resolve' }
  const runtime = {
    listContributions: async ({kinds}) => kinds[0] === 'tools' ? {tools:[{localId:'read',name:'app__example__read'}]} : {resourceProviders:[provider]},
    requireContribution: async (_, id) => { assert.equal(id,provider.id); return provider },
    resolveContributionInstance: () => ({id:'default'}),
    invoke: async (app, instance, action, input, options) => { calls.push({app,action,input,options}); return action==='list' ? [{title:'测试',ref:{id:'one'},route:'javascript:bad'}] : {title:'测试',instruction:'read selected resource',tools:['read','foreign'],route:'#/flow/one'} },
  }
  const composer = createAppComposer({getRuntime:()=>runtime,getSession:()=>({id:'session',workspace:'/trusted',agentMode:'local'})})
  assert.equal((await composer.list({workspace:'/draft'})).items[0].route,'')
  assert.equal(calls[0].options.invocation.workspace,'/draft')
  const resolved = await composer.resolve({providerId:provider.id,intent:'use',ref:{id:'one'}},{sessionId:'session',workspace:'/spoof'})
  assert.equal(calls[1].options.invocation.workspace,'/trusted')
  assert.deepEqual(resolved.tools,['app__example__read'])
  assert.equal(calls.length,2) // no session creation or execution while preparing
  await assert.rejects(()=>composer.resolve({providerId:provider.id,intent:'execute'}), /无效/)
})


test('service-selected Apps can resolve their resources without reselecting a whole App', async () => {
  const session = { id: 'session', workspace: '/trusted', agentMode: 'local', appIds: [], appServiceIds: ['["example","sales"]'] }
  const provider = { id: 'example/flows', appId: 'example', listAction: 'list', resolveAction: 'resolve', toolScope: 'session' }
  let calls = 0
  const runtime = {
    requireContribution: async () => provider,
    resolveContributionInstance: () => ({ id: 'default' }),
    invoke: async () => { calls++; return { instruction: 'Use this resource', tools: ['read'] } },
    listContributions: async () => ({ tools: [{ localId: 'read', name: 'app__example__read' }] }),
  }
  const composer = createAppComposer({ getRuntime: () => runtime, getSession: () => session })
  await composer.resolve({ providerId: provider.id, intent: 'use' }, { sessionId: 'session', requireSelected: true })
  assert.equal(calls, 1)
  session.appServiceIds = ['["another-app","sales"]']
  await assert.rejects(() => composer.resolve({ providerId: provider.id, intent: 'use' }, { sessionId: 'session', requireSelected: true }), /加入会话/)
  assert.equal(calls, 1)
})

test('resource listing waits for an upgrade and uses its new provider action', async () => {
  const waiting = deferred(), release = deferred(), calls = []
  let provider = { id: 'example/projects', appId: 'example', title: 'Old projects', listAction: 'old.list' }
  const runtime = {
    listContributions: async () => ({ resourceProviders: [provider] }),
    transitionApp: async (appId, operation) => { assert.equal(appId, 'example'); waiting.resolve(); await release.promise; return operation() },
    resolveContributionInstance: () => ({ id: 'current-instance' }),
    invoke: async (...args) => { calls.push(args); return [{ title: 'Current project', ref: { id: 'current' } }] },
  }
  const composer = createAppComposer({ getRuntime: () => runtime, getSession: () => null })
  const pending = composer.list({ query: 'project', workspace: '/draft' })
  await waiting.promise
  assert.deepEqual(calls, [])
  provider = { ...provider, title: 'Current projects', listAction: 'new.list' }
  release.resolve()
  const result = await pending
  assert.equal(calls[0][1], 'current-instance')
  assert.equal(calls[0][2], 'new.list')
  assert.deepEqual(calls[0][3], { query: 'project', offset: 0, limit: 20 })
  assert.equal(calls[0][4].invocation.workspace, '/draft')
  assert.deepEqual(result.providers, [{ id: provider.id, title: 'Current projects' }])
})

test('stale resource listing retries once with fresh provider and instance metadata', async () => {
  let provider = { id: 'example/projects', appId: 'example', title: 'Old projects', listAction: 'old.list' }
  let instanceId = 'old-instance', waits = 0
  const calls = []
  const runtime = {
    listContributions: async () => ({ resourceProviders: [provider] }),
    transitionApp: async (_, operation) => { waits++; return operation() },
    resolveContributionInstance: () => ({ id: instanceId }),
    invoke: async (...args) => {
      calls.push(args)
      if (calls.length === 1) {
        provider = { ...provider, title: 'New projects', listAction: 'new.list' }; instanceId = 'new-instance'
        throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'App runtime generation is stale')
      }
      return [{ title: 'Current project', ref: { id: 'current' } }]
    },
  }
  const composer = createAppComposer({ getRuntime: () => runtime, getSession: () => null })
  const result = await composer.list()
  assert.equal(waits, 2)
  assert.deepEqual(calls.map(args => [args[1], args[2]]), [['old-instance', 'old.list'], ['new-instance', 'new.list']])
  assert.deepEqual(result.items[0].ref, { id: 'current' })
  assert.equal(result.providers[0].title, 'New projects')
})

test('listing retries are bounded, preserve other errors, and never replay resource resolution', async () => {
  const provider = { id: 'example/projects', appId: 'example', listAction: 'list', resolveAction: 'resolve' }
  let calls = 0, code = APP_ERROR_CODES.staleGeneration
  const runtime = {
    listContributions: async () => ({ resourceProviders: [provider] }),
    requireContribution: async () => provider,
    resolveContributionInstance: () => ({ id: 'default' }),
    invoke: async () => { calls++; throw new AppServiceError(code, 'test failure') },
  }
  const composer = createAppComposer({ getRuntime: () => runtime, getSession: () => null })
  await assert.rejects(composer.list(), { code })
  assert.equal(calls, 2)
  for (code of [APP_ERROR_CODES.invalidOutput, APP_ERROR_CODES.disabled, APP_ERROR_CODES.actionCanceled]) {
    calls = 0
    await assert.rejects(composer.list(), { code })
    assert.equal(calls, 1)
  }
  calls = 0; code = APP_ERROR_CODES.staleGeneration
  await assert.rejects(composer.resolve({ providerId: provider.id, intent: 'use' }), { code })
  assert.equal(calls, 1)
})

test('a provider removed during restart is omitted while other resources remain available', async () => {
  const removed = { id: 'example/removed', appId: 'example', listAction: 'list' }
  const kept = { id: 'other/kept', appId: 'other', title: 'Other projects', listAction: 'list' }
  let providers = [removed, kept], calls = []
  const runtime = {
    listContributions: async ({ appId }) => ({ resourceProviders: providers.filter(item => !appId || item.appId === appId) }),
    resolveContributionInstance: () => ({ id: 'default' }),
    invoke: async appId => {
      calls.push(appId)
      if (appId === removed.appId) { providers = [kept]; throw new AppServiceError(APP_ERROR_CODES.staleGeneration, 'stale') }
      return [{ title: 'Kept project', ref: { id: 'kept' } }]
    },
  }
  const composer = createAppComposer({ getRuntime: () => runtime, getSession: () => null })
  const result = await composer.list()
  assert.deepEqual(calls, ['example', 'other'])
  assert.deepEqual(result.providers, [{ id: kept.id, title: kept.title }])
  assert.equal(result.items[0].providerId, kept.id)
})

test('a real runtime restart during prepareRuntime recovers the composer list', { timeout: 15000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-composer-generation-'))
  const runtime = new AppRuntimeHost({ rootDir: root, nodeExecutable: process.execPath,
    processOptions: { handshakeTimeoutMs: 2000, shutdownTimeoutMs: 200, killTimeoutMs: 100 } })
  const entered = deferred(), release = deferred(), rejected = []
  let pending
  try {
    await runtime.initialize()
    const appId = 'fixture.composer', source = path.join(root, 'source')
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'app.moss.json'), JSON.stringify({
      schemaVersion: 2, id: appId, version: '1.0.0', displayName: 'Composer fixture', hostApi: '^3.0.0',
      backend: { entry: 'main.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand', actions: [{ name: 'list' }, { name: 'resolve' }] },
      contributes: { resourceProviders: [{ id: 'projects', title: 'Projects', schemes: ['fixture-project'], listAction: 'list', resolveAction: 'resolve' }] },
      permissions: [],
    }))
    const sdk = new URL('../../packages/app-sdk/src/index.mjs', import.meta.url).href
    await fs.writeFile(path.join(source, 'main.mjs'), `
import { AppBackendClient } from ${JSON.stringify(sdk)}
const backend = new AppBackendClient()
backend.registerAction('list', () => [{ title: 'Project', ref: { generation: Number(process.env.MOSS_APP_GENERATION) } }])
backend.registerAction('resolve', () => ({}))
backend.start()
`)
    await writePackageChecksums(source)
    await runtime.installFromDirectory(source)
    const instanceId = defaultInstanceId(appId), before = runtime.runtimeForInstance(appId, instanceId)
    const getCredentials = runtime.credentials.get.bind(runtime.credentials)
    let pause = true
    runtime.credentials.get = async (...args) => {
      const value = await getCredentials(...args)
      if (pause) { pause = false; entered.resolve(); await release.promise }
      return value
    }
    const invoke = runtime.actions.invoke.bind(runtime.actions)
    runtime.actions.invoke = async (...args) => {
      try { return await invoke(...args) } catch (error) { rejected.push(error.code); throw error }
    }
    const composer = createAppComposer({ getRuntime: () => runtime, getSession: () => null })
    pending = composer.list()
    pending.catch(() => {})
    await entered.promise
    await runtime.restartInstance(appId, instanceId)
    const current = runtime.runtimeForInstance(appId, instanceId)
    assert.ok(current.generation > before.generation)
    release.resolve()
    const result = await pending
    assert.deepEqual(rejected, [APP_ERROR_CODES.staleGeneration])
    assert.deepEqual(result.items[0].ref, { generation: current.generation })
    // The broker must still reject stale ordinary calls; only this read retries.
    assert.throws(() => runtime.authorizeInvocation(before), { code: APP_ERROR_CODES.staleGeneration })
  } finally {
    release.resolve()
    await pending?.catch(() => {})
    await runtime.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})
