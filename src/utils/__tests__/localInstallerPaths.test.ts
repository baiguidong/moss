import { afterEach, describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'
import {
  getLocalClaudePath,
  getLocalInstallDir,
  isRunningFromLocalInstallation,
} from '../localInstaller.js'
import { filterClaudeAliases } from '../shellConfig.js'

const originalMossConfigDir = process.env.MOSS_CONFIG_DIR
const originalArgvEntry = process.argv[1]

afterEach(() => {
  restoreEnv('MOSS_CONFIG_DIR', originalMossConfigDir)
  process.argv[1] = originalArgvEntry
})

describe('local installer paths', () => {
  test('uses MOSS_CONFIG_DIR for installation and runtime detection', () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss'

    expect(getLocalInstallDir()).toBe('/tmp/custom-moss/local')
    expect(getLocalClaudePath()).toBe('/tmp/custom-moss/local/claude')

    process.argv[1] = join(
      getLocalInstallDir(),
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'cli.js',
    )
    expect(isRunningFromLocalInstallation()).toBe(true)

    process.argv[1] = join(homedir(), '.claude', 'local', 'node_modules', 'cli.js')
    expect(isRunningFromLocalInstallation()).toBe(false)
  })

  test('removes current and legacy installer aliases', () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss'
    const customAlias = 'alias claude="/opt/custom/claude"'
    const { filtered, hadAlias } = filterClaudeAliases([
      `alias claude="${getLocalClaudePath()}"`,
      `alias claude="${join(homedir(), '.claude', 'local', 'claude')}"`,
      customAlias,
    ])

    expect(hadAlias).toBe(true)
    expect(filtered).toEqual([customAlias])
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
