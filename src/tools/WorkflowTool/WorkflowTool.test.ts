import { describe, expect, test } from 'bun:test'
import type { ToolUseContext } from '../../Tool.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import type { AppState } from '../../state/AppState.js'
import type { PermissionMode } from '../../types/permissions.js'
import type { WorkflowDefinitionV3 } from '../../utils/workflows/definition.js'
import { createWorkflowDraft, updateWorkflowDraft } from '../../utils/workflows/catalog.js'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveDefinitionForTesting, WorkflowTool } from './WorkflowTool.js'

const DEFINITION: WorkflowDefinitionV3 = {
  version: 3,
  kind: 'state-machine',
  meta: { name: 'demo', title: 'Demo', description: 'A demo' },
  graph: {
    entry: 'input',
    nodes: [
      { id: 'input', type: 'start', title: '开始', outputSchema: { type: 'object' } },
      { id: 'done', type: 'code', title: '完成', language: 'javascript', script: 'return true', outputSchema: { type: 'boolean' } },
      { id: 'output', type: 'end', title: '结束', inputSchema: { type: 'boolean' }, input: [{ target: [], source: { kind: 'node-output', nodeId: 'done' } }] },
    ],
    edges: [
      { source: 'input', target: 'done' },
      { source: 'done', target: 'output' },
    ],
  },
}

function makeContext(options: {
  mode?: PermissionMode
  isNonInteractiveSession?: boolean
  allowRules?: string[]
  ultracode?: boolean
}): ToolUseContext {
  const permissionContext = {
    ...getEmptyToolPermissionContext(),
    mode: options.mode ?? 'default',
    ...(options.allowRules
      ? {
          alwaysAllowRules: {
            localSettings: options.allowRules.map(
              content => `${WorkflowTool.name}(${content})`,
            ),
          },
        }
      : {}),
  }
  return {
    options: {
      isNonInteractiveSession: options.isNonInteractiveSession ?? false,
    },
    getAppState: () =>
      ({
        toolPermissionContext: permissionContext,
        ultracode: options.ultracode ?? false,
      }) as unknown as AppState,
  } as unknown as ToolUseContext
}

describe('WorkflowTool.checkPermissions', () => {
  test('registers with the public WorkflowRun tool name', () => {
    expect(WorkflowTool.name).toBe('WorkflowRun')
  })

  test('asks before starting a run in default mode', async () => {
    const result = await WorkflowTool.checkPermissions(
      { name: 'deep-research' },
      makeContext({ mode: 'default' }),
    )
    expect(result.behavior).toBe('ask')
    if (result.behavior !== 'ask') return
    expect(result.message).toContain('spawn many subagents')
    // The "don't ask again" option needs a rule to write.
    expect(result.suggestions?.[0]).toMatchObject({
      type: 'addRules',
      behavior: 'allow',
      destination: 'localSettings',
    })
  })

  test('still asks before launch in acceptEdits while nodes inherit that mode', async () => {
    const result = await WorkflowTool.checkPermissions(
      { name: 'deep-research' },
      makeContext({ mode: 'acceptEdits' }),
    )
    expect(result.behavior).toBe('ask')
  })

  test('allows without prompting under bypassPermissions', async () => {
    const result = await WorkflowTool.checkPermissions(
      { name: 'deep-research' },
      makeContext({ mode: 'bypassPermissions' }),
    )
    expect(result.behavior).toBe('allow')
  })

  test('allows in a non-interactive session, where nobody can answer', async () => {
    const result = await WorkflowTool.checkPermissions(
      { name: 'deep-research' },
      makeContext({ isNonInteractiveSession: true }),
    )
    expect(result.behavior).toBe('allow')
  })

  test('an allow rule for one workflow does not cover another', async () => {
    const context = makeContext({ allowRules: ['deep-research'] })
    const allowed = await WorkflowTool.checkPermissions(
      { name: 'deep-research' },
      context,
    )
    expect(allowed.behavior).toBe('allow')

    const other = await WorkflowTool.checkPermissions(
      { name: 'something-else' },
      context,
    )
    expect(other.behavior).toBe('ask')
  })

  test('an exported definition path has no rule to match, so it always asks', async () => {
    const result = await WorkflowTool.checkPermissions(
      { definitionPath: '/tmp/demo.workflow.json' },
      makeContext({ allowRules: ['x'] }),
    )
    expect(result.behavior).toBe('ask')
    if (result.behavior !== 'ask') return
    expect(result.suggestions).toBeUndefined()
  })
})

describe('resolveDefinition', () => {
  test('a named workflow carries no definitionPath, so the run gets a session copy', async () => {
    const resolved = await resolveDefinitionForTesting({ name: 'deep-research' })
    expect('definition' in resolved && resolved.definition.meta.name).toBe('deep-research')
    // Pointing the run at ~/.moss/workflows/<name>.workflow.json would make it write
    // back over the user's file, and a later resume would replay whatever that
    // file says rather than what actually ran.
    expect(
      (resolved as { definitionPath?: string }).definitionPath,
    ).toBeUndefined()
  })

  test('an explicit definitionPath is preserved so a resume reads the edited file', async () => {
    const resolved = await resolveDefinitionForTesting({
      definitionPath: '/definitely/not/here.workflow.json',
    })
    expect('error' in resolved && resolved.error).toContain('Failed to read')
  })

  test('resolves an exact immutable catalog revision', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'moss-workflow-run-revision-'))
    try {
      const created = await createWorkflowDraft({ definition: DEFINITION, scope: 'project', cwd })
      await updateWorkflowDraft({
        workflowId: created.record.id,
        baseRevision: 1,
        cwd,
        definition: { ...DEFINITION, meta: { ...DEFINITION.meta, title: 'Revision two' } },
      })
      const resolved = await resolveDefinitionForTesting({
        workflowId: created.record.id,
        revision: 1,
        cwd,
      })
      expect('definition' in resolved && resolved.definition.meta.title).toBe('Demo')
      expect('definition' in resolved && resolved.revision).toBe(1)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('WorkflowTool.call', () => {
  test('rejects a call with no workflowId, definitionPath, or name', async () => {
    await expect(
      WorkflowTool.call(
        {},
        makeContext({ mode: 'bypassPermissions' }),
        (() => {}) as never,
      ),
    ).rejects.toThrow('requires exactly one of `workflowId`, `definitionPath`, or `name`')
  })

  test('surfaces a definition validation error', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'moss-workflow-invalid-'))
    const definitionPath = join(cwd, 'invalid.workflow.json')
    try {
      await writeFile(definitionPath, JSON.stringify({
        ...DEFINITION,
        meta: { ...DEFINITION.meta, title: '' },
      }))
      await expect(
        WorkflowTool.call(
          { definitionPath },
          makeContext({ mode: 'bypassPermissions' }),
          (() => {}) as never,
        ),
      ).rejects.toThrow()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('rejects invalid JavaScript inside a code node before launch', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'moss-workflow-invalid-code-'))
    const definitionPath = join(cwd, 'invalid-code.workflow.json')
    try {
      await writeFile(definitionPath, JSON.stringify({
        ...DEFINITION,
        graph: {
          ...DEFINITION.graph,
          nodes: DEFINITION.graph.nodes.map(node => node.id === 'done'
            ? { ...node, id: 'invalid-code', title: '无效代码', script: 'return (' }
            : node.id === 'output'
              ? { ...node, input: [{ target: [], source: { kind: 'node-output' as const, nodeId: 'invalid-code' } }] }
            : node),
          edges: [
            { source: 'input', target: 'invalid-code' },
            { source: 'invalid-code', target: 'output' },
          ],
        },
      }))
      await expect(
        WorkflowTool.call(
          { definitionPath },
          makeContext({ mode: 'bypassPermissions' }),
          (() => {}) as never,
        ),
      ).rejects.toThrow('invalid-code')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
  test('reports a missing named workflow with the available list', async () => {
    await expect(
      WorkflowTool.call(
        { name: 'no-such-workflow' },
        makeContext({ mode: 'bypassPermissions' }),
        (() => {}) as never,
      ),
    ).rejects.toThrow("Unknown workflow 'no-such-workflow'")
  })
})
