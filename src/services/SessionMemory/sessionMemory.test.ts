import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ToolUseContext } from '../../Tool.js'
import { asSessionId } from '../../types/ids.js'
import { runWithSessionIdContext, type SessionRuntime } from '../../utils/sessionIdContext.js'
import * as settings from '../../utils/settings/settings.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { getSessionMemoryPath } from '../../utils/permissions/filesystem.js'
import { MAX_SESSION_SUMMARY_CHARS } from './sessionMemory.js'
import { getSessionMemoryContent } from './sessionMemoryUtils.js'
import { SaveSessionSummaryTool as tool } from '../../tools/SaveSessionSummaryTool/SaveSessionSummaryTool.js'

mock.module('color-diff-napi', () => ({
  ColorDiff: {}, ColorFile: {}, getSyntaxTheme: () => ({}),
}))
const { getTools, getToolsForDefaultPreset, assembleToolPool } = await import('../../tools.js')
const { getEmptyToolPermissionContext } = await import('../../Tool.js')
const { filterToolsForAgent } = await import('../../tools/AgentTool/agentToolUtils.js')
const { applyChatToolFilter, applyCoordinatorToolFilter } = await import('../../utils/toolPool.js')
const { isDeferredTool } = await import('../../tools/ToolSearchTool/prompt.js')
const { executePostSamplingHooks } = await import('../../utils/hooks/postSamplingHooks.js')
const { createAssistantMessage, createUserMessage } = await import('../../utils/messages.js')
const forkedAgent = await import('../../utils/forkedAgent.js')

let root: string
const originalEnvironment = Object.fromEntries([
  'MOSS_CONFIG_DIR', 'MOSS_SESSION_MEMORY_SETTINGS', 'MOSS_RUNTIME_SESSION_MEMORY_SETTINGS', 'CLAUDE_CODE_SIMPLE',
].map(key => [key, process.env[key]]))

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'moss-session-summary-'))
  process.env.MOSS_CONFIG_DIR = root
  delete process.env.MOSS_SESSION_MEMORY_SETTINGS
  delete process.env.MOSS_RUNTIME_SESSION_MEMORY_SETTINGS
  delete process.env.CLAUDE_CODE_SIMPLE
  resetSettingsCache()
  spyOn(settings, 'getInitialSettings').mockReturnValue({})
})
afterEach(async () => {
  mock.restore()
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  resetSettingsCache()
  await fs.rm(root, { recursive: true, force: true })
})

function session<T>(id: string, run: () => T, enabled?: boolean, runtime?: SessionRuntime): T {
  return runWithSessionIdContext(asSessionId(id), root, run, undefined, {
    MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify(enabled === undefined ? {} : {
      enabled, compactEnabled: true, minimumMessageTokensToInit: 1,
      minimumTokensBetweenUpdate: 1, toolCallsBetweenUpdates: 1,
    }),
  }, runtime)
}
function context(controller = new AbortController()): ToolUseContext {
  return { abortController: controller } as ToolUseContext
}

const permissions = getEmptyToolPermissionContext()

describe('model-authored session summaries', () => {
  test('unconfigured and disabled sessions omit the tool; enabled CLI, desktop, and server pools include it', () => {
    for (const enabled of [undefined, false, true]) {
      for (const runtime of [undefined, { executionEnvironment: 'desktop' as const }, { executionEnvironment: 'server' as const }]) {
        session('availability', () => {
          const expected = enabled === true
          expect(getTools(permissions).some(t => t.name === tool.name)).toBe(expected)
          expect(getToolsForDefaultPreset().includes(tool.name)).toBe(expected)
          expect(assembleToolPool(permissions, []).some(t => t.name === tool.name)).toBe(expected)
        }, enabled, runtime)
      }
    }
    expect(isDeferredTool(tool)).toBe(false)
  })

  test('honors explicit settings, per-session overrides, global policy, and deny rules', () => {
    spyOn(settings, 'getInitialSettings').mockReturnValue({ sessionMemory: { enabled: true } })
    session('configured', () => expect(tool.isEnabled()).toBe(true))
    session('disabled', () => expect(tool.isEnabled()).toBe(false), false)
    process.env.MOSS_SESSION_MEMORY_SETTINGS = JSON.stringify({ enabled: false })
    session('policy', () => expect(tool.isEnabled()).toBe(false), true)
    delete process.env.MOSS_SESSION_MEMORY_SETTINGS
    session('denied', () => {
      expect(getTools({ ...permissions, alwaysDenyRules: { session: [tool.name] } })
        .some(t => t.name === tool.name)).toBe(false)
    }, true)
  })

  test('keeps the tool in Chat and Boss but excludes built-in, custom, and async subagents', async () => {
    expect(applyChatToolFilter([tool], false)).toContain(tool)
    expect(applyCoordinatorToolFilter([tool])).toContain(tool)
    for (const isBuiltIn of [true, false]) {
      for (const isAsync of [true, false]) {
        expect(filterToolsForAgent({ tools: [tool], isBuiltIn, isAsync })).toEqual([])
      }
    }
    await session('child', async () => {
      await expect(tool.call({ summary: 'child notes' }, { ...context(), agentId: 'child' } as ToolUseContext))
        .rejects.toThrow('Only the main conversation')
      expect(await getSessionMemoryContent()).toBeNull()
    }, true)
  })

  test('saves exactly the supplied text, replaces earlier notes, and returns no duplicate content or extra model call', async () => {
    const fork = spyOn(forkedAgent, 'runForkedAgent').mockRejectedValue(new Error('Unexpected model request'))
    const fetch = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'))
    await session('save', async () => {
      const summary = '# 当前任务\n已确认：压缩使用原始对话。\n待完成：验证工具。\n'
      const result = await tool.call({ summary }, context())
      expect(result.data).toEqual({ saved: true })
      expect(await getSessionMemoryContent()).toBe(summary)
      const file = getSessionMemoryPath()
      expect(file).toBe(join(root, 'save/session-memory/summary.md'))
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
      expect((await fs.stat(dirname(file))).mode & 0o777).toBe(0o700)
      expect(tool.mapToolResultToToolResultBlockParam(result.data, 'save-1').content)
        .toBe('Session summary saved.')
      await tool.call({ summary: 'Updated progress' }, context())
      expect(await getSessionMemoryContent()).toBe('Updated progress')
      expect(await fs.readdir(dirname(file))).toEqual(['summary.md'])
    }, true)
    expect(fork).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  test('rejects stale disabled calls, blank/oversized summaries, and arbitrary paths without writing', async () => {
    await session('disabled', async () => {
      await expect(tool.call({ summary: 'notes' }, context())).rejects.toThrow('disabled')
      expect(await getSessionMemoryContent()).toBeNull()
    }, false)
    await session('invalid', async () => {
      for (const input of [
        { summary: '' }, { summary: ' \n\t' }, { summary: 'x'.repeat(MAX_SESSION_SUMMARY_CHARS + 1) },
        { summary: 'notes', path: '/tmp/other-session.md' },
      ]) {
        await expect(tool.call(input, context())).rejects.toThrow()
      }
      expect(await getSessionMemoryContent()).toBeNull()
    }, true)
  })

  test('rejects overlapping saves in one session and allows separate sessions to save independently', async () => {
    await session('first', async () => {
      const first = tool.call({ summary: 'First session' }, context())
      await expect(tool.call({ summary: 'Overlapping save' }, context())).rejects.toThrow('already running')
      await session('second', () => tool.call({ summary: 'Second session' }, context()), true)
      await first
      expect(await getSessionMemoryContent()).toBe('First session')
      expect(await session('second', getSessionMemoryContent, true)).toBe('Second session')
      await tool.call({ summary: 'Later save' }, context())
      expect(await getSessionMemoryContent()).toBe('Later save')
    }, true)
  })

  test('cancellation and failed writes preserve the old file and release writer ownership', async () => {
    await session('failure', async () => {
      await tool.call({ summary: 'Keep me' }, context())
      const controller = new AbortController()
      controller.abort()
      await expect(tool.call({ summary: 'Cancelled' }, context(controller))).rejects.toThrow()
      const originalOpen = fs.open
      const duringWrite = new AbortController()
      const open = spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        const file = await originalOpen(...args)
        duringWrite.abort()
        return file
      })
      await expect(tool.call({ summary: 'Cancelled mid-write' }, context(duringWrite))).rejects.toThrow()
      open.mockRestore()
      const rename = spyOn(fs, 'rename').mockRejectedValue(new Error('Commit failed'))
      await expect(tool.call({ summary: 'Failed' }, context())).rejects.toThrow('Commit failed')
      rename.mockRestore()
      expect(await getSessionMemoryContent()).toBe('Keep me')
      expect(await fs.readdir(dirname(getSessionMemoryPath()))).toEqual(['summary.md'])
      await tool.call({ summary: 'Retry succeeds' }, context())
      expect(await getSessionMemoryContent()).toBe('Retry succeeds')
    }, true)
  })

  test('a greeting or a large tool-heavy conversation never starts automatic summary extraction after sampling', async () => {
    const fork = spyOn(forkedAgent, 'runForkedAgent').mockRejectedValue(new Error('Unexpected summary model'))
    const answer = createAssistantMessage({ content: '你好！' })
    answer.message.model = 'claude-sonnet-4-6'
    answer.message.usage.input_tokens = 100_000
    const greeting = [createUserMessage({ content: '你好啊' }), answer]
    const tools = createAssistantMessage({ content: Array.from({ length: 20 }, (_, i) => ({
      type: 'tool_use' as const, id: `tool-${i}`, name: 'Read', input: { file_path: 'sample.txt' },
    })) })
    for (const enabled of [false, true]) {
      for (const querySource of ['sdk', 'repl_main_thread'] as const) {
        await session(`sampling-${enabled}-${querySource}`, async () => {
          for (const messages of [greeting, [...greeting, tools, answer]]) {
            await executePostSamplingHooks(messages, [] as never, {}, {}, context(), querySource)
          }
          expect(await getSessionMemoryContent()).toBeNull()
        }, enabled)
      }
    }
    expect(fork).not.toHaveBeenCalled()
  })
})
