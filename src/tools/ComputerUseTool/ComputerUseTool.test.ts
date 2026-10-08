import { expect, test } from 'bun:test'
import { ComputerUseTool } from './ComputerUseTool.js'
import { runWithSessionIdContext } from '../../utils/sessionIdContext.js'
import { ALL_AGENT_DISALLOWED_TOOLS, COORDINATOR_MODE_ALLOWED_TOOLS } from '../../constants/tools.js'
import { isDeferredTool } from '../ToolSearchTool/prompt.js'
import { MOSS_RUNTIME_ADVANCED_SETTINGS_ENV } from '../../services/advancedSettings.js'

test('tool envelope is an object and rejects raw driver or session overrides', () => {
  expect(ComputerUseTool.inputJSONSchema?.type).toBe('object')
  expect(ComputerUseTool.inputJSONSchema).not.toHaveProperty('oneOf')
  expect(ComputerUseTool.inputSchema.safeParse({ action: 'click', app: 'example', window_id: '100' }).success).toBe(false)
  expect(ComputerUseTool.inputSchema.safeParse({ action: 'list_apps', session: 'foreign' }).success).toBe(false)
  expect(ComputerUseTool.inputSchema.safeParse({ action: 'kill_app', app: 'example' }).success).toBe(false)
})
test('availability is scoped to enabled attended desktop sessions', () => {
  const enabled = (environment: Record<string, string>, runtime: any) => runWithSessionIdContext('test' as any, undefined,
    () => ComputerUseTool.isEnabled(), undefined, environment, runtime)
  expect(enabled({}, { executionEnvironment: 'desktop' })).toBe(false)
  expect(enabled({ MOSS_COMPUTER_USE_ENABLED: '1' }, { executionEnvironment: 'desktop' })).toBe(true)
  expect(enabled({ MOSS_COMPUTER_USE_ENABLED: '1' }, { executionEnvironment: 'server' })).toBe(false)
  expect(enabled({ MOSS_COMPUTER_USE_ENABLED: '1' }, { executionEnvironment: 'desktop', unattended: true })).toBe(false)
  expect(ALL_AGENT_DISALLOWED_TOOLS.has('computer_use')).toBe(true)
  expect(COORDINATOR_MODE_ALLOWED_TOOLS.has('computer_use')).toBe(true)
})
test('the built-in tool follows its per-session loading preference', () => {
  expect(isDeferredTool(ComputerUseTool)).toBe(false)
  runWithSessionIdContext('loading-test' as any, undefined, () => {
    expect(isDeferredTool(ComputerUseTool)).toBe(true)
    expect(ComputerUseTool.isEnabled()).toBe(false)
  }, undefined, { [MOSS_RUNTIME_ADVANCED_SETTINGS_ENV]: JSON.stringify({ moss_tool_loading: { computer_use: 'deferred' } }) })
})
test('a worker cannot call the host even if it retained a stale tool reference', async () => {
  let called = false
  const output = await ComputerUseTool.call({ action: 'list_apps' }, {
    agentId: 'worker', emitAppEvent: () => { called = true },
  } as any)
  expect(output.data.isError).toBe(true)
  expect(called).toBe(false)
})
test('main-session bridge preserves abort signal and screenshot output', async () => {
  const abortController = new AbortController()
  let event: any
  const output = await ComputerUseTool.call({ action: 'get_window_state', app: 'com.example.app', window_id: '42' }, {
    abortController,
    emitAppEvent: async (input: any) => {
      event = input
      return { ok: true, result: { content: [{ type: 'image', mimeType: 'image/png', data: 'test-base64' }], structuredContent: { snapshot_id: 's00000001' } } }
    },
  } as any)
  expect(event.type).toBe('computer_use')
  expect(event.signal).toBe(abortController.signal)
  expect(output.data.content[0].type).toBe('image')
  expect(output.data.structuredContent?.snapshot_id).toBe('s00000001')
  expect(output.data.structuredContent?.moss).toMatchObject({ action: 'get_window_state', app: 'com.example.app' })
})
test('screenshots become model image blocks with the matching snapshot metadata', () => {
  const output = ComputerUseTool.mapToolResultToToolResultBlockParam({ content: [{ type: 'image', mimeType: 'image/png', data: 'test-base64' }],
    structuredContent: { snapshot_id: 's00000001', screenshot_width: 600, elements: [{ element_token: 's00000001:1', label: 'Button', role: 'AXButton' }] } }, 'tool-1')
  const blocks = output.content as any[]
  expect(blocks[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'test-base64' } })
  expect(JSON.parse(blocks[0].text).elements[0].element_token).toBe('s00000001:1')
})
