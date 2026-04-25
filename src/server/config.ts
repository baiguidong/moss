import { mkdir, readFile } from 'fs/promises'
import { dirname, join } from 'path'
import { serverFileConfigSchema, type ServerConfig, type ServerFileConfig } from './types.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { expandPath } from '../utils/path.js'

export function getDefaultServerConfigPath(): string {
  return join(getClaudeConfigHomeDir(), 'server', 'server.json')
}

function normalizePath(input: string): string {
  return expandPath(input)
}

function resolveServerConfig(raw: ServerFileConfig): ServerConfig {
  return {
    host: raw.server.host,
    port: raw.server.port,
    authMode: 'local',
    tokenTtlSec: raw.auth.tokenTtlSec,
    bootstrapAdmin: {
      username: raw.bootstrapAdmin.username,
      password: raw.bootstrapAdmin.password,
      email: raw.bootstrapAdmin.email,
    },
    workspace: raw.runtimeDefaults.workspace
      ? normalizePath(raw.runtimeDefaults.workspace)
      : undefined,
    defaultRuntime: raw.runtimeDefaults.type,
    dockerImage: raw.runtimeDefaults.dockerImage,
    dockerMode: raw.runtimeDefaults.dockerMode,
    idleTimeoutMs: raw.runtimeDefaults.idleTimeoutMs,
    maxSessions: raw.runtimeDefaults.maxSessions,
    rootDir: normalizePath(raw.storage.rootDir),
    dbPath: normalizePath(raw.storage.dbPath),
    transcriptDir: normalizePath(raw.storage.transcriptDir),
    runtimeDir: normalizePath(raw.storage.runtimeDir),
    dockerNetwork: raw.docker.network,
    dockerStopTimeoutSec: raw.docker.stopTimeoutSec,
    dockerLabels: raw.docker.labels,
    startupPolicy: raw.recovery.startupPolicy,
    heartbeatTimeoutMs: raw.recovery.heartbeatTimeoutMs,
    reattachProbeTimeoutMs: raw.recovery.reattachProbeTimeoutMs,
    resumeOnMissingRuntime: raw.recovery.resumeOnMissingRuntime,
    logLevel: raw.logging.level,
    auditFile: raw.logging.auditFile
      ? normalizePath(raw.logging.auditFile)
      : undefined,
  }
}

export async function readServerConfig(
  configPath = process.env.MOSS_SERVER_CONFIG || getDefaultServerConfigPath(),
): Promise<{
  configPath: string
  config: ServerConfig
}> {
  const resolvedConfigPath = normalizePath(configPath)
  const rawText = await readFile(resolvedConfigPath, 'utf8')
  const parsed = rawText.trim()
    ? (JSON.parse(rawText) as Record<string, unknown>)
    : {}
  const result = serverFileConfigSchema().safeParse(parsed)
  if (!result.success) {
    throw new Error(`Invalid server config at ${resolvedConfigPath}: ${result.error.message}`)
  }
  return {
    configPath: resolvedConfigPath,
    config: resolveServerConfig(result.data),
  }
}

export async function ensureServerDirectories(config: ServerConfig): Promise<void> {
  await Promise.all([
    mkdir(config.rootDir, { recursive: true }),
    mkdir(dirname(config.dbPath), { recursive: true }),
    mkdir(config.transcriptDir, { recursive: true }),
    mkdir(config.runtimeDir, { recursive: true }),
    config.auditFile ? mkdir(dirname(config.auditFile), { recursive: true }) : Promise.resolve(),
  ])
}
