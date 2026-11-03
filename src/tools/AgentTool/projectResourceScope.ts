import { resolve } from 'node:path'
import type { Tools } from '../../Tool.js'
import { normalizeNameForMCP } from '../../services/mcp/normalization.js'
import { getMcpToolInfo } from '../../services/mcp/mcpStringUtils.js'
import type { TaskScope } from '../../utils/sessionIdContext.js'
import { SKILL_TOOL_NAME } from '../SkillTool/constants.js'

function normalizeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values
    .map(value => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean)))
}

function requireKnownIds(kind: string, selected: string[], available: Set<string>): void {
  const unknown = selected.filter(id => !available.has(id))
  if (unknown.length > 0) {
    throw new Error(`Unknown scoped worker ${kind}: ${unknown.join(', ')}`)
  }
}

function isResourceScopedTask(taskScope: TaskScope | undefined): taskScope is Extract<TaskScope, { kind: 'project' }> {
  return taskScope?.kind === 'project'
}

export type ProjectWorkerResourceSelection = {
  appIds: string[]
  connectorIds: string[]
  skillIds: string[]
  skillCommands: string[]
  expertId: string | null
  expertInstructionsPath: string | null
  connectorServerNames: Set<string>
  environment: Record<string, string>
  selectedResourceDirectories: Set<string>
  allResourceDirectories: Set<string>
}

export function scopeProjectTaskScopeForWorker(
  taskScope: TaskScope | undefined,
  selection: ProjectWorkerResourceSelection | null,
): TaskScope | undefined {
  if (!selection || !isResourceScopedTask(taskScope) || !taskScope.projectResources) {
    return taskScope
  }
  const connectorIds = new Set(selection.connectorIds)
  const skillIds = new Set(selection.skillIds)
  const appIds = new Set(selection.appIds)
  return {
    ...taskScope,
    projectResources: {
      apps: (taskScope.projectResources.apps || [])
        .filter(item => appIds.has(item.id)),
      connectors: taskScope.projectResources.connectors
        .filter(item => connectorIds.has(item.id)),
      skills: taskScope.projectResources.skills
        .filter(item => skillIds.has(item.id)),
      experts: selection.expertId
        ? taskScope.projectResources.experts.filter(item => item.id === selection.expertId)
        : [],
    },
  }
}

export function getProjectConnectorScopeError(
  taskScope: TaskScope | undefined,
  input: { connectorId?: string; serverName?: string },
): string | null {
  if (!isResourceScopedTask(taskScope)) return null
  if (!taskScope.projectResources) return 'Scoped worker resource manifest is unavailable'
  const connectorId = input.connectorId?.trim()
  const serverName = input.serverName?.trim()
  const connectors = taskScope.projectResources.connectors
  if (connectorId && !connectors.some(item => item.id === connectorId)) {
    return `Connector '${connectorId}' is not assigned to this scoped worker`
  }
  if (serverName) {
    const normalizedServerName = normalizeNameForMCP(serverName)
    const assignedServerNames = new Set(connectors.flatMap(item => (
      normalizeIds(item.mcpServerNames).map(normalizeNameForMCP)
    )))
    if (!assignedServerNames.has(normalizedServerName)) {
      return `Connector server '${serverName}' is not assigned to this scoped worker`
    }
  }
  return null
}

export function resolveProjectWorkerResourceSelection(
  taskScope: TaskScope | undefined,
  input: {
    app_ids?: unknown
    connector_ids?: unknown
    skill_ids?: unknown
    expert_id?: unknown
  },
): ProjectWorkerResourceSelection | null {
  if (!isResourceScopedTask(taskScope)) return null
  if (!taskScope.projectResources) {
    throw new Error('Scoped worker resource manifest is unavailable')
  }
  const resources = taskScope.projectResources
  const apps = Array.isArray(resources.apps) ? resources.apps : []
  const connectors = Array.isArray(resources.connectors) ? resources.connectors : []
  const skills = Array.isArray(resources.skills) ? resources.skills : []
  const experts = Array.isArray(resources.experts) ? resources.experts : []
  const appIds = Array.isArray(input.app_ids)
    ? normalizeIds(input.app_ids)
    : apps.map(item => item.id)
  const connectorIds = Array.isArray(input.connector_ids)
    ? normalizeIds(input.connector_ids)
    : connectors.map(item => item.id)
  const skillIds = Array.isArray(input.skill_ids)
    ? normalizeIds(input.skill_ids)
    : skills.map(item => item.id)
  const expertId = typeof input.expert_id === 'string' && input.expert_id.trim()
    ? input.expert_id.trim()
    : null

  requireKnownIds('app ids', appIds, new Set(apps.map(item => item.id)))
  requireKnownIds('connector ids', connectorIds, new Set(connectors.map(item => item.id)))
  requireKnownIds('skill ids', skillIds, new Set(skills.map(item => item.id)))
  if (expertId && !experts.some(item => item.id === expertId)) {
    throw new Error(`Unknown scoped worker expert id: ${expertId}`)
  }

  const selectedConnectors = connectors.filter(item => connectorIds.includes(item.id))
  const selectedSkills = skills.filter(item => skillIds.includes(item.id))
  const selectedExpert = experts.find(item => item.id === expertId) ?? null
  const normalizeDirectories = (values: unknown) => normalizeIds(values).map(value => resolve(value))
  const allResourceDirectories = new Set([
    ...connectors.flatMap(item => normalizeDirectories(item.directories)),
    ...skills.flatMap(item => normalizeDirectories(item.directories)),
    ...experts.flatMap(item => normalizeDirectories(item.directories)),
  ])
  const selectedResourceDirectories = new Set([
    ...selectedConnectors.flatMap(item => normalizeDirectories(item.directories)),
    ...selectedSkills.flatMap(item => normalizeDirectories(item.directories)),
    ...(selectedExpert ? normalizeDirectories(selectedExpert.directories) : []),
  ])
  const serverNames = (items: typeof connectors) => new Set(items.flatMap(item => (
    normalizeIds(item.mcpServerNames).map(normalizeNameForMCP)
  )))
  const environment = Object.assign(
    {},
    ...selectedConnectors.map(item => item.environment ?? {}),
  ) as Record<string, string>

  return {
    appIds,
    connectorIds,
    skillIds,
    skillCommands: Array.from(new Set([
      ...selectedSkills.map(item => item.command).filter(Boolean),
      ...selectedConnectors.flatMap(item => normalizeIds(item.skillCommands)),
    ])),
    expertId,
    expertInstructionsPath: selectedExpert?.instructionsPath || null,
    connectorServerNames: serverNames(selectedConnectors),
    environment,
    selectedResourceDirectories,
    allResourceDirectories,
  }
}

export function filterToolsForProjectWorker(
  tools: Tools,
  selection: ProjectWorkerResourceSelection | null,
): Tools {
  if (!selection) return tools
  return tools.filter(tool => {
    if (tool.name === SKILL_TOOL_NAME) return false
    if (tool.appInfo) return selection.appIds.includes(tool.appInfo.appId)
    const info = getMcpToolInfo(tool)
    if (!info) return !tool.isMcp
    if (info.appId && selection.appIds.includes(info.appId)) return true
    return selection.connectorServerNames.has(normalizeNameForMCP(info.serverName))
  })
}

/** Native App tools live in the parent session's tool list, not MCP state. */
export function addProjectWorkerAppTools(
  tools: Tools,
  parentTools: Tools,
  selection: ProjectWorkerResourceSelection | null,
): Tools {
  if (!selection) return tools
  const parentAppTools = filterToolsForProjectWorker(
    parentTools.filter(tool => Boolean(tool.appInfo || tool.mcpInfo?.appId)),
    selection,
  )
  const seen = new Set<string>()
  return [...tools, ...parentAppTools].filter(tool => {
    if (seen.has(tool.name)) return false
    seen.add(tool.name)
    return true
  })
}

export function filterResourceDirectoriesForProjectWorker<T>(
  directories: ReadonlyMap<string, T>,
  selection: ProjectWorkerResourceSelection | null,
): Map<string, T> {
  if (!selection) return new Map(directories)
  return new Map(Array.from(directories.entries()).filter(([directory]) => {
    const normalized = resolve(directory)
    return !selection.allResourceDirectories.has(normalized) ||
      selection.selectedResourceDirectories.has(normalized)
  }))
}
