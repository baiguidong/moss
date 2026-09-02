import { describe, expect, test } from 'bun:test'

describe('GroupRoomStore Node integration', () => {
  test('passes the Node SQLite suite', async () => {
    const child = Bun.spawn({
      cmd: ['node', '--test', 'ui/src/group-room/group-room-store.node-test.mjs'],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(`${stdout}\n${stderr}`).toContain('# fail 0')
    expect(exitCode).toBe(0)
  })
})
