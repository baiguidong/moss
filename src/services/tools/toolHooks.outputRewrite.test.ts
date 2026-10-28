import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { syncHookResponseSchema } from '../../types/hooks.js'

test('PostToolUse accepts updatedToolOutput for any tool output value', () => {
  for (const updatedToolOutput of [null, false, '', { rewritten: true }]) {
    const parsed = syncHookResponseSchema().safeParse({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput,
      },
    })
    expect(parsed.success).toBe(true)
  }
})

test('PostToolUse replaces output for built-in tools, including falsy values', async () => {
  const source = readFileSync(
    new URL('./toolHooks.ts', import.meta.url),
    'utf8',
  )
  const start = source.indexOf('export async function* runPostToolUseHooks')
  const end = source.indexOf('export async function* runPostToolUseFailureHooks')
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    source
      .slice(start, end)
      .replace('export async function*', 'async function*') +
      '\nglobalThis.run = runPostToolUseHooks;',
  )

  async function* executePostToolHooks() {
    yield { updatedToolOutput: null }
  }

  const scope: any = {
    executePostToolHooks,
    createAttachmentMessage: () => ({ type: 'attachment' }),
    formatError: String,
    logError: () => {},
    logEvent: () => {},
    sanitizeToolNameForAnalytics: (name: string) => name,
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
    'message-id',
    {},
    { original: true },
    undefined,
    undefined,
    undefined,
  )) {
    result.push(update)
  }
  expect(result).toEqual([{ updatedToolOutput: null }])
})
