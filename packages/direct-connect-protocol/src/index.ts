import { z } from 'zod/v4'

export type SessionRuntimeBackend = 'host' | 'docker'
export type SessionProfileMode = 'session' | 'user'

export type AutoMemorySettings = {
  enabled: boolean
  extractionEnabled: boolean
  extractionIntervalTurns: number
  pastContextSearchEnabled: boolean
  dreamEnabled: boolean
  dreamMinHours: number
  dreamMinSessions: number
}

export type SessionMemorySettings = {
  enabled: boolean
  compactEnabled: boolean
  minimumMessageTokensToInit: number
  minimumTokensBetweenUpdate: number
  toolCallsBetweenUpdates: number
  compactMinTokens: number
  compactMinTextBlockMessages: number
  compactMaxTokens: number
}

export type AdvancedSettings = {
  moss_auto_background_agents: boolean
  moss_scratchpad: boolean
  moss_idle_session_cleanup: boolean
  moss_streaming_tool_execution: boolean
  moss_plan_mode_interview: boolean
  moss_fast_web_search: boolean
  moss_memory_learn_from_corrections: boolean
  moss_large_tool_result_protection: boolean
  moss_tool_result_budget_chars: number
  moss_mcp_output_token_limit: number
  moss_file_read_max_size_bytes: number
  moss_file_read_max_tokens: number
  moss_request_attribution_enabled: boolean
  moss_context_compaction_strategy: 'proactive' | 'reactive'
}

export const DEFAULT_AUTO_MEMORY_SETTINGS: AutoMemorySettings = Object.freeze({
  enabled: true,
  extractionEnabled: false,
  extractionIntervalTurns: 1,
  pastContextSearchEnabled: false,
  dreamEnabled: false,
  dreamMinHours: 24,
  dreamMinSessions: 5,
})

export const DEFAULT_SESSION_MEMORY_SETTINGS: SessionMemorySettings = Object.freeze({
  enabled: true,
  compactEnabled: true,
  minimumMessageTokensToInit: 10_000,
  minimumTokensBetweenUpdate: 5_000,
  toolCallsBetweenUpdates: 3,
  compactMinTokens: 10_000,
  compactMinTextBlockMessages: 5,
  compactMaxTokens: 40_000,
})

export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = Object.freeze({
  moss_auto_background_agents: false,
  moss_scratchpad: false,
  moss_idle_session_cleanup: false,
  moss_streaming_tool_execution: false,
  moss_plan_mode_interview: true,
  moss_fast_web_search: false,
  moss_memory_learn_from_corrections: false,
  moss_large_tool_result_protection: false,
  moss_tool_result_budget_chars: 200_000,
  moss_mcp_output_token_limit: 25_000,
  moss_file_read_max_size_bytes: 256 * 1024,
  moss_file_read_max_tokens: 25_000,
  moss_request_attribution_enabled: true,
  moss_context_compaction_strategy: 'proactive',
})

export type SessionRuntimeOptions = {
  profileMode?: SessionProfileMode
}

export type SessionRuntimeInfo = {
  backend: SessionRuntimeBackend
  profileMode: SessionProfileMode
  dockerImage?: string
  containerName?: string
  profileDir: string
  transcriptDir: string
  workspaceDir?: string
}

function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined
  return () => (cached ??= factory())
}

export const autoMemorySettingsSchema = lazySchema(() =>
  z.object({
    enabled: z.boolean().optional(),
    extractionEnabled: z.boolean().optional(),
    extractionIntervalTurns: z.number().int().min(1).max(10_000).optional(),
    pastContextSearchEnabled: z.boolean().optional(),
    dreamEnabled: z.boolean().optional(),
    dreamMinHours: z.number().min(0.1).max(24 * 365).optional(),
    dreamMinSessions: z.number().int().min(1).max(100_000).optional(),
  }),
)

export const sessionMemorySettingsSchema = lazySchema(() =>
  z.object({
    enabled: z.boolean().optional(),
    compactEnabled: z.boolean().optional(),
    minimumMessageTokensToInit: z.number().int().min(1).max(1_000_000).optional(),
    minimumTokensBetweenUpdate: z.number().int().min(1).max(1_000_000).optional(),
    toolCallsBetweenUpdates: z.number().int().min(1).max(10_000).optional(),
    compactMinTokens: z.number().int().min(1).max(1_000_000).optional(),
    compactMinTextBlockMessages: z.number().int().min(1).max(10_000).optional(),
    compactMaxTokens: z.number().int().min(1).max(1_000_000).optional(),
  }),
)

export const advancedSettingsSchema = lazySchema(() =>
  z.object({
    moss_auto_background_agents: z.boolean().optional(),
    moss_scratchpad: z.boolean().optional(),
    moss_idle_session_cleanup: z.boolean().optional(),
    moss_streaming_tool_execution: z.boolean().optional(),
    moss_plan_mode_interview: z.boolean().optional(),
    moss_fast_web_search: z.boolean().optional(),
    moss_memory_learn_from_corrections: z.boolean().optional(),
    moss_large_tool_result_protection: z.boolean().optional(),
    moss_tool_result_budget_chars: z.number().int().min(1).max(10_000_000).optional(),
    moss_mcp_output_token_limit: z.number().int().min(1).max(1_000_000).optional(),
    moss_file_read_max_size_bytes: z.number().int().min(1).max(1_000_000_000).optional(),
    moss_file_read_max_tokens: z.number().int().min(1).max(1_000_000).optional(),
    moss_request_attribution_enabled: z.boolean().optional(),
    moss_context_compaction_strategy: z.enum(['proactive', 'reactive']).optional(),
  }),
)

export function normalizeAutoMemorySettings(value: unknown): AutoMemorySettings {
  const parsed = autoMemorySettingsSchema().safeParse(value)
  return parsed.success
    ? { ...DEFAULT_AUTO_MEMORY_SETTINGS, ...parsed.data }
    : { ...DEFAULT_AUTO_MEMORY_SETTINGS }
}

export function normalizeSessionMemorySettings(value: unknown): SessionMemorySettings {
  const parsed = sessionMemorySettingsSchema().safeParse(value)
  const normalized = parsed.success
    ? { ...DEFAULT_SESSION_MEMORY_SETTINGS, ...parsed.data }
    : { ...DEFAULT_SESSION_MEMORY_SETTINGS }
  if (normalized.compactMaxTokens < normalized.compactMinTokens) {
    normalized.compactMaxTokens = normalized.compactMinTokens
  }
  return normalized
}

export function normalizeAdvancedSettings(value: unknown): AdvancedSettings {
  const parsed = advancedSettingsSchema().safeParse(value)
  return parsed.success
    ? { ...DEFAULT_ADVANCED_SETTINGS, ...parsed.data }
    : { ...DEFAULT_ADVANCED_SETTINGS }
}

export const runtimeInfoSchema = lazySchema(() =>
  z.object({
    backend: z.enum(['host', 'docker']),
    profileMode: z.enum(['session', 'user']),
    dockerImage: z.string().optional(),
    containerName: z.string().optional(),
    profileDir: z.string(),
    transcriptDir: z.string(),
    workspaceDir: z.string().optional(),
  }),
)

export const connectResponseSchema = lazySchema(() =>
  z.object({
    session_id: z.string(),
    ws_url: z.string(),
    work_dir: z.string().optional(),
    runtime: runtimeInfoSchema().optional(),
  }),
)

export const attachSessionResponseSchema = lazySchema(() =>
  z.object({
    session: z.object({
      sessionId: z.string(),
      transcriptSessionId: z.string(),
      workDir: z.string(),
      userId: z.string(),
      orgId: z.string(),
      role: z.string(),
      scopes: z.array(z.string()),
      runtime: runtimeInfoSchema(),
      autoMemory: autoMemorySettingsSchema().optional(),
      sessionMemory: sessionMemorySettingsSchema().optional(),
      advancedSettings: advancedSettingsSchema().optional(),
      status: z.string(),
      desiredState: z.string(),
      createdAt: z.number(),
      lastActiveAt: z.number(),
      endedAt: z.number().nullable().optional(),
    }),
    ws_url: z.string(),
  }),
)

export { buildConnectUrl, parseConnectUrl } from './connectUrl.js'
