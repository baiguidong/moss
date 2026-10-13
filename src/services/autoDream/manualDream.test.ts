import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import * as settings from '../../utils/settings/settings.js'

mock.module('color-diff-napi', () => ({ ColorDiff: {}, ColorFile: {}, getSyntaxTheme: () => ({}) }))
const forked = await import('../../utils/forkedAgent.js')
const { createAssistantMessage, createAssistantAPIErrorMessage } = await import('../../utils/messages.js')
const { executeManualDream, executeAutoDream, initAutoDream } = await import('./autoDream.js')
const locks = await import('./consolidationLock.js')
const originalConfigDir = process.env.MOSS_CONFIG_DIR
let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'moss-manual-dream-test-'))
  process.env.MOSS_CONFIG_DIR = root
  spyOn(settings, 'getInitialSettings').mockReturnValue({ autoMemory: { enabled: true, dreamEnabled: false } } as never)
  initAutoDream()
})
afterEach(async () => {
  mock.restore()
  if (originalConfigDir === undefined) delete process.env.MOSS_CONFIG_DIR
  else process.env.MOSS_CONFIG_DIR = originalConfigDir
  await rm(root, { recursive: true, force: true })
})
function fixture() {
  let state = { tasks: {} }
  const context = {
    messages: [], systemPrompt: [], userContext: {}, systemContext: {},
    toolUseContext: {
      getAppState: () => state,
      setAppState: updater => { state = updater(state) },
    },
  } as unknown as REPLHookContext
  const message = createAssistantMessage({ content: '已合并重复记忆。' })
  const result = { messages: [message], totalUsage: message.message.usage }
  return { context, message, result, options: { transcriptDir: join(root, 'sessions') } }
}

describe('global manual dream', () => {
  test('runs with automatic Dream disabled and no new sessions, preserving the checkpoint on success', async () => {
    const { context, message, result, options } = fixture()
    const previous = await locks.tryAcquireConsolidationLock()
    await locks.releaseConsolidationLock(previous!)
    const run = spyOn(forked, 'runForkedAgent').mockImplementation(async params => {
      expect(JSON.stringify(params.promptMessages)).toContain(options.transcriptDir)
      params.onMessage?.(message)
      return result
    })
    await executeAutoDream(context)
    expect(run).not.toHaveBeenCalled()
    expect(await executeManualDream(context, options)).toMatchObject({ summary: '已合并重复记忆。' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(await locks.readLastConsolidatedAt()).toBeGreaterThan(0)
    const next = await locks.tryAcquireConsolidationLock()
    expect(next).not.toBeNull()
    await locks.releaseConsolidationLock(next!)
  })

  test('shares the active lock with automatic consolidation', async () => {
    const { context, options } = fixture()
    const active = await locks.tryAcquireConsolidationLock()
    const run = spyOn(forked, 'runForkedAgent')
    await expect(executeManualDream(context, options)).rejects.toThrow('正在整理中')
    expect(run).not.toHaveBeenCalled()
    await locks.rollbackConsolidationLock(active!)
  })

  test.each(['throw', 'api-error', 'cancel'] as const)('%s rolls back the checkpoint and permits a retry', async mode => {
    const { context, options, result } = fixture()
    const controller = new AbortController()
    spyOn(forked, 'runForkedAgent').mockImplementation(async () => {
      if (mode === 'throw') throw new Error('service unavailable')
      if (mode === 'cancel') controller.abort()
      return mode === 'api-error' ? {
        ...result,
        messages: [createAssistantAPIErrorMessage({ content: 'API unavailable', error: 'invalid_request' })],
      } : result
    })
    await expect(executeManualDream(context, { ...options, signal: controller.signal })).rejects.toThrow()
    expect(await locks.readLastConsolidatedAt()).toBe(0)
    const next = await locks.tryAcquireConsolidationLock()
    expect(next).not.toBeNull()
    await locks.rollbackConsolidationLock(next!)
  })
})
