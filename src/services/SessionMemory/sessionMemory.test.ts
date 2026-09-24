import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { asSessionId } from '../../types/ids.js'
import {
  getSessionEnvironmentContext,
  getSessionIdContext,
  runWithSessionIdContext,
} from '../../utils/sessionIdContext.js'

mock.module('color-diff-napi', () => ({
  ColorDiff: {}, ColorFile: {}, getSyntaxTheme: () => ({}),
}))

const { createAssistantMessage, createUserMessage } = await import('../../utils/messages.js')
const { initSessionMemory, manuallyExtractSessionMemory, resetLastMemoryMessageUuid, shouldExtractMemory } =
  await import('./sessionMemory.js')
const {
  discardSessionMemoryState, isSessionMemoryExtractionRunning,
  recordExtractionTokenCount, resetSessionMemoryState, setSessionMemoryConfig,
  tryStartSessionMemoryExtraction,
} = await import('./sessionMemoryUtils.js')
const { tokenCountWithEstimation } = await import('../../utils/tokens.js')
const { createFileStateCacheWithSizeLimit } = await import('../../utils/fileStateCache.js')
const { executePostSamplingHooks } = await import('../../utils/hooks/postSamplingHooks.js')
const { FileReadTool } = await import('../../tools/FileReadTool/FileReadTool.js')
const updateModule = await import('./runMemoryUpdate.js')

const releases: Array<() => void> = []
function acquire() {
  const release = tryStartSessionMemoryExtraction()
  if (release) releases.push(release)
  return release
}
const inSession = <T>(id: string, run: () => T) => runWithSessionIdContext(asSessionId(id), null, run)
function snapshot() {
  const answer = createAssistantMessage({ content: 'Filesystem ...' })
  answer.message.model = 'test-model'
  answer.message.usage.input_tokens = 200
  return [createUserMessage({ content: 'df' }), answer]
}

afterEach(() => {
  for (const release of releases.splice(0)) release()
  resetSessionMemoryState()
  resetLastMemoryMessageUuid()
})

describe('session memory writer ownership', () => {
  test('admits only one concurrent writer per session while other sessions remain independent', async () => {
    const claims = await Promise.all(Array.from({ length: 20 }, () =>
      Promise.resolve().then(() => inSession('same-session', acquire)),
    ))
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(inSession('other-session', acquire)).toBeFunction()
    expect(inSession('same-session', isSessionMemoryExtractionRunning)).toBe(true)
    claims.find(Boolean)!()
    expect(inSession('same-session', acquire)).toBeFunction()
  })

  test('blocks automatic and manual updates while the same session has a writer', async () => {
    await inSession('busy-session', async () => {
      setSessionMemoryConfig({ minimumMessageTokensToInit: 100, minimumTokensBetweenUpdate: 50, toolCallsBetweenUpdates: 3 })
      const messages = snapshot()
      expect(shouldExtractMemory(messages)).toBe(true)
      const release = acquire()!
      expect(shouldExtractMemory(messages)).toBe(false)
      // The busy check must return before filesystem access or model setup.
      const manual = await manuallyExtractSessionMemory(messages, {} as never)
      expect(manual).toEqual({ success: false, error: 'A session memory update is already running.' })
      release()
      expect(shouldExtractMemory(messages)).toBe(true)
    })
  })

  test('does not retry an unchanged snapshot after a failed extraction', () => {
    inSession('failed-session', () => {
      setSessionMemoryConfig({ minimumMessageTokensToInit: 100, minimumTokensBetweenUpdate: 50, toolCallsBetweenUpdates: 3 })
      const messages = snapshot()
      expect(shouldExtractMemory(messages)).toBe(true)
      const release = acquire()!
      recordExtractionTokenCount(tokenCountWithEstimation(messages))
      release()
      expect(shouldExtractMemory(messages)).toBe(false)
      messages[1]!.message.usage!.input_tokens += 100
      expect(shouldExtractMemory(messages)).toBe(true)
    })
  })

  test('keeps ownership through state disposal and ignores a stale release', () => {
    inSession('recreated-session', () => {
      const releaseFirst = acquire()!
      discardSessionMemoryState('recreated-session')
      expect(acquire()).toBeUndefined()
      releaseFirst()
      const releaseSecond = acquire()!
      releaseFirst()
      expect(acquire()).toBeUndefined()
      releaseSecond()
      expect(isSessionMemoryExtractionRunning()).toBe(false)
    })
  })

  test('the actual sampling hook queues duplicate snapshots and rechecks the threshold after failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moss-memory-hook-'))
    const parent = new AbortController()
    let enter!: () => void, finish!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const pending = new Promise<void>(resolve => { finish = resolve })
    const update = spyOn(updateModule, 'runMemoryUpdate').mockImplementation(async () => {
      enter()
      await pending
      throw new Error('Summary edit failed')
    })
    const read = spyOn(FileReadTool, 'call').mockResolvedValue({
      data: { type: 'text', file: { content: 'Existing notes' } },
    } as never)
    const messages = snapshot()
    const context = {
      abortController: parent,
      readFileState: createFileStateCacheWithSizeLimit(10),
      getAppState: () => ({ toolPermissionContext: {} }),
      options: { tools: [], mainLoopModel: 'test-model' },
      messages,
    } as never
    const scoped = <T>(run: () => T) => runWithSessionIdContext(
      asSessionId('sampling-session'), root, run, undefined,
      { MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({
        enabled: true, minimumMessageTokensToInit: 100,
        minimumTokensBetweenUpdate: 50, toolCallsBetweenUpdates: 3,
      }) },
    )
    const sample = () => scoped(() => executePostSamplingHooks(messages, [] as never, {}, {}, context, 'sdk'))
    let first: Promise<void> | undefined
    let second: Promise<void> | undefined
    try {
      initSessionMemory()
      first = sample()
      await entered
      let secondSettled = false
      second = sample().then(() => { secondSettled = true })
      await new Promise(resolve => setImmediate(resolve))
      expect(secondSettled).toBe(false)
      expect(update).toHaveBeenCalledTimes(1)
      expect(scoped(isSessionMemoryExtractionRunning)).toBe(true)
      expect((await scoped(() => manuallyExtractSessionMemory(messages, context))).success).toBe(false)
      finish()
      await Promise.all([first, second])
      expect(scoped(isSessionMemoryExtractionRunning)).toBe(false)
      await sample()
      expect(update).toHaveBeenCalledTimes(1)
    } finally {
      finish()
      await Promise.all([first, second])
      parent.abort()
      read.mockRestore()
      update.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runs queued newer snapshots in their own context and keeps other sessions independent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moss-memory-queue-'))
    const parent = new AbortController()
    const cancelled = new AbortController()
    let enter!: () => void, finish!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const pending = new Promise<void>(resolve => { finish = resolve })
    const seen: Array<{ session: string | undefined; marker: string | undefined; tokens: number }> = []
    const update = spyOn(updateModule, 'runMemoryUpdate').mockImplementation(async params => {
      const messages = params.cacheSafeParams.forkContextMessages
      seen.push({
        session: getSessionIdContext(),
        marker: getSessionEnvironmentContext()?.MOSS_TEST_QUEUE_MARKER,
        tokens: tokenCountWithEstimation(messages),
      })
      if (seen.length === 1) {
        enter()
        await pending
        throw new Error('First summary failed')
      }
    })
    const read = spyOn(FileReadTool, 'call').mockResolvedValue({
      data: { type: 'text', file: { content: 'Existing notes' } },
    } as never)
    const context = {
      abortController: parent,
      readFileState: createFileStateCacheWithSizeLimit(10),
      getAppState: () => ({ toolPermissionContext: {} }),
      options: { tools: [], mainLoopModel: 'test-model' },
    }
    const sample = (session: string, marker: string, tokens: number, controller = parent) => {
      const messages = snapshot()
      messages[1]!.message.usage!.input_tokens = tokens
      return runWithSessionIdContext(asSessionId(session), root, () =>
        executePostSamplingHooks(messages, [] as never, {}, {}, {
          ...context, messages, abortController: controller,
        } as never, 'sdk'), undefined, {
          MOSS_TEST_QUEUE_MARKER: marker,
          MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({
            enabled: true, minimumMessageTokensToInit: 100,
            minimumTokensBetweenUpdate: 50, toolCallsBetweenUpdates: 3,
          }),
        },
      )
    }
    const calls: Promise<void>[] = []
    try {
      initSessionMemory()
      calls.push(sample('queue-a', 'first', 200))
      await entered
      calls.push(sample('queue-a', 'newer', 400))
      calls.push(sample('queue-a', 'cancelled', 600, cancelled))
      cancelled.abort()
      // A different session must complete while queue-a's first update is held.
      await sample('queue-b', 'other-session', 200)
      expect(seen.map(entry => entry.marker)).toEqual(['first', 'other-session'])
      finish()
      await Promise.all(calls)
      expect(seen).toEqual([
        { session: 'queue-a', marker: 'first', tokens: 200 },
        { session: 'queue-b', marker: 'other-session', tokens: 200 },
        { session: 'queue-a', marker: 'newer', tokens: 400 },
      ])
      // An empty queue can be recreated without retaining its old context.
      await sample('queue-a', 'later', 600)
      expect(seen.at(-1)).toEqual({ session: 'queue-a', marker: 'later', tokens: 600 })
    } finally {
      finish()
      await Promise.all(calls)
      parent.abort()
      read.mockRestore()
      update.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  })
})
