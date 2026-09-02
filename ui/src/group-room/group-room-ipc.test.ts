import { describe, expect, test } from 'bun:test'

import { registerGroupRoomIpcHandlers } from './group-room-ipc.mjs'

describe('Group Room IPC feature isolation', () => {
  test('does not create the store/runtime feature until an enabled room API is used', async () => {
    const handlers = new Map<string, (...args: any[]) => any>()
    const ipcMain = { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) }
    let enabled = false
    let created = 0
    let disposed = 0
    const registration = registerGroupRoomIpcHandlers({
      ipcMain,
      isEnabled: () => enabled,
      createFeature: () => {
        created += 1
        return {
          controller: { listRooms: () => [] },
          dispose: () => { disposed += 1 },
        }
      },
    })

    expect(await handlers.get('group-room:status')!({})).toEqual({ success: true, data: { enabled: false } })
    expect(created).toBe(0)
    expect((await handlers.get('group-room:list')!({})).success).toBe(false)
    expect(created).toBe(0)

    enabled = true
    expect(await handlers.get('group-room:list')!({})).toEqual({ success: true, data: [] })
    expect(created).toBe(1)
    registration.dispose()
    expect(disposed).toBe(1)
  })
})
