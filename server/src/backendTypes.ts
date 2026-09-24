import type {
  AdvancedSettings,
  AutoMemorySettings,
  SessionMemorySettings,
  SessionRuntimeOptions,
  SessionRuntimeInfo,
} from '../../packages/direct-connect-protocol/src/index.js'
import type { ThinkingMode, SystemSettingsImage } from './systemSettings.js'

export type { SessionRuntimeInfo }

export type BackendSystemSettings = {
  bypassPermissions: boolean
  model: string
  fastModel: string
  maxTurns: number
  thinkingMode: ThinkingMode
  thinkingBudgetTokens: number
  url: string
  apiKey: string
  image?: SystemSettingsImage
}

export type BackendSpawnOptions = {
  sessionId: string
  resumeSessionId?: string
  transcriptPath?: string
  backendManifestPath?: string
  cwd: string
  dangerouslySkipPermissions?: boolean
  unattended?: boolean
  userId?: string
  orgId?: string
  role?: string
  scopes?: string[]
  mountDirs?: string[]
  runtime: SessionRuntimeInfo
  assistantName?: string
  advancedSettings?: AdvancedSettings
  autoMemory?: AutoMemorySettings
  sessionMemory?: SessionMemorySettings
  runtimeOptions?: SessionRuntimeOptions
  systemSettings?: BackendSystemSettings
}

export type BackendHandle = {
  workDir: string
  runtime: SessionRuntimeInfo
  writeStdin: (data: string) => void
  interrupt: () => void
  onStdoutLine: (listener: (line: string) => void) => () => void
  onStderrLine: (listener: (line: string) => void) => () => void
  onExit: (
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ) => () => void
  destroy: (force?: boolean) => void
}

export interface SessionBackend {
  spawn(options: BackendSpawnOptions): Promise<BackendHandle>
}
