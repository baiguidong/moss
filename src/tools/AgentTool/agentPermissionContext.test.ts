import { describe, expect, test } from 'bun:test'
import type { ToolPermissionContext } from '../../Tool.js'
import { BashTool } from '../BashTool/BashTool.js'
import { WebSearchTool } from '../WebSearchTool/WebSearchTool.js'
import { hasPermissionsToUseTool } from '../../utils/permissions/permissions.js'
import { createReadOnlyWorkspaceSandboxConfig } from '../../utils/sandbox/sandbox-adapter.js'
import { resolveAgentTools } from './agentToolUtils.js'
import { applyAgentPermissionConstraints } from './agentPermissionContext.js'
import { VERIFICATION_AGENT } from './built-in/verificationAgent.js'

function permissionContext(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  }
}

describe('agent permission constraints', () => {
  test('verification cannot inherit bypass mode or allow rules', () => {
    const parent = permissionContext({
      mode: 'bypassPermissions',
      isBypassPermissionsModeAvailable: true,
      alwaysAllowRules: {
        session: [
          {
            ruleValue: { toolName: 'Bash' },
            ruleBehavior: 'allow',
            source: 'session',
          },
        ],
      },
    })

    const result = applyAgentPermissionConstraints(
      VERIFICATION_AGENT,
      parent,
      parent,
    )

    expect(result.mode).toBe('dontAsk')
    expect(result.alwaysAllowRules).toEqual({})
    expect(result.isBypassPermissionsModeAvailable).toBe(false)
  })

  test('ordinary agent permission modes still defer to a privileged parent', () => {
    const parent = permissionContext({ mode: 'acceptEdits' })

    expect(
      applyAgentPermissionConstraints(
        { permissionMode: 'dontAsk' },
        parent,
        parent,
      ),
    ).toBe(parent)
  })

  test('read-only workspace sandbox preserves existing read restrictions', () => {
    const config = createReadOnlyWorkspaceSandboxConfig('/workspace', {
      denyRead: ['/secret'],
      allowRead: ['/secret/public'],
      allowWrite: ['/workspace'],
      denyWrite: ['/protected'],
    })

    expect(config.filesystem).toEqual({
      denyRead: ['/secret'],
      allowRead: ['/secret/public'],
      allowWrite: [expect.any(String)],
      denyWrite: ['/protected', '/workspace'],
    })
  })

  test('verification exposes only its explicit built-in tool allowlist', () => {
    const resolved = resolveAgentTools(
      VERIFICATION_AGENT,
      [
        BashTool,
        WebSearchTool,
        { ...WebSearchTool, name: 'Skill' },
        { ...WebSearchTool, name: 'mcp__unsafe__write' },
      ],
      true,
    )

    expect(resolved.resolvedTools.map(tool => tool.name)).toEqual([
      'Bash',
      'WebSearch',
    ])
  })

  test('sandboxed verification commands can pass dontAsk permission checks', async () => {
    const toolPermissionContext = applyAgentPermissionConstraints(
      VERIFICATION_AGENT,
      permissionContext({ mode: 'bypassPermissions' }),
      permissionContext({ mode: 'bypassPermissions' }),
    )
    const context = {
      abortController: new AbortController(),
      allowReadOnlyTools: true,
      bashSandboxConfig: createReadOnlyWorkspaceSandboxConfig(process.cwd()),
      getAppState: () => ({ toolPermissionContext }),
    }

    const decision = await hasPermissionsToUseTool(
      BashTool,
      { command: 'touch verification-must-not-write' },
      context as never,
      undefined as never,
      'verification-permission-test',
    )

    expect(decision.behavior).toBe('allow')
    expect(decision.decisionReason).toEqual({
      type: 'other',
      reason: 'Command is restricted by the agent Bash sandbox',
    })

    const webDecision = await hasPermissionsToUseTool(
      WebSearchTool,
      { query: 'moss verification' },
      context as never,
      undefined as never,
      'verification-web-permission-test',
    )
    expect(webDecision.behavior).toBe('allow')
    expect(webDecision.decisionReason).toEqual({
      type: 'other',
      reason: 'Read-only tool is allowed for this agent',
    })
  })
})
