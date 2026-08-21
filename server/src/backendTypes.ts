import type {
  SessionRuntimeInfo,
} from '../../packages/direct-connect-protocol/src/index.js'

export type { SessionRuntimeInfo }

export type BackendSpawnOptions = {
  sessionId: string
  resumeSessionId?: string
  transcriptPath?: string
  backendManifestPath?: string
  cwd: string
  dangerouslySkipPermissions?: boolean
  userId?: string
  orgId?: string
  role?: string
  scopes?: string[]
  runtime: SessionRuntimeInfo
  assistantName?: string
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
