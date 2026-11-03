import { describe, expect, test } from 'bun:test'
import type { Tool, Tools } from '../../Tool.js'
import type { TaskScope } from '../../utils/sessionIdContext.js'
import {
  filterResourceDirectoriesForProjectWorker,
  addProjectWorkerAppTools,
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
    apps: [{ id: 'docs' }, { id: 'mail-app' }],
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
      app_ids: ['docs'],
      connector_ids: ['mail'],
      skill_ids: ['review'],
      expert_id: 'reviewer',
    })
    expect(selected?.skillCommands).toEqual(['review', 'qq-mail'])
    expect(selected?.appIds).toEqual(['docs'])
    expect(selected?.connectorServerNames).toEqual(new Set(['qq-mail']))
    expect(selected?.environment).toEqual({ QQ_MAIL_TOKEN: 'mail-secret' })
    expect(selected?.expertInstructionsPath).toBe('/experts/reviewer/assistant.md')
    const workerScope = scopeProjectTaskScopeForWorker(scope, selected)
    expect(workerScope?.kind === 'project' && workerScope.projectResources).toEqual({
      apps: [scope.projectResources!.apps[0]],
      connectors: [scope.projectResources!.connectors[0]],
      skills: scope.projectResources!.skills,
      experts: scope.projectResources!.experts,
    })
    expect(getProjectConnectorScopeError(workerScope, { connectorId: 'mail' })).toBeNull()
    expect(getProjectConnectorScopeError(workerScope, { serverName: 'qq-mail' })).toBeNull()
    expect(getProjectConnectorScopeError(workerScope, { connectorId: 'meeting' }))
      .toContain('not assigned')
  })

  test('inherits project Apps, connectors, and skills when fields are omitted', () => {
    const selected = resolveProjectWorkerResourceSelection(scope, {})
    expect(selected?.appIds).toEqual(['docs', 'mail-app'])
    expect(selected?.connectorIds).toEqual(['mail', 'meeting'])
    expect(selected?.skillIds).toEqual(['review'])
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
    const selected = resolveProjectWorkerResourceSelection(scope, { app_ids: ['mail-app'], connector_ids: ['mail'] })
    const tools = [
      { name: 'Read' },
      { name: 'Skill' },
      { name: 'app__docs__create', appInfo: { appId: 'docs' } },
      { name: 'app__mail-app__create', appInfo: { appId: 'mail-app' } },
      { name: 'mcp__qq-mail__send' },
      { name: 'mcp__tmeet__create' },
      { name: 'mcp__unrelated__lookup' },
    ] as Tools
    expect(filterToolsForProjectWorker(tools, selected).map(tool => tool.name)).toEqual([
      'Read',
      'app__mail-app__create',
      'mcp__qq-mail__send',
    ])
  })

  test('adds only assigned native App tools from the parent pool', () => {
    const selected = resolveProjectWorkerResourceSelection(scope, { app_ids: ['docs'] })
    const workerPool = [{ name: 'Read' }] as Tools
    const parentPool = [
      { name: 'app__docs__create', appInfo: { appId: 'docs' } },
      { name: 'app__mail-app__create', appInfo: { appId: 'mail-app' } },
      { name: 'Read' },
    ] as Tools
    expect(addProjectWorkerAppTools(workerPool, parentPool, selected).map(tool => tool.name)).toEqual([
      'Read',
      'app__docs__create',
    ])
  })

  test('removes unassigned resource directories', () => {
    const selected = resolveProjectWorkerResourceSelection(scope, {
      app_ids: [],
      connector_ids: [],
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

})
