import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getDefaultServerConfig, getDefaultServerConfigPath, readServerConfig } from '../config.js'

const originalMossServerHome = process.env.MOSS_SERVER_HOME
const oauthEnvKeys = [
  'MOSS_OAUTH_AUTHORIZATION_URL',
  'MOSS_OAUTH_TOKEN_URL',
  'MOSS_OAUTH_USERINFO_URL',
  'MOSS_OAUTH_CLIENT_ID',
  'MOSS_OAUTH_CLIENT_SECRET',
  'MOSS_OAUTH_REDIRECT_URI',
] as const
const originalOAuthEnv = new Map(
  oauthEnvKeys.map(key => [key, process.env[key]]),
)
let tempRoot: string | undefined

beforeEach(() => {
  for (const key of oauthEnvKeys) delete process.env[key]
})

afterEach(async () => {
  if (originalMossServerHome === undefined) {
    delete process.env.MOSS_SERVER_HOME
  } else {
    process.env.MOSS_SERVER_HOME = originalMossServerHome
  }
  for (const key of oauthEnvKeys) {
    const value = originalOAuthEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  }
})

describe('server config defaults', () => {
  test('derive all server paths from MOSS_SERVER_HOME', () => {
    const serverHome = '/tmp/moss-server-home'
    process.env.MOSS_SERVER_HOME = serverHome

    expect(getDefaultServerConfigPath()).toBe(join(serverHome, 'server.json'))

    const config = getDefaultServerConfig()
    expect(config.server.port).toBe(43127)
    expect(config.storage.rootDir).toBe(serverHome)
    expect(config.storage.dbPath).toBe(join(serverHome, 'moss-server.db'))
    expect(config.storage.dataDir).toBe(join(serverHome, 'var', 'lib'))
    expect(config.storage.runDir).toBe(join(serverHome, 'var', 'run'))
    expect(config.storage.logDir).toBe(join(serverHome, 'var', 'log'))
    expect(config.auth.oauth.enabled).toBe(false)
  })

  test('loads an enabled OAuth provider and accepts the client secret from env', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-oauth-config-'))
    const configPath = join(tempRoot, 'server.json')
    process.env.MOSS_OAUTH_CLIENT_SECRET = 'secret-from-env'
    await writeFile(configPath, JSON.stringify({
      auth: {
        oauth: {
          enabled: true,
          providerId: 'company',
          authorizationUrl: 'https://idp.example.com/oauth/authorize',
          tokenUrl: 'https://idp.example.com/oauth/token',
          userInfoUrl: 'https://idp.example.com/oauth/userinfo',
          clientId: 'moss-client',
          redirectUri: 'https://moss.example.com/api/v1/auth/oauth/callback',
          allowedEmailDomains: ['Example.COM'],
        },
      },
    }), 'utf8')

    const { config } = await readServerConfig(configPath)
    expect(config.oauth).toMatchObject({
      enabled: true,
      providerId: 'company',
      clientSecret: 'secret-from-env',
      allowedEmailDomains: ['example.com'],
      scopes: ['openid', 'profile', 'email'],
    })
  })

  test('keeps existing server configs valid when oauth is omitted', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-oauth-config-'))
    const configPath = join(tempRoot, 'server.json')
    await writeFile(configPath, JSON.stringify({
      auth: {
        mode: 'local',
        tokenTtlSec: 3600,
      },
    }), 'utf8')

    const { config } = await readServerConfig(configPath)
    expect(config.oauth.enabled).toBe(false)
  })

  test('rejects insecure non-loopback OAuth endpoints', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-oauth-config-'))
    const configPath = join(tempRoot, 'server.json')
    await writeFile(configPath, JSON.stringify({
      auth: {
        oauth: {
          enabled: true,
          authorizationUrl: 'http://idp.example.com/oauth/authorize',
          tokenUrl: 'https://idp.example.com/oauth/token',
          userInfoUrl: 'https://idp.example.com/oauth/userinfo',
          clientId: 'moss-client',
          clientSecret: 'secret',
          redirectUri: 'https://moss.example.com/api/v1/auth/oauth/callback',
        },
      },
    }), 'utf8')

    await expect(readServerConfig(configPath)).rejects.toThrow('must use HTTPS')
  })

  test('rejects OAuth URL fragments and a callback path the server does not expose', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-oauth-config-'))
    const configPath = join(tempRoot, 'server.json')
    const oauth = {
      enabled: true,
      authorizationUrl: 'https://idp.example.com/oauth/authorize#fragment',
      tokenUrl: 'https://idp.example.com/oauth/token',
      userInfoUrl: 'https://idp.example.com/oauth/userinfo',
      clientId: 'moss-client',
      clientSecret: 'secret',
      redirectUri: 'https://moss.example.com/api/v1/auth/oauth/callback',
    }
    await writeFile(configPath, JSON.stringify({ auth: { oauth } }), 'utf8')
    await expect(readServerConfig(configPath)).rejects.toThrow('must use HTTPS')

    oauth.authorizationUrl = 'https://idp.example.com/oauth/authorize'
    oauth.redirectUri = 'https://moss.example.com/oauth/wrong-callback'
    await writeFile(configPath, JSON.stringify({ auth: { oauth } }), 'utf8')
    await expect(readServerConfig(configPath)).rejects.toThrow(
      'redirectUri path must be /api/v1/auth/oauth/callback',
    )
  })
})
