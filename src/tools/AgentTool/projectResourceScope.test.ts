import { describe, expect, test } from 'bun:test'
import type { Tool, Tools } from '../../Tool.js'
import type { TaskScope } from '../../utils/sessionIdContext.js'
import {
  filterResourceDirectoriesForProjectWorker,
  filterToolsForProjectWorker,
  getProjectConnectorScopeError,
  resolveProjectWorkerResourceSelection,
  scopeProjectTaskScopeForWorker,
} from './projectResourceScope.js'

const scope: TaskScope = {
  kind: 'project',
  projectId: 'project-1',
  sessionId: 'session-1',
  projectResources: {
    connectors: [
      { id: 'mail', mcpServerNames: ['qq-mail'], skillCommands: ['qq-mail'], directories: ['/connectors/mail'], environment: { QQ_MAIL_TOKEN: 'mail-secret' } },
      { id: 'meeting', mcpServerNames: ['tmeet'], directories: ['/connectors/meeting'], environment: { TMEET_TOKEN: 'meeting-secret' } },
    ],
    skills: [{ id: 'review', command: 'review', directories: ['/skills/review'] }],
    experts: [{ id: 'reviewer', instructionsPath: '/experts/reviewer/assistant.md', directories: ['/experts/reviewer'] }],
  },
}

describe('project worker resource scope', () => {
  test('validates and resolves an explicit worker assignment', () => {
    const selected = resolveProjectWorkerResourceSelection(scope, {
      connector_ids: ['mail'],
      skill_ids: ['review'],
      expert_id: 'reviewer',
    })
    expect(selected?.skillCommands).toEqual(['review', 'qq-mail'])
    expect(selected?.connectorServerNames).toEqual(new Set(['qq-mail']))
    expect(selected?.environment).toEqual({ QQ_MAIL_TOKEN: 'mail-secret' })
    expect(selected?.expertInstructionsPath).toBe('/experts/reviewer/assistant.md')
    const workerScope = scopeProjectTaskScopeForWorker(scope, selected)
    expect(workerScope?.kind === 'project' && workerScope.projectResources).toEqual({
      connectors: [scope.projectResources!.connectors[0]],
      skills: scope.projectResources!.skills,
      experts: scope.projectResources!.experts,
    })
    expect(getProjectConnectorScopeError(workerScope, { connectorId: 'mail' })).toBeNull()
    expect(getProjectConnectorScopeError(workerScope, { serverName: 'qq-mail' })).toBeNull()
    expect(getProjectConnectorScopeError(workerScope, { connectorId: 'meeting' }))
      .toContain('not assigned')
  })

  test('rejects resources outside the project manifest', () => {
    expect(() => resolveProjectWorkerResourceSelection(scope, {
      connector_ids: ['drive'],
    })).toThrow('Unknown scoped worker connector ids')
  })

  test('fails closed when a project resource manifest is unavailable', () => {
    expect(() => resolveProjectWorkerResourceSelection({
      kind: 'project',
      projectId: 'project-1',
    }, {})).toThrow('resource manifest is unavailable')
  })

  test('removes unassigned connector tools and the generic Skill entry', () => {
    const selected = resolveProjectWorkerResourceSelection(scope, { connector_ids: ['mail'] })
    const tools = [
      { name: 'Read' },
      { name: 'Skill' },
      { name: 'mcp__qq-mail__send' },
      { name: 'mcp__tmeet__create' },
      { name: 'mcp__unrelated__lookup' },
    ] as Tools
    expect(filterToolsForProjectWorker(tools, selected).map(tool => tool.name)).toEqual([
      'Read',
      'mcp__qq-mail__send',
    ])
  })

  test('removes unassigned resource directories', () => {
    const selected = resolveProjectWorkerResourceSelection(scope, {
      skill_ids: ['review'],
      expert_id: 'reviewer',
    })
    const directories = new Map<string, Tool | string>([
      ['/connectors/mail', 'mail'],
      ['/skills/review', 'review'],
      ['/experts/reviewer', 'reviewer'],
      ['/user/shared', 'shared'],
    ])
    expect(Array.from(filterResourceDirectoriesForProjectWorker(directories, selected).keys())).toEqual([
      '/skills/review',
      '/experts/reviewer',
      '/user/shared',
    ])
  })

  test('applies the same least-privilege manifest to group-room workers', () => {
    const roomScope: TaskScope = {
      kind: 'group-room',
      roomId: 'room-1',
      sessionId: 'session-1',
      projectResources: scope.kind === 'project' ? scope.projectResources! : { connectors: [], skills: [], experts: [] },
      memberResources: {
        reviewer: { connectorIds: ['mail'], skillIds: ['review'], expertId: 'reviewer' },
      },
    }
    const selection = resolveProjectWorkerResourceSelection(roomScope, {
      connector_ids: ['mail'],
      skill_ids: ['review'],
      expert_id: 'reviewer',
    })
    expect(selection?.connectorIds).toEqual(['mail'])
    expect(selection?.skillIds).toEqual(['review'])
    const workerScope = scopeProjectTaskScopeForWorker(roomScope, selection)
    expect(workerScope?.kind).toBe('group-room')
    expect(workerScope?.projectResources.connectors.map(item => item.id)).toEqual(['mail'])
  })
})
