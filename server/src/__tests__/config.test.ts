import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getDefaultServerConfig, getDefaultServerConfigPath, readServerConfig } from '../config.js'

const originalMossServerHome = process.env.MOSS_SERVER_HOME

afterEach(() => {
  if (originalMossServerHome === undefined) {
    delete process.env.MOSS_SERVER_HOME
  } else {
    process.env.MOSS_SERVER_HOME = originalMossServerHome
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
    expect(config.auth).not.toHaveProperty('oauth')
  })

  test('accepts an HTTPS public URL', async () => {
    const serverHome = await mkdtemp(join(tmpdir(), 'moss-server-config-'))
    process.env.MOSS_SERVER_HOME = serverHome
    try {
      const configPath = join(serverHome, 'server.json')
      await writeFile(configPath, JSON.stringify({
        server: { publicUrl: 'https://moss.internal' },
      }))
      const { config } = await readServerConfig(configPath)
      expect(config.publicUrl).toBe('https://moss.internal')
    } finally {
      await rm(serverHome, { recursive: true, force: true })
    }
  })
})
