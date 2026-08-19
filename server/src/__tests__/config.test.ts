import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'path'
import { getDefaultServerConfig, getDefaultServerConfigPath } from '../config.js'

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
    expect(config.storage.transcriptDir).toBe(join(serverHome, 'transcripts'))
    expect(config.storage.runtimeDir).toBe(join(serverHome, 'runtime'))
  })
})
