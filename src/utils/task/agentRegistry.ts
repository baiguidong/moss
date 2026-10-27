import type { TaskStatus } from '../../Task.js'

/** Structural task subset keeps this module independent of AppState's TaskState union. */
type RegistryTask = {
  id: string
  type: string
  status: TaskStatus
  startTime: number
  agentId?: string
  agentType?: string
  identity?: { agentId: string }
  parentId?: string
  depth?: number
  needsInput?: boolean
  lastHeartbeat?: number
  budget?: AgentTaskBudget
}

/** Runtime budget tracked alongside an agent task. */
export type AgentTaskBudget = {
  /** Optional token ceiling for the agent's accumulated progress. */
  maxTokens?: number
  /** Optional turn ceiling (usually sourced from agent frontmatter). */
  maxTurns?: number
  usedTokens: number
  usedTurns: number
}

/** Stable, serialisable view used by CLI, Electron and WebUI consumers. */
export type AgentRegistryEntry = {
  taskId: string
  agentId?: string
  parentId?: string
  depth: number
  status: TaskStatus
  needsInput: boolean
  lastHeartbeat: number
  budget?: AgentTaskBudget
}

export type AgentRegistryPolicy = {
  /** Maximum active agent tasks. Infinity disables this limit. */
  maxConcurrent: number
  /** Maximum nesting depth (root agent is depth 0). */
  maxDepth: number
}

export type AgentSpawnRequest = {
  parentId?: string
  budget?: AgentTaskBudget
}

export type AgentSpawnDecision =
  | { allowed: true; depth: number }
  | { allowed: false; reason: 'max_concurrent' | 'max_depth'; depth: number }

const DEFAULT_MAX_CONCURRENT = 64
const DEFAULT_MAX_DEPTH = 8

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** Read limits once per decision so test and embedded hosts can override env. */
export function getAgentRegistryPolicy(
  env: Record<string, string | undefined> = process.env,
): AgentRegistryPolicy {
  return {
    maxConcurrent: positiveInteger(
      env.MOSS_AGENT_MAX_CONCURRENT,
      DEFAULT_MAX_CONCURRENT,
    ),
    maxDepth: positiveInteger(env.MOSS_AGENT_MAX_DEPTH, DEFAULT_MAX_DEPTH),
  }
}

function isAgentTask(task: RegistryTask): boolean {
  return (
    (task.type === 'local_agent' || task.type === 'in_process_teammate') &&
    task.agentType !== 'main-session'
  )
}

function getTaskAgentId(task: RegistryTask): string | undefined {
  if (task.type === 'local_agent') return task.agentId
  if (task.type === 'in_process_teammate') return task.identity?.agentId
  return undefined
}

function getParentDepth(
  tasks: Record<string, RegistryTask>,
  parentId: string | undefined,
): number {
  if (!parentId) return -1
  const parent = Object.values(tasks).find(
    task => task.id === parentId || getTaskAgentId(task) === parentId,
  )
  return parent?.type === 'local_agent' || parent?.type === 'in_process_teammate'
    ? (parent.depth ?? 0)
    : -1
}

/** Convert task state into the common registry representation. */
export function toAgentRegistryEntry(task: RegistryTask): AgentRegistryEntry | undefined {
  if (
    task.type !== 'local_agent' &&
    task.type !== 'in_process_teammate'
  ) return undefined
  const budget = task.budget
    ? {
        maxTokens: task.budget.maxTokens,
        maxTurns: task.budget.maxTurns,
        usedTokens: task.budget.usedTokens,
        usedTurns: task.budget.usedTurns,
      }
    : undefined
  return {
    taskId: task.id,
    agentId: getTaskAgentId(task),
    parentId: task.parentId,
    depth: task.depth ?? 0,
    status: task.status,
    needsInput: task.needsInput ?? false,
    lastHeartbeat: task.lastHeartbeat ?? task.startTime,
    ...(budget ? { budget } : {}),
  }
}

export function buildAgentRegistry(
  tasks: Record<string, RegistryTask>,
): Record<string, AgentRegistryEntry> {
  const registry: Record<string, AgentRegistryEntry> = {}
  for (const task of Object.values(tasks)) {
    const entry = toAgentRegistryEntry(task)
    if (entry) registry[entry.taskId] = entry
  }
  return registry
}

/** Decide whether a new agent can be registered under the configured policy. */
export function canSpawnAgent(
  tasks: Record<string, RegistryTask>,
  request: AgentSpawnRequest = {},
  policy: AgentRegistryPolicy = getAgentRegistryPolicy(),
): AgentSpawnDecision {
  const active = Object.values(tasks).filter(
    task => isAgentTask(task) && (task.status === 'pending' || task.status === 'running'),
  ).length
  const parentDepth = getParentDepth(tasks, request.parentId)
  const depth = parentDepth + 1
  if (active >= policy.maxConcurrent) {
    return { allowed: false, reason: 'max_concurrent', depth }
  }
  if (depth > policy.maxDepth) {
    return { allowed: false, reason: 'max_depth', depth }
  }
  return { allowed: true, depth }
}

/** Human-readable error used by spawn paths and structured clients. */
export class AgentRegistryLimitError extends Error {
  readonly decision: Extract<AgentSpawnDecision, { allowed: false }>

  constructor(decision: Extract<AgentSpawnDecision, { allowed: false }>) {
    const limit = decision.reason === 'max_concurrent' ? '并发 agent 数量' : 'agent 嵌套深度'
    super(`无法启动 agent：超过${limit}限制（depth=${decision.depth}）。`)
    this.name = 'AgentRegistryLimitError'
    this.decision = decision
  }
}

export function assertAgentSpawnAllowed(
  tasks: Record<string, RegistryTask>,
  request: AgentSpawnRequest = {},
  policy?: AgentRegistryPolicy,
): number {
  const decision = canSpawnAgent(tasks, request, policy)
  if (!decision.allowed) throw new AgentRegistryLimitError(decision)
  return decision.depth
}
