import { describe, expect, test } from 'bun:test'
import { getBuiltInAgentCatalog } from './builtInAgents.js'

describe('built-in Agent catalog', () => {
  test('does not expose the removed Claude Code statusline worker', () => {
    const agentTypes = getBuiltInAgentCatalog().map(agent => agent.agentType)

    expect(agentTypes).toContain('general-purpose')
    expect(agentTypes).not.toContain('statusline-setup')
  })
})
