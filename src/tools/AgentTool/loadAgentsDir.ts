export type AgentDefinition = Record<string, unknown>
export type CustomAgentDefinition = Record<string, unknown>
export type AgentDefinitionsResult = Record<string, unknown>

export function getAgentDefinitionsWithOverrides(): AgentDefinitionsResult {
  return {}
}

export function isBuiltInAgent(_name: string): boolean {
  return false
}

export function filterAgentsByMcpRequirements(_agents: unknown[]): unknown[] {
  return []
}

export function clearAgentDefinitionsCache(): void {}