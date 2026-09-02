import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

describe('GroupRoomStore Node integration', () => {
  test('passes the Node SQLite suite', async () => {
    const child = Bun.spawn({
      cmd: ['node', '--test', fileURLToPath(new URL('./group-room-store.node-test.mjs', import.meta.url))],
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(`${stdout}\n${stderr}`).toMatch(/(?:#|ℹ) fail 0/)
    expect(exitCode).toBe(0)
  })
})
