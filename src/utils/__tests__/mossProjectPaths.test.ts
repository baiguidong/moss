import { afterEach, describe, expect, mock, test } from 'bun:test'
import { join } from 'path'
import statusline from '../../commands/statusline.js'
import {
  getGlobalMossFolderPermissionPattern,
  GLOBAL_MOSS_FOLDER_PERMISSION_PATTERN,
  MOSS_FOLDER_PERMISSION_PATTERN,
} from '../../tools/FileEditTool/constants.js'
import {
  CCR_API_KEY_PATH,
  CCR_SESSION_INGRESS_TOKEN_PATH,
} from '../authFileDescriptor.js'
import { getMossConfigHomeDir } from '../envUtils.js'
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

afterEach(() => {
  restoreEnv('MOSS_CONFIG_DIR', originalMossConfigDir)
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

  test('uses the Moss CCR credential directory', () => {
    expect(CCR_API_KEY_PATH).toBe('/home/claude/.moss/remote/.api_key')
    expect(CCR_SESSION_INGRESS_TOKEN_PATH).toBe(
      '/home/claude/.moss/remote/.session_ingress_token',
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
