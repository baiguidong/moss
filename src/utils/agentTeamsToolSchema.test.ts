import { beforeEach, describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { AgentTool } from '../tools/AgentTool/AgentTool.js'
import { asSessionId } from '../types/ids.js'
import { toolToAPISchema } from './api.js'
import { runWithSessionIdContext } from './sessionIdContext.js'
import { clearToolSchemaCache, getToolSchemaCache } from './toolSchemaCache.js'

describe('Agent Teams tool exposure', () => {
  beforeEach(() => clearToolSchemaCache())

  test('keeps enabled and disabled Agent schemas isolated across desktop sessions', async () => {
    const permissionContext = getEmptyToolPermissionContext()
    const render = (sessionId: string, enabled: boolean) => runWithSessionIdContext(
      asSessionId(sessionId),
      null,
      () => toolToAPISchema(AgentTool, {
        getToolPermissionContext: async () => permissionContext,
        tools: [AgentTool],
        agents: [],
      }),
      undefined,
      { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: enabled ? '1' : '0' },
    )

    const disabled = await render('agent-schema-disabled', false)
    const enabled = await render('agent-schema-enabled', true)
    const disabledProperties = disabled.input_schema.properties ?? {}
    const enabledProperties = enabled.input_schema.properties ?? {}

    expect(disabledProperties).not.toHaveProperty('team_name')
    expect(disabledProperties).not.toHaveProperty('name')
    expect(disabledProperties).not.toHaveProperty('task_id')
    expect(enabledProperties).toHaveProperty('team_name')
    expect(enabledProperties).toHaveProperty('name')
    expect(enabledProperties).toHaveProperty('task_id')
    expect([...getToolSchemaCache().keys()]).toContain('Agent:agent-teams=off')
    expect([...getToolSchemaCache().keys()]).toContain('Agent:agent-teams=on')
  })
})
