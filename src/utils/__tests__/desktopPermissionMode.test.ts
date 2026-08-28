import { describe, expect, it } from 'bun:test'
import { shouldBypassDesktopToolPermission } from '../permissions/desktopPermissionMode.js'

describe('desktop bypass permission mode', () => {
  it('directly allows non-interactive tools in allow-all mode', () => {
    expect(shouldBypassDesktopToolPermission('allow-all', false)).toBe(true)
  })

  it('preserves tools that collect user input', () => {
    expect(shouldBypassDesktopToolPermission('allow-all', true)).toBe(false)
  })

  it('uses the normal permission pipeline in default mode', () => {
    expect(shouldBypassDesktopToolPermission('default', false)).toBe(false)
  })
})
