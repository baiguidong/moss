import { afterEach, expect, mock, test } from 'bun:test'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { configureTraceOutput, drainTraceOutput } from './traceOutput.js'
import { withTraceScope } from './traceScope.js'
import { traceToolExecution } from './toolTrace.js'

mock.module('color-diff-napi', () => ({ ColorDiff: {}, ColorFile: {}, getSyntaxTheme: () => ({}) }))

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

async function fixture() {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'tool-trace-'))
  await configureTraceOutput(directory, { directory })
  cleanups.push(async () => { await configureTraceOutput(directory, null); await fs.rm(directory, { recursive: true, force: true }) })
  return { directory, events: async () => {
    await drainTraceOutput(directory)
    return (await fs.readFile(path.join(directory, 'traces/session.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line).event)
  } }
}

test('records actual execution interval and result failure without recording tool arguments or output', async () => {
  const f = await fixture()
  const result = { message: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool', is_error: true, content: 'private result' }] } } }
  await withTraceScope(f.directory, async () => {
    const updates = async function* () { await new Promise(resolve => setTimeout(resolve, 15)); yield result }
    const received = []
    for await (const update of traceToolExecution({ id: 'tool', name: 'Read' }, 'session', updates())) received.push(update)
    expect(received).toEqual([result])
  })
  const events = await f.events()
  expect(events.map(event => event.phase)).toEqual(['tool_execution_started', 'tool_execution_completed'])
  expect(events[1]).toMatchObject({ severity: 'error', metadata: { toolUseId: 'tool', toolName: 'Read', status: 'error' } })
  expect(events[1].metadata.durationMs).toBeGreaterThanOrEqual(10)
  expect(new Date(events[1].timestamp).getTime() - new Date(events[0].timestamp).getTime()).toBe(events[1].metadata.durationMs)
  expect(JSON.stringify(events)).not.toContain('private result')
})

test('completes timing after thrown errors and preserves the original failure', async () => {
  const f = await fixture()
  const failure = new Error('execution failed')
  await withTraceScope(f.directory, async () => {
    const updates = async function* () { throw failure }
    await expect((async () => {
      for await (const update of traceToolExecution({ id: 'throwing', name: 'Read' }, 'session', updates())) void update
    })()).rejects.toBe(failure)
  })
  expect((await f.events())[1]).toMatchObject({ severity: 'error', metadata: { status: 'error' } })
})

test('disabled capture leaves execution unchanged and writes no records', async () => {
  const f = await fixture()
  await configureTraceOutput(f.directory, null)
  await withTraceScope(f.directory, async () => {
    const updates = async function* () { yield 'done' }
    const received = []
    for await (const update of traceToolExecution({ id: 'tool', name: 'Read' }, 'session', updates())) received.push(update)
    expect(received).toEqual(['done'])
  })
  await expect(fs.stat(path.join(f.directory, 'traces'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('generator cancellation closes the execution interval without claiming success', async () => {
  const f = await fixture()
  await withTraceScope(f.directory, async () => {
    const updates = async function* () { yield 'progress'; yield 'not reached' }
    const traced = traceToolExecution({ id: 'cancelled', name: 'Read' }, 'session', updates())
    expect((await traced.next()).value).toBe('progress')
    await traced.return()
  })
  expect((await f.events())[1]).toMatchObject({ severity: 'warning', metadata: { status: 'cancelled' } })
})

test('a disk failure never changes tool execution results', async () => {
  const f = await fixture()
  await fs.writeFile(path.join(f.directory, 'traces'), 'blocked directory')
  await withTraceScope(f.directory, async () => {
    const updates = async function* () { yield 'successful result' }
    const received = []
    for await (const update of traceToolExecution({ id: 'tool', name: 'Read' }, 'session', updates())) received.push(update)
    expect(received).toEqual(['successful result'])
  })
  await drainTraceOutput(f.directory)
})

test('the actual tool runner records validation failures before execution without a model call', async () => {
  const f = await fixture()
  const { runToolUse } = await import('../tools/toolExecution.js')
  const { createAssistantMessage } = await import('../../utils/messages.js')
  const { runWithSessionIdContext } = await import('../../utils/sessionIdContext.js')
  const { asSessionId } = await import('../../types/ids.js')
  const { z } = await import('zod')
  await withTraceScope(f.directory, () => runWithSessionIdContext(asSessionId('session'), f.directory, async () => {
    const tool = { id: 'validation-tool', name: 'TraceFixtureTool', input: { path: 123 } }
    const context = { options: { tools: [{ name: tool.name, inputSchema: z.object({ path: z.string() }) }],
      mcpClients: [], mainLoopModel: 'fixture' }, abortController: new AbortController(), messages: [] }
    const updates = []
    for await (const update of runToolUse(tool as any, createAssistantMessage({ content: 'fixture' }),
      async () => { throw new Error('invalid input must not reach permission approval') }, context as any)) updates.push(update)
    expect(updates).toHaveLength(1)
    expect((updates[0]!.message as any).message.content[0]).toMatchObject({ type: 'tool_result', is_error: true, tool_use_id: tool.id })
  }))
  const events = await f.events()
  expect(events).toHaveLength(2)
  expect(events[1]).toMatchObject({ metadata: { toolUseId: 'validation-tool', status: 'error' } })
})
