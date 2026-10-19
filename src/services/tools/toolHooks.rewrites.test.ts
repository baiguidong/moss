import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod/v4'
import { validateRewrittenInput } from './validateRewrittenInput'

// Execute the actual resolver, isolating only its rule/permission dependencies.
const source = readFileSync(process.env.MOSS_TEST_TOOL_HOOKS_SOURCE ?? new URL('./toolHooks.ts', import.meta.url), 'utf8')
const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(
  source.indexOf('export async function resolveHookPermissionDecision('),
  source.indexOf('export async function* runPreToolUseHooks('),
).replace('export async function', 'async function') + '\nglobalThis.resolve = resolveHookPermissionDecision;')
function fixture(rule: (input: any) => any = () => null) {
  const scope: any = { structuredClone, isDeepStrictEqual, validateRewrittenInput, logForDebugging: () => {},
    checkRuleBasedPermissions: async (_tool: any, input: any) => rule(input) }
  runInNewContext(code, scope)
  const context: any = { abortController: new AbortController() }
  const tool: any = { name: 'fixture', inputSchema: z.strictObject({ path: z.string(), count: z.number().min(1).optional(), answers: z.record(z.string(), z.string()).optional() }),
    validateInput: async (input: any) => ({ result: input.path !== '/invalid', message: 'invalid path' }) }
  return { tool, context, run: (hook: any, permission: any, input = { path: '/original' }) => scope.resolve(hook, tool, input, context, permission, {}, 'id') }
}
test('hook rewrites are checked before permission approval, including value constraints and unknown fields', async () => {
  for (const input of [{ path: 5 }, { path: '/invalid' }, { path: '/ok', extra: 'ignored?' }]) {
    const f = fixture(); let approvals = 0
    await expect(f.run({ behavior: 'allow', updatedInput: input }, async () => { approvals++; return { behavior: 'allow' } })).rejects.toThrow('InputValidationError')
    expect(approvals).toBe(0)
  }
})
test('permission rewrites and in-place mutation cannot bypass final validation', async () => {
  for (const mutate of [false, true]) {
    const f = fixture()
    await expect(f.run(undefined, async (_tool: any, input: any) => {
      if (mutate) input.path = '/invalid'
      return { behavior: 'allow', ...(mutate ? {} : { updatedInput: { path: '/invalid' } }) }
    })).rejects.toThrow('invalid path')
  }
})
test('final arguments are checked against deny rules and newly applicable ask rules', async () => {
  const denied = fixture(input => input.path === '/denied' ? { behavior: 'deny', message: 'denied path' } : null)
  expect((await denied.run(undefined, async () => ({ behavior: 'allow', updatedInput: { path: '/denied' } }))).decision.behavior).toBe('deny')
  const asked = fixture(input => input.path !== '/original' ? { behavior: 'ask', message: 'confirm edited path' } : null)
  let calls = 0
  const result = await asked.run(undefined, async (_tool: any, input: any) => {
    calls++
    return { behavior: 'allow', updatedInput: calls === 1 ? { path: '/edited' } : input }
  })
  expect(calls).toBe(2); expect(result.input.path).toBe('/edited')
})
test('a second approval rewrite is rejected instead of looping or executing a different action', async () => {
  const f = fixture(() => ({ behavior: 'ask', message: 'confirm' })); let calls = 0
  const result = await f.run(undefined, async () => ({ behavior: 'allow', updatedInput: { path: `/edit-${++calls}` } }))
  expect(calls).toBe(2); expect(result.decision.behavior).toBe('deny')
})
test('valid collected answers survive, and reserved sed edits only enter through permission callbacks', async () => {
  const f = fixture(); f.tool.requiresUserInteraction = () => true
  const answers = { question: 'chosen' }
  const result = await f.run({ behavior: 'allow', updatedInput: { path: '/ok', answers } }, async () => { throw new Error('unnecessary prompt') })
  expect(result.input.answers).toEqual(answers)
  f.tool.name = 'Bash'; f.tool.requiresUserInteraction = () => false
  const input = { path: '/ok', _simulatedSedEdit: { filePath: '/ok', newContent: 'text' } }
  await expect(f.run({ behavior: 'allow', updatedInput: input }, async () => ({ behavior: 'allow' }))).rejects.toThrow('reserved')
  expect((await f.run(undefined, async () => ({ behavior: 'allow', updatedInput: input }))).input).toEqual(input)
})
test('cancel during permission preparation prevents an allowed result from reaching execution', async () => {
  const f = fixture()
  await expect(f.run(undefined, async () => { f.context.abortController.abort(new Error('stopped')); return { behavior: 'allow' } })).rejects.toThrow('stopped')
})
