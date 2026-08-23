import { afterEach, describe, expect, mock, test } from 'bun:test'
import { join } from 'path'
import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state.js'
import statusline from '../../commands/statusline.js'
import {
  getGlobalMossFolderPermissionPattern,
  GLOBAL_MOSS_FOLDER_PERMISSION_PATTERN,
  MOSS_FOLDER_PERMISSION_PATTERN,
} from '../../tools/FileEditTool/constants.js'
import { getMossConfigHomeDir } from '../envUtils.js'
import { getMemoryPath } from '../config.js'
import { isMemoryFilePath } from '../mossmd.js'
import {
  getRelativeSettingsFilePathForSource,
  getSettingsFilePathForSource,
} from '../settings/settings.js'

mock.module('color-diff-napi', () => ({
  ColorDiff: {},
  ColorFile: {},
  getSyntaxTheme: () => ({}),
}))

const { checkPathSafetyForAutoEdit } =
  await import('../permissions/filesystem.js')

const originalMossConfigDir = process.env.MOSS_CONFIG_DIR
const originalCwd = getOriginalCwd()

afterEach(() => {
  restoreEnv('MOSS_CONFIG_DIR', originalMossConfigDir)
  setOriginalCwd(originalCwd)
})

describe('Moss project paths', () => {
  test('uses .moss for project and local settings', () => {
    expect(getRelativeSettingsFilePathForSource('projectSettings')).toBe(
      join('.moss', 'settings.json'),
    )
    expect(getRelativeSettingsFilePathForSource('localSettings')).toBe(
      join('.moss', 'settings.local.json'),
    )
  })

  test('uses MOSS_CONFIG_DIR for global settings', () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss'
    expect(getSettingsFilePathForSource('userSettings')).toBe(
      '/tmp/custom-moss/settings.json',
    )
  })

  test('uses MOSS.md for primary instruction memory paths', () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss'
    setOriginalCwd('/tmp/moss-project')

    expect(getMemoryPath('User')).toBe('/tmp/custom-moss/MOSS.md')
    expect(getMemoryPath('Project')).toBe('/tmp/moss-project/MOSS.md')
    expect(getMemoryPath('Local')).toBe('/tmp/moss-project/MOSS.local.md')
  })

  test('recognizes Moss instruction files as memory files', () => {
    expect(isMemoryFilePath(join('/tmp/project', 'MOSS.md'))).toBe(true)
    expect(isMemoryFilePath(join('/tmp/project', 'MOSS.local.md'))).toBe(true)
    expect(isMemoryFilePath(join('/tmp/project', 'CLAUDE.md'))).toBe(false)
    expect(isMemoryFilePath(join('/tmp/project', 'CLAUDE.local.md'))).toBe(
      false,
    )
    expect(
      isMemoryFilePath(join('/tmp/project', '.moss', 'rules', 'testing.md')),
    ).toBe(true)
    expect(isMemoryFilePath(join('/tmp/project', 'README.md'))).toBe(false)
  })

  test('generates project and global Moss permission rules', () => {
    expect(MOSS_FOLDER_PERMISSION_PATTERN).toBe('/.moss/**')
    expect(GLOBAL_MOSS_FOLDER_PERMISSION_PATTERN).toBe('~/.moss/**')

    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss/'
    expect(getGlobalMossFolderPermissionPattern()).toBe('/tmp/custom-moss/**')
  })

  test('protects a custom global Moss config directory', () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss'
    const protectedPath = '/tmp/custom-moss/agents/reviewer.md'
    const adjacentPath = '/tmp/custom-moss-other/agents/reviewer.md'

    expect(checkPathSafetyForAutoEdit(protectedPath, [protectedPath]).safe).toBe(
      false,
    )
    expect(checkPathSafetyForAutoEdit(adjacentPath, [adjacentPath])).toEqual({
      safe: true,
    })
  })

  test('allows statusline to edit only the Moss global config', () => {
    expect(statusline.allowedTools).toContain(
      `Edit(${join(getMossConfigHomeDir(), 'moss.json')})`,
    )
    expect(statusline.allowedTools).not.toContain(
      'Edit(~/.moss/settings.json)',
    )
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
