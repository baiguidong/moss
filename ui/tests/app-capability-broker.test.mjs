import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppCapabilityBroker, AppProcessSupervisor, AppRuntimeHost, defaultInstanceId, writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'
import { validateAppManifest } from '../../packages/app-sdk/src/index.mjs'

const protocol = 'moss.fixture-dataset/v1'
const hostProtocol = 'moss.app-capabilities/v1'
const schema = { type: 'object', additionalProperties: true }
const bootstrap = `
import { randomUUID } from 'node:crypto'
const identity = { generation: Number(process.env.MOSS_APP_GENERATION), launchToken: process.env.MOSS_APP_LAUNCH_TOKEN }
const pending = new Map()
const send = (type, payload = {}, id = randomUUID()) => process.send?.({ version: 1, id, type, timestamp: Date.now(), payload: { ...payload, ...identity } })
process.on('message', message => {
  if (message.type === 'service.init') send('service.ready', {}, message.id)
  if (message.type === 'service.ping') send('service.pong', {}, message.id)
  if (message.type === 'service.shutdown') process.exit(0)
  if (message.type === 'action.invoke') {
    if (process.env.MOSS_APP_ID === 'fixture.dataset-provider') {
      const result = message.payload.name === 'dataset.query' ? { resourceId: 'result-1', rowCount: 1 }
        : message.payload.name === 'dataset.result.read' ? { text: 'customer_id\\n1\\n'.slice(message.payload.input.offset, message.payload.input.offset + message.payload.input.limit), nextOffset: null }
        : { columns: ['customer_id'], callerAppId: message.payload.source?.callerAppId || null,
          value: message.payload.input.value || null }
      send('action.result', { requestId: message.id, result }, message.id)
    } else if (process.env.MOSS_APP_ID === 'fixture.bridge-provider') {
      const { hostRequestId, spoofedActionRequestId, ...input } = message.payload.input || {}
      const hostId = hostRequestId || 'host-' + message.id
      pending.set(hostId, message.id)
      send('host.request', { protocol: '${hostProtocol}', method: 'provider.invoke', input,
        ...(spoofedActionRequestId ? { actionRequestId: spoofedActionRequestId } : {}) }, hostId)
    } else {
      const hostId = 'host-' + message.id
      pending.set(hostId, message.id)
      send('host.request', { protocol: '${hostProtocol}', method: message.payload.name === 'consume.read' ? 'resource.read'
        : message.payload.name === 'consume.tool' ? 'tool.invoke' : 'provider.invoke',
        input: message.payload.input, actionRequestId: message.id }, hostId)
    }
  }
  if (message.type === 'host.response') {
    const actionId = pending.get(message.payload.requestId)
    pending.delete(message.payload.requestId)
    if (actionId && message.payload.ok) send('action.result', { requestId: actionId, result: message.payload.result }, actionId)
    else if (actionId) send('action.error', { requestId: actionId, error: message.payload.error }, actionId)
  }
})
send('service.hello', { appId: process.env.MOSS_APP_ID, version: process.env.MOSS_APP_VERSION,
  apiVersion: 1, instanceId: process.env.MOSS_APP_INSTANCE_ID }, 'hello')
`

async function fixture(root, id, appCapabilities, permissions, hostProtocols = [], contributes) {
  const source = path.join(root, id)
  await mkdir(path.join(source, 'dist'), { recursive: true })
  await mkdir(path.join(source, 'schemas'))
  await writeFile(path.join(source, 'schemas', 'object.json'), JSON.stringify(schema))
  await writeFile(path.join(source, 'dist', 'backend.mjs'), bootstrap)
  await writeFile(path.join(source, 'app.moss.json'), JSON.stringify({
    schemaVersion: 2, id, version: '1.0.0', displayName: id,
    hostApi: appCapabilities?.usesTools?.length ? '^3.19.0' : '^3.18.0',
    backend: { entry: 'dist/backend.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand',
      actions: id.endsWith('provider') ? ['dataset.describe', 'dataset.query', 'dataset.result.read'].map(name => ({ name, inputSchema: 'schemas/object.json', outputSchema: 'schemas/object.json' }))
        : [{ name: 'consume' }, { name: 'consume.read' }, { name: 'consume.tool' }] },
    host: { protocols: hostProtocols }, permissions, appCapabilities, contributes,
  }))
  await writePackageChecksums(source)
  return source
}

test('cross-App calls use declared contracts, scoped references and current grants', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-app-capabilities-'))
  let runtime = await new AppRuntimeHost({ rootDir: path.join(root, 'host'), processOptions: { handshakeTimeoutMs: 1500 } }).initialize()
  try {
    const providerId = 'fixture.dataset-provider', consumerId = 'fixture.dataset-consumer', otherConsumerId = 'fixture.other-consumer'
    const provider = await fixture(root, providerId, { provides: [{ protocol, methods: [
      { name: 'describe', action: 'dataset.describe', permission: 'dataset:read', effect: 'read' },
      { name: 'query', action: 'dataset.query', permission: 'dataset:read', effect: 'read', resourceReadMethod: 'result.read' },
      { name: 'result.read', action: 'dataset.result.read', permission: 'dataset:read', effect: 'read' },
    ] }] }, ['dataset:read'])
    const consumer = await fixture(root, consumerId, { requires: [{ protocol }] }, ['apps:invoke'], [hostProtocol])
    const otherConsumer = await fixture(root, otherConsumerId, { requires: [{ protocol }] }, ['apps:invoke'], [hostProtocol])
    await runtime.installFromDirectory(provider)
    await runtime.installFromDirectory(consumer)
    await runtime.installFromDirectory(otherConsumer)
    const providerInstance = defaultInstanceId(providerId), consumerInstance = defaultInstanceId(consumerId), otherInstance = defaultInstanceId(otherConsumerId)
    await runtime.setInstanceEnabled(providerId, providerInstance, true)
    await runtime.setInstanceEnabled(consumerId, consumerInstance, true)
    await runtime.setInstanceEnabled(otherConsumerId, otherInstance, true)
    const discover = () => runtime.requestHostCapability(consumerId, consumerInstance, hostProtocol, 'providers.list', { protocol })
    const listed = await discover()
    expect(listed.unmet).toEqual([])
    expect(listed.providers).toHaveLength(1)
    expect(listed.providers[0]).toMatchObject({ appId: providerId, protocol, status: 'available', methods: ['describe', 'query', 'result.read'] })
    const providerRef = listed.providers[0].providerRef
    const call = (method = 'describe', ref = providerRef) => runtime.invoke(consumerId, consumerInstance, 'consume', {
      providerRef: ref, method, input: { value: 'sample' },
    })
    expect(await call()).toMatchObject({ value: { columns: ['customer_id'], callerAppId: consumerId, value: 'sample' } })
    const query = await call('query')
    expect(query.value.rowCount).toBe(1)
    expect(typeof query.value.resourceRef).toBe('string')
    expect(query.value.resourceId).toBeUndefined()
    expect(await runtime.invoke(consumerId, consumerInstance, 'consume.read', { resourceRef: query.value.resourceRef, offset: 0, limit: 100 }))
      .toEqual({ text: 'customer_id\n1\n', nextOffset: null })
    await expect(runtime.invoke(otherConsumerId, otherInstance, 'consume', { providerRef, method: 'describe', input: {} }))
      .rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    await expect(runtime.invoke(otherConsumerId, otherInstance, 'consume.read', { resourceRef: query.value.resourceRef, offset: 0, limit: 100 }))
      .rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    await runtime.shutdown()
    runtime = await new AppRuntimeHost({ rootDir: path.join(root, 'host'), processOptions: { handshakeTimeoutMs: 1500 } }).initialize()
    expect(await call()).toMatchObject({ value: { callerAppId: consumerId } })
    const upgrade = path.join(root, 'provider-upgrade')
    await cp(provider, upgrade, { recursive: true })
    const upgradedManifest = JSON.parse(await readFile(path.join(upgrade, 'app.moss.json'), 'utf8'))
    upgradedManifest.version = '2.0.0'
    upgradedManifest.appCapabilities.provides[0].protocol = 'moss.fixture-dataset/v2'
    await writeFile(path.join(upgrade, 'app.moss.json'), JSON.stringify(upgradedManifest))
    await writePackageChecksums(upgrade)
    await runtime.installFromDirectory(upgrade)
    await runtime.activateVersion(providerId, '2.0.0')
    await expect(call()).rejects.toMatchObject({ code: 'APP_HOST_UNAVAILABLE', details: { reason: 'incompatible_version' } })
    await runtime.activateVersion(providerId, '1.0.0')
    expect(await call()).toMatchObject({ value: { callerAppId: consumerId } })
    await expect(call('other')).rejects.toMatchObject({ code: 'APP_HOST_UNAVAILABLE', details: { reason: 'incompatible_version' } })
    await expect(call('describe', providerRef.slice(0, -2) + 'xx')).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    await runtime.setInstanceEnabled(providerId, providerInstance, false)
    expect((await discover()).providers[0].status).toBe('instance_disabled')
    await expect(call()).rejects.toMatchObject({ code: 'APP_HOST_UNAVAILABLE', details: { reason: 'instance_disabled' } })
    await runtime.setInstanceEnabled(providerId, providerInstance, true)
    await runtime.setAppGrants(providerId, [])
    expect((await discover()).providers[0].status).toBe('permission_denied')
    await expect(call()).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    await expect(runtime.invoke(consumerId, consumerInstance, 'consume.read', { resourceRef: query.value.resourceRef, offset: 0, limit: 100 }))
      .rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    await runtime.setAppGrants(providerId, ['dataset:read'])
    await runtime.setAppGrants(consumerId, [])
    await expect(discover()).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    await runtime.setAppGrants(consumerId, ['apps:invoke'])
    await runtime.uninstall(providerId)
    await expect(call()).rejects.toMatchObject({ code: 'APP_HOST_UNAVAILABLE', details: { reason: 'not_installed' } })
  } finally {
    await runtime.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

test('declared consumers discover and call existing static and MCP tools through the Host', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-app-tools-'))
  const runtime = await new AppRuntimeHost({ rootDir: path.join(root, 'host'), processOptions: { handshakeTimeoutMs: 1500 } }).initialize()
  let releaseCall
  try {
    const providerId = 'fixture.dataset-provider', consumerId = 'fixture.dataset-consumer', otherId = 'fixture.other-consumer'
    const provider = await fixture(root, providerId, undefined, ['dataset:read', 'mcp:manage', 'mcp:connect'], ['moss.host/v1'], {
      tools: [
        { id: 'describe', title: 'Describe', description: 'Describe a dataset', action: 'dataset.describe',
          inputSchema: 'schemas/object.json', permission: 'dataset:read', effect: 'read' },
        { id: 'host_info', title: 'Host info', description: 'Read Host version', execution: 'host',
          host: { protocol: 'moss.host/v1', method: 'info.get' }, inputSchema: 'schemas/object.json', effect: 'read' },
      ],
    })
    const consumer = await fixture(root, consumerId, { usesTools: [{ appId: providerId, tools: ['describe', 'host_info', 'execute_sql'] }] },
      ['apps:invoke'], [hostProtocol])
    const other = await fixture(root, otherId, undefined, ['apps:invoke'], [hostProtocol])
    for (const source of [provider, consumer, other]) await runtime.installFromDirectory(source)
    const providerInstance = defaultInstanceId(providerId)
    const consumerInstance = defaultInstanceId(consumerId)
    const otherInstance = defaultInstanceId(otherId)
    const serviceId = `mcp/${providerInstance}/server-1`
    const secondServiceId = `mcp/${providerInstance}/server-2`
    runtime.registerHostHandler('moss.host/v1', 'info.get', () => ({ hostApiVersion: '3.19.0',
      sdkVersion: '3.11.0', manifestSchemaVersion: 2, contractHash: 'a', sdkHash: 'b' }))
    let actualCalls = 0
    let gate = null
    runtime.setAppToolBridge({
      async discoverBridgeTools({ targetAppId, targetInstanceId, toolNames }) {
        expect(targetAppId).toBe(providerId)
        expect(targetInstanceId).toBe(providerInstance)
        expect(toolNames).toEqual(['describe', 'host_info', 'execute_sql'])
        return [{ appId: providerId, instanceId: providerInstance, serviceId, serviceName: 'database-primary',
          revision: 'a'.repeat(64), name: 'execute_sql', description: 'Execute SQL',
          inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } },
        { appId: providerId, instanceId: providerInstance, serviceId: secondServiceId, serviceName: 'database-archive',
          revision: 'c'.repeat(64), name: 'execute_sql', description: 'Execute SQL on another service',
          inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } },
        { appId: providerId, instanceId: providerInstance, serviceId,
          revision: 'b'.repeat(64), name: 'private_tool', description: 'Hidden tool', inputSchema: { type: 'object' } }]
      },
      async invokeBridgeTool({ authorizeDispatch, arguments: args, revision, toolName, serviceId: invokedServiceId }) {
        if (gate) { gate.entered(); await gate.resume }
        authorizeDispatch()
        expect(revision).toBe((invokedServiceId === serviceId ? 'a' : 'c').repeat(64))
        expect(toolName).toBe('execute_sql')
        actualCalls += 1
        return { content: [{ type: 'text', text: args.large ? 'x'.repeat(800_000)
          : invokedServiceId === serviceId ? 'row 1' : 'row 2' }] }
      },
    })
    const list = () => runtime.requestHostCapability(consumerId, consumerInstance,
      hostProtocol, 'tools.list', { appId: providerId })
    const tools = (await list()).tools
    expect(tools.map(item => [item.source, item.serviceId, item.name])).toEqual([
      ['contribution', null, 'describe'], ['contribution', null, 'host_info'],
      ['mcp', serviceId, 'execute_sql'], ['mcp', secondServiceId, 'execute_sql'],
    ])
    expect(tools.every(item => item.appId === providerId && item.instanceId === providerInstance && item.toolRef)).toBe(true)
    expect(tools.map(item => item.serviceName)).toEqual([null, null, 'database-primary', 'database-archive'])
    const staticTool = tools[0], hostTool = tools[1], dynamicTool = tools[2], secondDynamicTool = tools[3]
    expect(await runtime.invoke(consumerId, consumerInstance, 'consume.tool', {
      toolRef: staticTool.toolRef, arguments: { value: 'sample' },
    })).toMatchObject({ result: { callerAppId: consumerId, value: 'sample' } })
    expect(await runtime.invoke(consumerId, consumerInstance, 'consume.tool', {
      toolRef: hostTool.toolRef, arguments: {},
    })).toMatchObject({ result: { hostApiVersion: '3.19.0' } })
    expect(await runtime.invoke(consumerId, consumerInstance, 'consume.tool', {
      toolRef: dynamicTool.toolRef, arguments: { sql: 'select 1' },
    })).toMatchObject({ result: { content: [{ text: 'row 1' }] } })
    expect(await runtime.invoke(consumerId, consumerInstance, 'consume.tool', {
      toolRef: secondDynamicTool.toolRef, arguments: { sql: 'select 2' },
    })).toMatchObject({ result: { content: [{ text: 'row 2' }] } })
    expect(actualCalls).toBe(2)
    await expect(runtime.requestHostCapability(otherId, otherInstance, hostProtocol, 'tools.list', { appId: providerId }))
      .rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    await expect(runtime.invoke(otherId, otherInstance, 'consume.tool', {
      toolRef: dynamicTool.toolRef, arguments: { sql: 'select 1' },
    })).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    await expect(runtime.requestHostCapability(consumerId, consumerInstance, hostProtocol, 'tool.invoke', {
      toolRef: dynamicTool.toolRef, arguments: { sql: 'select 1' },
    })).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    await expect(runtime.invoke(consumerId, consumerInstance, 'consume.tool', {
      toolRef: dynamicTool.toolRef, arguments: { large: true },
    })).rejects.toMatchObject({ code: 'APP_RESOURCE_EXHAUSTED' })

    let entered
    const started = new Promise(resolve => { entered = resolve })
    const resume = new Promise(resolve => { releaseCall = resolve })
    gate = { entered, resume }
    const blocked = runtime.invoke(consumerId, consumerInstance, 'consume.tool', {
      toolRef: dynamicTool.toolRef, arguments: { sql: 'select 1' },
    })
    await started
    await runtime.installations.upsert(providerId, { grants: ['dataset:read', 'mcp:manage'] })
    releaseCall()
    releaseCall = null
    await expect(blocked).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    expect(actualCalls).toBe(3) // The oversized result ran; the revoked call never reached the tool.
    gate = null
    await runtime.installations.upsert(providerId, { grants: ['mcp:manage', 'mcp:connect'] })
    await expect(runtime.invoke(consumerId, consumerInstance, 'consume.tool', {
      toolRef: staticTool.toolRef, arguments: {},
    })).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    await runtime.installations.upsert(consumerId, { grants: [] })
    await expect(list()).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
  } finally {
    releaseCall?.()
    await runtime.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

test('queued cross-App Actions recheck provider and consumer grants before dispatch', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-app-capability-dispatch-'))
  const runtime = await new AppRuntimeHost({ rootDir: path.join(root, 'host'), processOptions: { handshakeTimeoutMs: 1500 } }).initialize()
  let resumeStart
  try {
    const providerId = 'fixture.dataset-provider', consumerId = 'fixture.dataset-consumer'
    const provider = await fixture(root, providerId, { provides: [{ protocol, methods: [
      { name: 'query', action: 'dataset.query', permission: 'dataset:read', effect: 'read', resourceReadMethod: 'result.read' },
      { name: 'result.read', action: 'dataset.result.read', permission: 'dataset:read', effect: 'read' },
    ] }] }, ['dataset:read'])
    const consumer = await fixture(root, consumerId, { requires: [{ protocol }] }, ['apps:invoke'], [hostProtocol])
    await runtime.installFromDirectory(provider)
    await runtime.installFromDirectory(consumer)
    const providerInstance = defaultInstanceId(providerId), consumerInstance = defaultInstanceId(consumerId)
    await runtime.setInstanceEnabled(providerId, providerInstance, true)
    await runtime.setInstanceEnabled(consumerId, consumerInstance, true)
    const providerRef = (await runtime.requestHostCapability(consumerId, consumerInstance,
      hostProtocol, 'providers.list', { protocol })).providers[0].providerRef
    const query = await runtime.invoke(consumerId, consumerInstance, 'consume', {
      providerRef, method: 'query', input: {},
    })
    const resourceRef = query.value.resourceRef
    const providerKey = runtime.runtimeForInstance(providerId, providerInstance).key
    const originalStart = runtime.supervisor.start.bind(runtime.supervisor)
    const originalSend = runtime.supervisor.send.bind(runtime.supervisor)
    let gate = null, providerDispatches = 0
    runtime.supervisor.start = async (key, options) => {
      if (key === providerKey && gate) {
        const current = gate
        gate = null
        current.entered()
        await current.resume
      }
      return originalStart(key, options)
    }
    runtime.supervisor.send = (hosted, message, callback) => {
      if (hosted.definition.appId === providerId && message.type === 'action.invoke') providerDispatches += 1
      return originalSend(hosted, message, callback)
    }
    const dispatchesBeforeRevocation = providerDispatches
    const callAfterRevocation = async (action, input, revoke) => {
      let entered
      const started = new Promise(resolve => { entered = resolve })
      const resume = new Promise(resolve => { resumeStart = resolve })
      gate = { entered, resume }
      const call = runtime.invoke(consumerId, consumerInstance, action, input)
      await Promise.race([started, call.then(
        () => { throw new Error('Cross-App call finished before the dispatch gate') },
        error => { throw error },
      )])
      await revoke()
      resumeStart()
      resumeStart = null
      await expect(call).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
      expect(providerDispatches).toBe(dispatchesBeforeRevocation)
    }
    await callAfterRevocation('consume', { providerRef, method: 'query', input: {} },
      () => runtime.installations.upsert(providerId, { grants: [] }))
    await runtime.installations.upsert(providerId, { grants: ['dataset:read'] })
    await callAfterRevocation('consume.read', { resourceRef, offset: 0, limit: 100 },
      () => runtime.installations.upsert(providerId, { grants: [] }))
    await runtime.installations.upsert(providerId, { grants: ['dataset:read'] })
    await callAfterRevocation('consume.read', { resourceRef, offset: 0, limit: 100 },
      () => runtime.installations.upsert(consumerId, { grants: [] }))
  } finally {
    resumeStart?.()
    await runtime.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

test('a provider cannot hide or spoof its inbound Action id to make a nested cross-App call', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-app-nested-capabilities-'))
  const runtime = await new AppRuntimeHost({ rootDir: path.join(root, 'host'), processOptions: { handshakeTimeoutMs: 1500 } }).initialize()
  try {
    const providerId = 'fixture.dataset-provider'
    const bridgeId = 'fixture.bridge-provider'
    const consumerId = 'fixture.bridge-consumer'
    const bridgeProtocol = 'moss.fixture-bridge/v1'
    const provider = await fixture(root, providerId, { provides: [{ protocol, methods: [
      { name: 'describe', action: 'dataset.describe', permission: 'dataset:read', effect: 'read' },
    ] }] }, ['dataset:read'])
    const bridge = await fixture(root, bridgeId, {
      requires: [{ protocol }],
      provides: [{ protocol: bridgeProtocol, methods: [
        { name: 'describe', action: 'dataset.describe', permission: 'dataset:read', effect: 'read' },
      ] }],
    }, ['apps:invoke', 'dataset:read'], [hostProtocol])
    const consumer = await fixture(root, consumerId, { requires: [{ protocol: bridgeProtocol }] }, ['apps:invoke'], [hostProtocol])
    for (const source of [provider, bridge, consumer]) await runtime.installFromDirectory(source)
    for (const id of [providerId, bridgeId, consumerId]) await runtime.setInstanceEnabled(id, defaultInstanceId(id), true)
    const datasetRef = (await runtime.requestHostCapability(bridgeId, defaultInstanceId(bridgeId), hostProtocol,
      'providers.list', { protocol })).providers[0].providerRef
    const bridgeRef = (await runtime.requestHostCapability(consumerId, defaultInstanceId(consumerId), hostProtocol,
      'providers.list', { protocol: bridgeProtocol })).providers[0].providerRef
    const input = { providerRef: datasetRef, method: 'describe', input: { value: 'direct' }, hostRequestId: 'cached-bridge-request' }

    // The same request succeeds when the bridge is called directly, and leaves
    // a cached Host response that must not bypass the nested-call check.
    expect(await runtime.invoke(bridgeId, defaultInstanceId(bridgeId), 'dataset.describe', input))
      .toMatchObject({ value: { callerAppId: bridgeId, value: 'direct' } })
    await expect(runtime.invoke(consumerId, defaultInstanceId(consumerId), 'consume', {
      providerRef: bridgeRef, method: 'describe', input,
    })).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
    await expect(runtime.invoke(consumerId, defaultInstanceId(consumerId), 'consume', {
      providerRef: bridgeRef, method: 'describe', input: {
        providerRef: datasetRef, method: 'describe', input: {}, spoofedActionRequestId: 'unrelated-action',
      },
    })).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
  } finally {
    await runtime.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

test('a canceled inbound App Action remains blocked until its reply or Backend shutdown', async () => {
  const supervisor = new AppProcessSupervisor({ actionCancelGraceMs: 100 })
  const hosted = { definition: { generation: 1 }, launchToken: 'test', handshakeState: 'ready',
    pending: new Map(), hostRequests: new Map(), canceledActionIds: new Set(), seenReplies: new Set(), activeAppInvocations: new Set(),
    actionCancelTimers: new Map(), stopping: false }
  supervisor.processes.set('runtime', hosted)
  supervisor.send = () => true
  supervisor.scheduleIdleStop = () => {}
  let stops = 0
  supervisor.stopNow = async () => {
    stops += 1
    supervisor.clearActionWork(hosted, new Error('stopped'))
  }
  const pending = id => {
    hosted.activeAppInvocations.add(id)
    hosted.pending.set(id, { timeout: setTimeout(() => {}, 5_000), reject() {} })
  }

  pending('responds')
  expect(supervisor.cancel('runtime', 'responds')).toBe(true)
  expect(hosted.activeAppInvocations.has('responds')).toBe(true)
  supervisor.handleMessage('runtime', hosted, { version: 1, id: 'responds', type: 'action.result', timestamp: Date.now(),
    payload: { generation: 1, launchToken: 'test', requestId: 'responds', result: {} } })
  expect(hosted.activeAppInvocations.has('responds')).toBe(false)
  await new Promise(resolve => setTimeout(resolve, 140))
  expect(stops).toBe(0)

  pending('ignores-cancel')
  expect(supervisor.cancel('runtime', 'ignores-cancel')).toBe(true)
  expect(hosted.activeAppInvocations.has('ignores-cancel')).toBe(true)
  await new Promise(resolve => setTimeout(resolve, 140))
  expect(stops).toBe(1)
  expect(hosted.activeAppInvocations.size).toBe(0)
})

function isolatedBroker() {
  const providerId = 'fixture.dataset-provider'
  const consumerId = 'fixture.dataset-consumer'
  const providerInstanceId = defaultInstanceId(providerId)
  const consumerInstanceId = defaultInstanceId(consumerId)
  const providerInstallation = { appId: providerId, incarnationId: '00000000-0000-4000-8000-000000000001',
    createdAt: 1, activeVersion: '1.0.0', enabled: true,
    grants: ['dataset:query', 'dataset:read'] }
  const consumerInstallation = { appId: consumerId, incarnationId: '00000000-0000-4000-8000-000000000002',
    createdAt: 2, activeVersion: '1.0.0', enabled: true,
    grants: ['apps:invoke'] }
  const installations = new Map([[providerId, providerInstallation], [consumerId, consumerInstallation]])
  const instances = new Map([
    [providerInstanceId, { id: providerInstanceId, appId: providerId,
      incarnationId: '00000000-0000-4000-8000-000000000003', createdAt: 3, enabled: true, config: {} }],
    [consumerInstanceId, { id: consumerInstanceId, appId: consumerId,
      incarnationId: '00000000-0000-4000-8000-000000000004', createdAt: 4, enabled: true, config: {} }],
  ])
  const providerMethods = [
    { name: 'query', action: 'provider.query', permission: 'dataset:query', resourceReadMethod: 'result.read' },
    { name: 'result.read', action: 'provider.read', permission: 'dataset:read' },
  ]
  const packages = new Map([
    [providerId, { root: '', manifest: { id: providerId, version: '1.0.0', displayName: 'Provider',
      backend: {}, appCapabilities: { provides: [{ protocol, methods: providerMethods }] } } }],
    [consumerId, { root: '', manifest: { id: consumerId, version: '1.0.0', displayName: 'Consumer',
      appCapabilities: { requires: [{ protocol }] } } }],
  ])
  let readResult = () => ({ text: 'abc', nextOffset: 3 })
  const invocations = []
  const auditLogs = []
  const runtime = {
    rootDir: '',
    installations: { get: id => installations.get(id), list: () => [...installations.values()] },
    instances: { get: id => instances.get(id), list: id => [...instances.values()].filter(item => item.appId === id) },
    getActivePackage: async id => packages.get(id),
    runtimeForInstance: () => ({ key: 'provider-runtime' }),
    supervisor: { status: () => ({ state: 'running' }) },
    credentials: { get: async () => ({}) },
    invoke: async (_appId, _instanceId, action, input, options) => {
      invocations.push({ action, input, options })
      return action === 'provider.query' ? { resourceId: 'result-1' } : readResult(input)
    },
    logs: { append: async entry => { auditLogs.push(entry) } },
  }
  const broker = new AppCapabilityBroker(runtime)
  broker.secret = Buffer.alloc(32, 7)
  const context = { appId: consumerId, instanceId: consumerInstanceId, owner: { key: 'host' },
    requestId: 'consumer-request', assertCurrent() {} }
  return { broker, runtime, context, providerInstallation, consumerInstallation, providerMethods, invocations, auditLogs,
    setReadResult: value => { readResult = value } }
}

test('provider grant revocation while its package is loading blocks dispatch', async () => {
  const { broker, runtime, context, providerInstallation, invocations } = isolatedBroker()
  const providerRef = (await broker.list({ protocol }, context)).providers[0].providerRef
  const loadPackage = runtime.getActivePackage
  let resumeLoad
  let loading
  const loadingPromise = new Promise(resolve => { loading = resolve })
  const resumePromise = new Promise(resolve => { resumeLoad = resolve })
  runtime.getActivePackage = async id => {
    if (id === 'fixture.dataset-provider') {
      loading()
      await resumePromise
    }
    return loadPackage(id)
  }
  const call = broker.invoke({ providerRef, method: 'query', input: {} }, context)
  await loadingPromise
  providerInstallation.grants = ['dataset:read']
  resumeLoad()
  await expect(call).rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
  expect(invocations).toHaveLength(0)
})

test('provider removal while its package load fails reports the missing installation', async () => {
  const { broker, runtime, context, invocations } = isolatedBroker()
  const providerId = 'fixture.dataset-provider'
  const providerRef = (await broker.list({ protocol }, context)).providers[0].providerRef
  const getInstallation = runtime.installations.get
  const loadPackage = runtime.getActivePackage
  let loading, resumeLoad
  const started = new Promise(resolve => { loading = resolve })
  const resume = new Promise(resolve => { resumeLoad = resolve })
  runtime.getActivePackage = async id => {
    if (id === providerId) {
      loading()
      await resume
      throw new Error('Package removed during load')
    }
    return loadPackage(id)
  }
  const call = broker.invoke({ providerRef, method: 'query', input: {} }, context)
  await started
  runtime.installations.get = id => id === providerId ? undefined : getInstallation(id)
  resumeLoad()
  await expect(call).rejects.toMatchObject({ code: 'APP_HOST_UNAVAILABLE', details: { reason: 'not_installed' } })
  expect(invocations).toHaveLength(0)
})

test('discovery reflects provider revocation during credential lookup', async () => {
  const { broker, runtime, context, providerInstallation } = isolatedBroker()
  let lookupStarted, resumeLookup
  const started = new Promise(resolve => { lookupStarted = resolve })
  const resume = new Promise(resolve => { resumeLookup = resolve })
  runtime.credentials.get = async () => {
    lookupStarted()
    await resume
    return {}
  }
  const listing = broker.list({ protocol }, context)
  await started
  providerInstallation.grants = []
  resumeLookup()
  const provider = (await listing).providers[0]
  expect(provider).toMatchObject({ status: 'permission_denied', methods: [], providerRef: null })
})

test('discovery preserves revocation status when credential lookup fails', async () => {
  const { broker, runtime, context, providerInstallation } = isolatedBroker()
  let lookupStarted, resumeLookup
  const started = new Promise(resolve => { lookupStarted = resolve })
  const resume = new Promise(resolve => { resumeLookup = resolve })
  runtime.credentials.get = async () => {
    lookupStarted()
    await resume
    throw new Error('Credential store unavailable')
  }
  const listing = broker.list({ protocol }, context)
  await started
  providerInstallation.grants = []
  resumeLookup()
  const provider = (await listing).providers[0]
  expect(provider).toMatchObject({ status: 'permission_denied', methods: [], providerRef: null })
})

test('resource references recheck both producer and reader permissions and methods', async () => {
  const { broker, context, providerInstallation, consumerInstallation, providerMethods, invocations, auditLogs } = isolatedBroker()
  const providerRef = (await broker.list({ protocol }, context)).providers[0].providerRef
  const { value } = await broker.invoke({ providerRef, method: 'query', input: {} }, context)
  const resourceRef = value.resourceRef
  providerInstallation.grants = ['dataset:read']
  await expect(broker.read({ resourceRef, offset: 0, limit: 10 }, context))
    .rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
  expect(invocations).toHaveLength(1)
  expect(auditLogs.at(-1)).toMatchObject({ level: 'warn', details: {
    providerAppId: 'fixture.dataset-provider', method: 'result.read', outcome: 'APP_PERMISSION_DENIED',
  } })
  expect(JSON.stringify(auditLogs.at(-1))).not.toContain('result-1')

  providerInstallation.grants = ['dataset:query']
  expect((await broker.list({ protocol }, context)).providers[0]).toMatchObject({ status: 'permission_denied', methods: [] })
  await expect(broker.read({ resourceRef, offset: 0, limit: 10 }, context))
    .rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })

  providerInstallation.grants = ['dataset:query', 'dataset:read']
  providerMethods[0].action = 'provider.query.v2'
  await expect(broker.read({ resourceRef, offset: 0, limit: 10 }, context))
    .rejects.toMatchObject({ code: 'APP_HOST_UNAVAILABLE', details: { reason: 'incompatible_version' } })
  expect(invocations).toHaveLength(1)

  // Matching millisecond timestamps do not make a removed installation or
  // consumer installation look like the old one.
  providerMethods[0].action = 'provider.query'
  providerInstallation.incarnationId = '00000000-0000-4000-8000-000000000009'
  await expect(broker.read({ resourceRef, offset: 0, limit: 10 }, context))
    .rejects.toMatchObject({ code: 'APP_HOST_UNAVAILABLE', details: { reason: 'not_installed' } })
  providerInstallation.incarnationId = '00000000-0000-4000-8000-000000000001'
  consumerInstallation.incarnationId = '00000000-0000-4000-8000-000000000008'
  await expect(broker.read({ resourceRef, offset: 0, limit: 10 }, context))
    .rejects.toMatchObject({ code: 'APP_PERMISSION_DENIED' })
})

test('resource reads reject unsafe offsets, gaps and references that expire during a read', async () => {
  const { broker, context, setReadResult } = isolatedBroker()
  const providerRef = (await broker.list({ protocol }, context)).providers[0].providerRef
  const { value } = await broker.invoke({ providerRef, method: 'query', input: {} }, context)
  const resourceRef = value.resourceRef
  const validateRead = broker.definition().methods['resource.read'].validateInput
  expect(() => validateRead({ resourceRef, offset: Number.MAX_SAFE_INTEGER, limit: 2 }))
    .toThrow(/range/)

  setReadResult(() => ({ text: 'abc', nextOffset: 4 }))
  await expect(broker.read({ resourceRef, offset: 0, limit: 10 }, context))
    .rejects.toMatchObject({ code: 'APP_HOST_PROTOCOL_ERROR' })
  setReadResult(() => ({ text: 'abc', nextOffset: 3 }))
  expect(await broker.read({ resourceRef, offset: 0, limit: 10 }, context))
    .toEqual({ text: 'abc', nextOffset: 3 })

  const binding = broker.verify(resourceRef, context, 'resource')
  const expiredRef = broker.sign({ ...binding, expiresAt: Date.now() - 1 })
  await expect(broker.read({ resourceRef: expiredRef, offset: 0, limit: 10 }, context))
    .rejects.toMatchObject({ code: 'APP_HOST_UNAVAILABLE', details: { reason: 'expired' } })
  const expiringRef = broker.sign({ ...binding, expiresAt: Date.now() + 10 })
  setReadResult(async () => {
    await new Promise(resolve => setTimeout(resolve, 30))
    return { text: 'abc', nextOffset: null }
  })
  await expect(broker.read({ resourceRef: expiringRef, offset: 0, limit: 10 }, context))
    .rejects.toMatchObject({ code: 'APP_HOST_UNAVAILABLE', details: { reason: 'expired' } })
})

test('cross-App manifests reject undeclared or unsafe method exports', () => {
  const base = { schemaVersion: 2, id: 'fixture.invalid', version: '1.0.0', displayName: 'Invalid', hostApi: '^3.18.0',
    permissions: ['dataset:read'], backend: { entry: 'main.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand',
      actions: [{ name: 'read', inputSchema: 'input.json', outputSchema: 'output.json' }] } }
  const provide = { provides: [{ protocol, methods: [{ name: 'describe', action: 'read', permission: 'dataset:read', effect: 'read' }] }] }
  expect(validateAppManifest({ ...base, appCapabilities: provide }).appCapabilities.provides[0].protocol).toBe(protocol)
  expect(() => validateAppManifest({ ...base, appCapabilities: { requires: [{ protocol }] } })).toThrow(/consumers require/)
  expect(() => validateAppManifest({ ...base, appCapabilities: { provides: [{ protocol, methods: [{ name: 'describe', action: 'missing', permission: 'dataset:read', effect: 'read' }] }] } })).toThrow(/requires a declared Action/)
  expect(() => validateAppManifest({ ...base, appCapabilities: { provides: [{ protocol, methods: [{ name: 'describe', action: 'read', permission: 'dataset:read', effect: 'write' }] }] } })).toThrow(/appCapabilities/)
})
