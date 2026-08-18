import { describe, expect, test } from 'bun:test'
import {
  MACOS_PREFERENCE_DOMAIN,
  WINDOWS_REGISTRY_KEY_PATH_HKCU,
  WINDOWS_REGISTRY_KEY_PATH_HKLM,
} from '../settings/mdm/constants.js'
import { getManagedFilePath } from '../settings/managedPath.js'

describe('managed Moss config paths', () => {
  test('uses Moss platform policy identifiers', () => {
    expect(MACOS_PREFERENCE_DOMAIN).toBe('com.moss.ai')
    expect(WINDOWS_REGISTRY_KEY_PATH_HKLM).toBe(
      'HKLM\\SOFTWARE\\Policies\\Moss',
    )
    expect(WINDOWS_REGISTRY_KEY_PATH_HKCU).toBe(
      'HKCU\\SOFTWARE\\Policies\\Moss',
    )
  })

  test('does not use a Claude managed config directory', () => {
    expect(getManagedFilePath().toLowerCase()).not.toContain('claude')
  })
})
