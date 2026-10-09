import { expect, test } from 'bun:test'
import { resolveAppTaskSession, appTaskHistoryEvent, preserveAppTaskHistory, appTasksPromptContext } from '../src/apps/app-task-session.mjs'
import { countSessionMessages } from '../src/shared/session-message-count.mjs'
import { buildMainChatRenderMessagesFromHistory } from '../src/renderer-react/lib/agent-transcript'

test('desktop runs create ordinary chat sessions; tool runs retain their existing session', async () => {
  const created: any[] = [], opened: string[] = []
  const existing = { id: 'existing', agentMode: 'local', workspace: '/project' }
  const services = {
    getSession: id => id === existing.id ? existing : undefined,
    createSession: options => { created.push(options); return { ...options, id: 'new', workspace: '/new' } },
    prepareSession: async () => {}, openSession: id => opened.push(id),
  }
  const app = await resolveAppTaskSession({ invocation: { surface: 'app', sessionId: 'existing' } }, { title: '资料整理' }, services)
  expect(app.id).toBe('new')
  expect(created).toEqual([{ title: '资料整理', agentMode: 'local' }])
  expect(opened).toEqual(['new'])
  const tool = await resolveAppTaskSession({ invocation: { surface: 'tool', sessionId: 'existing' } }, { title: '继续' }, services)
  expect(tool).toBe(existing)
  expect(created).toHaveLength(1)
  await expect(resolveAppTaskSession({}, { title: 'background' }, services)).rejects.toThrow('desktop action')
})

test('task activity and output remain visible after transcript refresh and available to follow-up chat', () => {
  const start = appTaskHistoryEvent({ id: 'task', attempt: 1, appId: 'example', title: '数字翻倍', status: 'running', createdAt: 1000, updatedAt: 1000 })
  const finish = appTaskHistoryEvent({ id: 'task', attempt: 1, appId: 'example', title: '数字翻倍', status: 'completed', result: 42, createdAt: 1000, updatedAt: 2000 })
  const reply = { type: 'assistant', uuid: 'reply', timestamp: new Date(3000).toISOString(), message: { content: [{ type: 'text', text: '结果是 42' }] } }
  const history = preserveAppTaskHistory([start, finish], [reply])
  expect(history).toEqual([start, finish, reply])
  expect(preserveAppTaskHistory(history, history)).toEqual(history)
  expect(countSessionMessages(history)).toBe(3)
  const messages = buildMainChatRenderMessagesFromHistory(history)
  expect(messages[0]).toMatchObject({ type: 'system', variant: 'app_task', content: '数字翻倍 · 已开始' })
  expect(messages[1]).toMatchObject({ type: 'system', variant: 'app_task', content: '数字翻倍 · 已完成\n\n42' })
  expect(appTasksPromptContext([{ title: '数字翻倍', result: 42, status: 'completed' }])).toContain('"result":42')
})
