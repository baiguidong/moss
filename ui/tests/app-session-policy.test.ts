import { expect, test } from 'bun:test'
import { appSessionResponseStylePrompt, isolateAppSession, normalizeAppScopedPolicy } from '../src/apps/app-session-policy.mjs'

test('any App can opt into an isolated context while retaining its explicit tool selection and persona', () => {
  const record = {
    id: 'app-session', channelAppId: 'example.assistant', underlyingSessionId: 'transcript',
    assistantSystemPrompt: 'Custom persona',
    connectorIds: Array.from({ length: 102 }, (_, i) => `connector-${i}`),
    appIds: ['foreign-resident'], appServiceIds: ['foreign-service'],
    channelRuntimePolicy: { contextScope: 'app', agentId: 'foreign-agent', resources: { tools: ['Read', 'own_tool'], skills: null, connectors: null } },
  }
  expect(isolateAppSession(record)).toBe(true)
  expect(record.connectorIds).toEqual([])
  expect(record.appIds).toEqual(['example.assistant'])
  expect(record.appServiceIds).toEqual([])
  expect(record.channelRuntimePolicy.resources).toEqual({ tools: ['Read', 'own_tool'], skills: [], connectors: [] })
  expect(record.channelRuntimePolicy.agentId).toBeNull()
  expect(record.assistantSystemPrompt).toBe('Custom persona')
  expect(record.underlyingSessionId).toBe('transcript')
  expect(isolateAppSession(record)).toBe(false)
})

test('ordinary desktop and App sessions retain their existing context without opt-in', () => {
  for (const channelAppId of [undefined, 'example.assistant', 'moss.buddy']) {
    const record = { channelAppId, appIds: ['foreign'], connectorIds: ['crm'] }
    const original = structuredClone(record)
    expect(isolateAppSession(record)).toBe(false)
    expect(record).toEqual(original)
  }
})

test('missing tool selection fails closed instead of inheriting every plugin', () => {
  expect(normalizeAppScopedPolicy(null).resources).toEqual({ tools: [], skills: [], connectors: [] })
})

test('only App-scoped sessions include their configured style in the system prompt', () => {
  const style = '用中文回答。\n遇到“你好”时简短一些。'
  const record = { channelAppId: 'example.studio', channelRuntimePolicy: {
    contextScope: 'app', session: { responseStyle: style },
  } }
  expect(appSessionResponseStylePrompt(record)).toContain(JSON.stringify(style))
  expect(appSessionResponseStylePrompt({ ...record, channelAppId: undefined })).toBe('')
  record.channelRuntimePolicy.contextScope = 'default'
  expect(appSessionResponseStylePrompt(record)).toBe('')
  record.channelRuntimePolicy.contextScope = 'app'
  record.channelRuntimePolicy.session.responseStyle = ''
  expect(appSessionResponseStylePrompt(record)).toBe('')
})
