import { describe, expect, test } from 'bun:test'
import {
  WorkflowCatalogTools,
  WorkflowCreateTool,
  WorkflowEditTool,
  WorkflowManageTool,
  workflowOrigin,
} from './WorkflowCatalogTools.js'
import { WorkflowRunTool } from './WorkflowTool.js'
import { parseWorkflowDefinition } from '../../utils/workflows/definition.js'
import { getWorkflowAuthoringPrompt, getWorkflowRunPrompt } from './prompt.js'
import { isDeferredTool } from '../ToolSearchTool/prompt.js'
import { expandMatchesWithConfiguredGroups } from '../ToolSearchTool/ToolSearchTool.js'
import { runWithSessionIdContext } from '../../utils/sessionIdContext.js'
import { asSessionId } from '../../types/ids.js'
import type { ToolUseContext } from '../../Tool.js'
import { MOSS_RUNTIME_ADVANCED_SETTINGS_ENV } from '../../services/advancedSettings.js'

const GENERIC_DEFINITION = {
  version: 3,
  kind: 'state-machine',
  meta: { name: 'normalize-input', title: '整理输入', description: '整理并返回输入内容' },
  graph: {
    entry: 'input',
    nodes: [
      { id: 'input', type: 'start', title: '输入内容', outputSchema: { type: 'object' } },
      {
        id: 'normalize', type: 'code', title: '整理内容', language: 'javascript',
        input: [{ target: [], source: { kind: 'workflow-input' } }],
        outputSchema: { type: 'object' }, script: 'return input',
      },
      {
        id: 'output', type: 'end', title: '输出结果', inputSchema: { type: 'object' },
        input: [{ target: [], source: { kind: 'node-output', nodeId: 'normalize' } }],
      },
    ],
    edges: [{ source: 'input', target: 'normalize' }, { source: 'normalize', target: 'output' }],
  },
} as const

describe('workflow catalog tools', () => {
  test('exposes separate create, edit, and lifecycle operations', () => {
    expect(WorkflowCreateTool.name).toBe('WorkflowCreate')
    expect(WorkflowEditTool.name).toBe('WorkflowEdit')
    expect(WorkflowManageTool.name).toBe('WorkflowManage')
    expect(WorkflowManageTool.isReadOnly({ action: 'list' })).toBe(true)
    expect(WorkflowManageTool.isReadOnly({ action: 'get' })).toBe(true)
    expect(WorkflowManageTool.isReadOnly({ action: 'publish' })).toBe(false)
    expect(WorkflowManageTool.isDestructive?.({ action: 'delete' })).toBe(true)
  })

  test('keeps the authoring contract generic, explicit, and concise', () => {
    expect(parseWorkflowDefinition(GENERIC_DEFINITION)).toMatchObject({ ok: true })
    const prompt = getWorkflowAuthoringPrompt()
    expect(prompt).toContain('never output Mermaid')
    expect(prompt).toContain('Include only stages requested by the user')
    expect(prompt).toContain('Never mention StructuredOutput')
    expect(prompt).toContain('A failed run is diagnostic evidence, not permission to edit the Definition')
    expect(prompt).toContain('only explicitly bound values')
    expect(prompt).toContain('Do not set model or effort fields')
    expect(prompt).toContain('Never derive short per-Agent deadlines')
    expect(prompt).not.toContain('Canonical Review loop')
    expect(prompt.length).toBeLessThan(5_000)
    expect(getWorkflowRunPrompt().length).toBeLessThan(1_500)
  })

  test('sends a referenced, strongly typed authoring schema while runtime validation stays strict', () => {
    const schema = WorkflowCreateTool.inputJSONSchema
    const serialized = JSON.stringify(schema)
    expect(serialized.length).toBeLessThan(15_000)
    expect(Object.keys((schema?.$defs ?? {}) as object).length).toBeGreaterThan(20)
    expect(serialized).toContain('"$ref"')
    expect(serialized).toContain('"agent"')
    expect(serialized).toContain('"back"')
    expect(serialized).not.toContain('"model"')
    expect(serialized).not.toContain('"effort"')
    expect(serialized).not.toContain('"stallMs"')
    expect(serialized).not.toContain('Compact envelope')
  })

  test('loads Workflow tools as one configurable on-demand group', () => {
    const tools = [WorkflowRunTool, ...WorkflowCatalogTools]
    expect(tools.every(isDeferredTool)).toBe(true)
    expect(expandMatchesWithConfiguredGroups(['WorkflowCreate'], tools))
      .toEqual(['WorkflowRun', 'WorkflowCreate', 'WorkflowEdit', 'WorkflowManage'])

    runWithSessionIdContext(
      asSessionId('workflow-loading-test'),
      undefined,
      () => {
        expect(tools.every(tool => !isDeferredTool(tool))).toBe(true)
        expect(tools.every(tool => tool.isEnabled())).toBe(false)
      },
      undefined,
      {
        [MOSS_RUNTIME_ADVANCED_SETTINGS_ENV]: JSON.stringify({
          moss_tool_loading: Object.fromEntries(tools.map(tool => [tool.name, 'always'])),
          moss_workflows_enabled: false,
        }),
      },
    )
  })

  test('associates drafts with the stable owning conversation', () => {
    const value = runWithSessionIdContext(
      asSessionId('runtime-session'),
      null,
      () => workflowOrigin({ toolUseId: 'tool-1' } as unknown as ToolUseContext),
      { kind: 'session', sessionId: 'desktop-session' },
    )
    expect(value).toEqual({ sessionId: 'desktop-session', toolUseId: 'tool-1' })
  })
})
