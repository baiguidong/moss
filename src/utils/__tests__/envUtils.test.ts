import { afterEach, describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'
import { asSessionId } from '../../types/ids.js'
import { getGlobalMossFile } from '../env.js'
import { getMossConfigHomeDir } from '../envUtils.js'
import { runWithSessionIdContext } from '../sessionIdContext.js'

const originalMossConfigDir = process.env.MOSS_CONFIG_DIR
const originalMossHome = process.env.MOSS_HOME

afterEach(() => {
  restoreEnv('MOSS_CONFIG_DIR', originalMossConfigDir)
  restoreEnv('MOSS_HOME', originalMossHome)
})

describe('Moss config paths', () => {
  test('defaults to ~/.moss and ignores MOSS_HOME', () => {
    delete process.env.MOSS_CONFIG_DIR
    process.env.MOSS_HOME = '/tmp/legacy-moss-home'

    expect(getMossConfigHomeDir()).toBe(
      join(homedir(), '.moss').normalize('NFC'),
    )
  })

  test('uses MOSS_CONFIG_DIR and stores global config in moss.json', () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/moss-e\u0301'

    expect(getMossConfigHomeDir()).toBe('/tmp/moss-\u00e9')
    expect(getGlobalMossFile()).toBe('/tmp/moss-\u00e9/moss.json')
  })

  test('prefers the embedded session config directory', () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/global-moss'

    expect(
      runWithSessionIdContext(
        asSessionId('session-1'),
        null,
        () => getMossConfigHomeDir(),
        undefined,
        { MOSS_CONFIG_DIR: '/tmp/session-moss' },
      ),
    ).toBe('/tmp/session-moss')
    expect(getMossConfigHomeDir()).toBe('/tmp/global-moss')
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
