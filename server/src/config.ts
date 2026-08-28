import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import {
  serverFileConfigSchema,
  type ServerConfig,
  type ServerFileConfig,
  type ServerOAuthConfig,
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
      oauth: {
        enabled: false,
        providerId: 'default',
        scopes: ['openid', 'profile', 'email'],
        tokenEndpointAuthMethod: 'client_secret_post',
        autoProvision: true,
        defaultRole: 'user',
        requireVerifiedEmail: true,
        allowedEmailDomains: [],
      },
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
  }
}

function normalizePath(input: string): string {
  return expandPath(input)
}

function isSecureOAuthUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (!url.hostname || url.username || url.password || url.hash) return false
    return url.protocol === 'https:' || (
      url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
    )
  } catch {
    return false
  }
}

function resolveOAuthConfig(raw: ServerFileConfig['auth']['oauth']): ServerOAuthConfig {
  const config: ServerOAuthConfig = {
    enabled: raw.enabled,
    providerId: raw.providerId.trim(),
    authorizationUrl: (process.env.MOSS_OAUTH_AUTHORIZATION_URL || raw.authorizationUrl || '').trim(),
    tokenUrl: (process.env.MOSS_OAUTH_TOKEN_URL || raw.tokenUrl || '').trim(),
    userInfoUrl: (process.env.MOSS_OAUTH_USERINFO_URL || raw.userInfoUrl || '').trim(),
    clientId: (process.env.MOSS_OAUTH_CLIENT_ID || raw.clientId || '').trim(),
    clientSecret: process.env.MOSS_OAUTH_CLIENT_SECRET || raw.clientSecret || '',
    redirectUri: (process.env.MOSS_OAUTH_REDIRECT_URI || raw.redirectUri || '').trim(),
    scopes: [...new Set(raw.scopes.map(scope => scope.trim()).filter(Boolean))],
    tokenEndpointAuthMethod: raw.tokenEndpointAuthMethod,
    organizationId: raw.organizationId?.trim() || undefined,
    autoProvision: raw.autoProvision,
    defaultRole: raw.defaultRole,
    requireVerifiedEmail: raw.requireVerifiedEmail,
    allowedEmailDomains: [...new Set(
      raw.allowedEmailDomains.map(domain => domain.trim().toLowerCase()).filter(Boolean),
    )],
  }

  if (config.enabled) {
    const required: Array<keyof ServerOAuthConfig> = [
      'providerId',
      'authorizationUrl',
      'tokenUrl',
      'userInfoUrl',
      'clientId',
      'clientSecret',
      'redirectUri',
    ]
    const missing = required.filter(key => !config[key])
    if (missing.length > 0) {
      throw new Error(`OAuth is enabled but missing configuration: ${missing.join(', ')}`)
    }
    for (const [name, value] of [
      ['authorizationUrl', config.authorizationUrl],
      ['tokenUrl', config.tokenUrl],
      ['userInfoUrl', config.userInfoUrl],
      ['redirectUri', config.redirectUri],
    ] as const) {
      if (!isSecureOAuthUrl(value)) {
        throw new Error(
          `OAuth ${name} must use HTTPS and must not contain credentials or a fragment ` +
          '(HTTP is allowed only for loopback development)',
        )
      }
    }
    if (config.scopes.length === 0) {
      throw new Error('OAuth scopes cannot be empty')
    }
    if (new URL(config.redirectUri).pathname !== '/api/v1/auth/oauth/callback') {
      throw new Error(
        'OAuth redirectUri path must be /api/v1/auth/oauth/callback',
      )
    }
  }
  return config
}

function resolveServerConfig(raw: ServerFileConfig): ServerConfig {
  const defaultStorage = getDefaultStoragePaths()
  return {
    host: raw.server.host,
    port: raw.server.port,
    advertisedHost: raw.server.advertisedHost,
    authMode: 'local',
    tokenTtlSec: raw.auth.tokenTtlSec,
    oauth: resolveOAuthConfig(raw.auth.oauth),
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
