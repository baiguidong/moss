import { expect, test } from 'bun:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { reviewAppToolCall } from './appToolReview.js'
import { setGlobalAppEventBridge } from '../../Tool.js'

test('ordinary tools skip review; App review keeps real result and origin context across delayed confirmation', async () => {
  const storage = new AsyncLocalStorage<string>()
  const calls: unknown[] = [], controller = new AbortController()
  let event: any
  const context = { toolUseId: 'call', abortController: controller, emitAppEvent: async (value: any) => {
    event = value
    return { ok: true, result: await storage.run('confirmation-ipc', () => value.execute({ text: 'edited' }, true, () => { calls.push('dispatch') })) }
  } } as any
  const tool = { appInfo: { appId: 'example.app', contributionId: 'example.app/send' }, name: 'alias', inputJSONSchema: { type: 'object' }, validateInput: async () => ({ result: true }) } as any
  const result = await storage.run('original-session', () => reviewAppToolCall(tool, { text: 'original' }, context,
    (async () => ({ behavior: 'allow' })) as any, {} as any, async (args, reviewed) => {
      calls.push([args, reviewed, storage.getStore()]); return { data: { actual: args } }
    }))
  expect(event.input.contributionId).toBe('example.app/send')
  expect(calls).toEqual(['dispatch', [{ text: 'edited' }, true, 'original-session']])
  expect(result).toEqual({ data: { actual: { text: 'edited' } } })
  await reviewAppToolCall({ name: 'Read' } as any, {}, { ...context, emitAppEvent: () => { throw new Error('not an App') } }, null as any, null as any, async () => ({ data: 'normal' }))
})

test('edited parameters cannot bypass validation or permission and never reach dispatch', async () => {
  const controller = new AbortController(), calls: unknown[] = []
  const context = { toolUseId: 'call', abortController: controller, emitAppEvent: async (event: any) => ({ ok: true, result: await event.execute({ recipient: 'different' }, true, () => calls.push('dispatch')) }) } as any
  const tool = { name: 'mail', mcpInfo: { appId: 'mail.app', serverName: 'service', toolName: 'Send' }, inputJSONSchema: {} } as any
  await expect(reviewAppToolCall(tool, { recipient: 'original' }, context, (async () => ({ behavior: 'deny' })) as any, {} as any, async () => calls.push('execute'))).rejects.toThrow('权限')
  await expect(reviewAppToolCall({ ...tool, validateInput: async () => ({ result: false, message: 'invalid' }) }, {}, context, (async () => ({ behavior: 'allow' })) as any, {} as any, async () => calls.push('execute'))).rejects.toThrow('invalid')
  expect(calls).toEqual([])
})

test('session fallback bridge is reviewed even when the per-call context omits emitAppEvent', async () => {
  let reviews = 0
  setGlobalAppEventBridge(async event => {
    if (event.type !== 'tool_call_review') throw new Error('unexpected event')
    reviews++
    return { ok: true, result: await event.execute(event.input.arguments, true) }
  })
  try {
    const result = await reviewAppToolCall({ name: 'alias', appInfo: { appId: 'app', contributionId: 'app/write' } } as any,
      { value: 1 }, { toolUseId: '1', abortController: new AbortController() } as any,
      (async () => ({ behavior: 'allow' })) as any, {} as any, async (_input, reviewed) => ({ reviewed }))
    expect(result).toEqual({ reviewed: true }); expect(reviews).toBe(1)
  } finally { setGlobalAppEventBridge(undefined) }
})
