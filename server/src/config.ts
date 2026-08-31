import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import {
  serverFileConfigSchema,
  type ServerConfig,
  type ServerFileConfig,
} from './types.js'
import { getMossServerHomeDir } from './lib/env.js'
import { expandPath } from './lib/path.js'

export function getDefaultServerConfigPath(): string {
  return join(getMossServerHomeDir(), 'server.json')
}

function getDefaultStoragePaths(): {
  rootDir: string
  dbPath: string
  dataDir: string
  runDir: string
  logDir: string
} {
  const baseDir = getMossServerHomeDir()
  return {
    rootDir: baseDir,
    dbPath: join(baseDir, 'moss-server.db'),
    dataDir: join(baseDir, 'var', 'lib'),
    runDir: join(baseDir, 'var', 'run'),
    logDir: join(baseDir, 'var', 'log'),
  }
}

export function getDefaultServerConfig(): ServerFileConfig {
  const storage = getDefaultStoragePaths()
  return {
    server: {
      host: '0.0.0.0',
      port: 43127,
    },
    auth: {
      mode: 'local',
      tokenTtlSec: 60 * 60,
    },
    bootstrapAdmin: {
      username: 'admin',
    },
    storage: {
      rootDir: storage.rootDir,
      dbPath: storage.dbPath,
      dataDir: storage.dataDir,
      runDir: storage.runDir,
      logDir: storage.logDir,
    },
    runtimeDefaults: {
      idleTimeoutMs: 10 * 60 * 1000,
      maxSessions: 32,
    },
    docker: {
      stopTimeoutSec: 10,
      labels: {},
    },
    recovery: {
      startupPolicy: 'reattach-or-resume',
      heartbeatTimeoutMs: 30_000,
      reattachProbeTimeoutMs: 3_000,
      resumeOnMissingRuntime: true,
    },
    logging: {
      level: 'info',
    },
    apps: {},
  }
}

function normalizePath(input: string): string {
  return expandPath(input)
}

function resolveServerConfig(raw: ServerFileConfig): ServerConfig {
  const defaultStorage = getDefaultStoragePaths()
  return {
    host: raw.server.host,
    port: raw.server.port,
    advertisedHost: raw.server.advertisedHost,
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
    idleTimeoutMs: raw.runtimeDefaults.idleTimeoutMs,
    maxSessions: raw.runtimeDefaults.maxSessions,
    rootDir: raw.storage.rootDir
      ? normalizePath(raw.storage.rootDir)
      : defaultStorage.rootDir,
    dbPath: raw.storage.dbPath
      ? normalizePath(raw.storage.dbPath)
      : defaultStorage.dbPath,
    dataDir: raw.storage.dataDir
      ? normalizePath(raw.storage.dataDir)
      : defaultStorage.dataDir,
    runDir: raw.storage.runDir
      ? normalizePath(raw.storage.runDir)
      : defaultStorage.runDir,
    logDir: raw.storage.logDir
      ? normalizePath(raw.storage.logDir)
      : defaultStorage.logDir,
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
    appSourceDir: raw.apps.sourceDir ? normalizePath(raw.apps.sourceDir) : undefined,
  }
}

export async function readServerConfig(
  configPath = process.env.MOSS_SERVER_CONFIG || getDefaultServerConfigPath(),
): Promise<{
  configPath: string
  config: ServerConfig
}> {
  const resolvedConfigPath = normalizePath(configPath)

  // Check if config file exists
  if (!existsSync(resolvedConfigPath)) {
    // Create default config file and parent directory
    const defaultConfig = getDefaultServerConfig()
    await mkdir(dirname(resolvedConfigPath), { recursive: true })
    await writeFile(resolvedConfigPath, JSON.stringify(defaultConfig, null, 2), 'utf8')

    process.stderr.write(`\nCreated default config at: ${resolvedConfigPath}\n`)
    process.stderr.write(`Please edit the config file to customize settings.\n`)
    process.stderr.write(`Note: bootstrapAdmin.password should be set before first login.\n\n`)

    return {
      configPath: resolvedConfigPath,
      config: resolveServerConfig(defaultConfig),
    }
  }

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
    mkdir(config.dataDir, { recursive: true }),
    mkdir(config.runDir, { recursive: true }),
    mkdir(config.logDir, { recursive: true }),
    config.auditFile ? mkdir(dirname(config.auditFile), { recursive: true }) : Promise.resolve(),
  ])
}
