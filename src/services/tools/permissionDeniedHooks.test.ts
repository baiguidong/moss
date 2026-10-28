import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { hookJSONOutputSchema } from '../../types/hooks.js'

test('PermissionDenied hook schema carries retry', () => {
  const parsed = hookJSONOutputSchema().safeParse({
    hookSpecificOutput: {
      hookEventName: 'PermissionDenied',
      retry: true,
    },
  })
  expect(parsed.success).toBe(true)
})

test('PermissionDenied JSON output is converted to a retry signal', () => {
  const source = readFileSync(new URL('../../utils/hooks.ts', import.meta.url), 'utf8')
  const start = source.indexOf('function processHookJSONOutput(')
  const end = source.indexOf('\nexport function shouldBlockHookFailure(')
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    source.slice(start, end).replace('function processHookJSONOutput', 'function processHookJSONOutput') +
      '\nglobalThis.process = processHookJSONOutput;',
  )
  const scope: any = {
    jsonStringify: JSON.stringify,
    createAttachmentMessage: () => ({ type: 'attachment' }),
    logForDebugging: () => {},
  }
  runInNewContext(code, scope)
  const result = scope.process({
    json: {
      hookSpecificOutput: {
        hookEventName: 'PermissionDenied',
        retry: true,
      },
    },
    command: 'hook-command',
    hookName: 'PermissionDenied:tool',
    toolUseID: 'tool-use-id',
    hookEvent: 'PermissionDenied',
    expectedHookEvent: 'PermissionDenied',
  })
  expect(result.retry).toBe(true)
})

test('PermissionDenied runner preserves retry and hook context for the caller', async () => {
  const source = readFileSync(
    new URL('./toolHooks.ts', import.meta.url),
    'utf8',
  )
  const start = source.indexOf('export async function* runPermissionDeniedHooks')
  const end = source.indexOf('\n/**\n * Resolve a PreToolUse hook')
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    source.slice(start, end).replace('export async function*', 'async function*') +
      '\nglobalThis.run = runPermissionDeniedHooks;',
  )

  async function* executePermissionDeniedHooks() {
    yield { retry: true, additionalContexts: ['retry context'] }
  }
  const scope: any = {
    executePermissionDeniedHooks,
    createAttachmentMessage: (attachment: unknown) => ({ attachment }),
  }
  runInNewContext(code, scope)

  const context: any = {
    abortController: new AbortController(),
    getAppState: () => ({ toolPermissionContext: { mode: 'default' } }),
  }
  const result: any[] = []
  for await (const update of scope.run(
    context,
    { name: 'Bash' },
    'tool-use-id',
    {},
    'automatic denial',
  )) {
    result.push(update)
  }
  expect(result[0]).toEqual({ retry: true })
  expect(result[1].message.attachment).toMatchObject({
    type: 'hook_additional_context',
    content: ['retry context'],
  })
})

test('PermissionDenied hooks are limited to automatic denial sources', () => {
  const source = readFileSync(
    new URL('./toolExecution.ts', import.meta.url),
    'utf8',
  )
  const start = source.indexOf('export function shouldRunPermissionDeniedHooks')
  const end = source.indexOf('\n\n/**\n * Classify a tool execution error', start)
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    source.slice(start, end).replace('export function', 'function') +
      '\nglobalThis.shouldRun = shouldRunPermissionDeniedHooks;',
  )
  const scope: any = {}
  runInNewContext(code, scope)
  expect(scope.shouldRun({ behavior: 'deny', decisionReason: { type: 'safetyCheck', reason: 'unsafe' } })).toBe(true)
  expect(scope.shouldRun({ behavior: 'deny', decisionReason: { type: 'asyncAgent', reason: 'headless' } })).toBe(true)
  expect(scope.shouldRun({ behavior: 'deny', decisionReason: { type: 'permissionPromptTool', toolResult: {} } })).toBe(false)
  expect(scope.shouldRun({ behavior: 'deny', decisionReason: { type: 'rule', rule: {} } })).toBe(false)
  expect(scope.shouldRun({ behavior: 'ask', decisionReason: { type: 'safetyCheck', reason: 'unsafe' } })).toBe(false)
})
