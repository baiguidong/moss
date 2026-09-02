import { describe, expect, test } from 'bun:test'

import { buildGroupRoomChildSessionTitle, extractPersistedWorkerMappings, validateGroupRoomRosterToolUse } from './group-room-roster.mjs'

const members = [{ id: 'reviewer', displayName: 'Reviewer', connectorIds: ['mail'], skillIds: ['review'] }]

describe('Group Room fixed roster', () => {
  test('allows only one correctly scoped background worker per member', () => {
    const valid = { name: 'reviewer', subagent_type: 'general-purpose', expert_id: 'reviewer', connector_ids: ['mail'], skill_ids: ['review'] }
    expect(validateGroupRoomRosterToolUse({ toolName: 'Agent', input: valid, members, existingNames: new Set(), taskIds: new Set() })).toBeNull()
    expect(validateGroupRoomRosterToolUse({ toolName: 'Agent', input: valid, members, existingNames: new Set(['reviewer']), taskIds: new Set() })).toContain('SendMessage')
    expect(validateGroupRoomRosterToolUse({ toolName: 'Agent', input: { ...valid, connector_ids: ['drive'] }, members, existingNames: new Set(), taskIds: new Set() })).toContain('未分配')
    expect(validateGroupRoomRosterToolUse({ toolName: 'Agent', input: { ...valid, name: 'outsider', expert_id: 'outsider' }, members, existingNames: new Set(), taskIds: new Set() })).toContain('名单内')
  })

  test('routes follow-ups and stops only to created roster workers', () => {
    expect(validateGroupRoomRosterToolUse({ toolName: 'SendMessage', input: { to: 'reviewer', message: 'continue' }, members, existingNames: new Set(['reviewer']), taskIds: new Set(['agent-1']) })).toBeNull()
    expect(validateGroupRoomRosterToolUse({ toolName: 'SendMessage', input: { to: '*' }, members, existingNames: new Set(['reviewer']), taskIds: new Set() })).toContain('不能广播')
    expect(validateGroupRoomRosterToolUse({ toolName: 'TaskStop', input: { task_id: 'agent-1' }, members, existingNames: new Set(['reviewer']), taskIds: new Set(['agent-1']) })).toBeNull()
    expect(validateGroupRoomRosterToolUse({ toolName: 'TaskStop', input: { task_id: 'other' }, members, existingNames: new Set(['reviewer']), taskIds: new Set(['agent-1']) })).toContain('本群聊')
  })

  test('restores name-to-agent mapping from native Agent events', () => {
    const history = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Agent', input: { name: 'reviewer' } }] } },
      { type: 'user', parent_tool_use_id: 'tool-1', tool_use_result: { status: 'async_launched', agentId: 'agent-1', name: 'reviewer' } },
    ]
    expect(extractPersistedWorkerMappings(history, members)).toEqual([{ name: 'reviewer', agentId: 'agent-1' }])
  })

  test('keeps internal member ids out of child session titles', () => {
    expect(buildGroupRoomChildSessionTitle({ memberName: '代码检查员', agentName: 'member-1', description: 'member-1', agentType: 'general-purpose' })).toBe('代码检查员')
    expect(buildGroupRoomChildSessionTitle({ memberName: '代码检查员', agentName: 'member-1', description: '检查权限边界', agentType: 'general-purpose' })).toBe('代码检查员 · 检查权限边界')
  })
})
