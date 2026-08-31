import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { updateSettingsForSource } from '../settings/settings.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import {
  initializeToolPermissionContext,
  initialPermissionModeFromCLI,
  isBypassPermissionsModeDisabled,
} from './permissionSetup.js'

const originalConfigDir = process.env.MOSS_CONFIG_DIR
let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'moss-permission-setting-'))
  process.env.MOSS_CONFIG_DIR = tempRoot
  resetSettingsCache()
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.MOSS_CONFIG_DIR
  else process.env.MOSS_CONFIG_DIR = originalConfigDir
  resetSettingsCache()
  await rm(tempRoot, { recursive: true, force: true })
})

describe('bypass permissions setting', () => {
  test('allows the CLI mode when the setting is absent', () => {
    expect(isBypassPermissionsModeDisabled()).toBe(false)
    expect(
      initialPermissionModeFromCLI({
        permissionModeCli: undefined,
        dangerouslySkipPermissions: true,
      }),
    ).toEqual({ mode: 'bypassPermissions', notification: undefined })
  })

  test('blocks the CLI mode when disabled in settings', () => {
    const result = updateSettingsForSource('userSettings', {
      permissions: { disableBypassPermissionsMode: 'disable' },
    })
    expect(result.error).toBeNull()
    expect(isBypassPermissionsModeDisabled()).toBe(true)
    expect(
      initialPermissionModeFromCLI({
        permissionModeCli: undefined,
        dangerouslySkipPermissions: true,
      }),
    ).toEqual({
      mode: 'default',
      notification: 'Bypass permissions mode was disabled by settings',
    })
  })

  test('downgrades direct bypass initialization when disabled', async () => {
    const result = updateSettingsForSource('userSettings', {
      permissions: { disableBypassPermissionsMode: 'disable' },
    })
    expect(result.error).toBeNull()

    const { toolPermissionContext } = await initializeToolPermissionContext({
      allowedToolsCli: [],
      disallowedToolsCli: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      addDirs: [],
      workspaceDirectories: [],
    })

    expect(toolPermissionContext.mode).toBe('default')
    expect(toolPermissionContext.isBypassPermissionsModeAvailable).toBe(false)
  })
})
