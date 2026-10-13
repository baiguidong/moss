import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { terminateMcpProcessTree } from './processCleanup'

test.skipIf(process.platform === 'win32')('terminates a stubborn descendant even after its parent exits', async () => {
  const childCode = `process.on('SIGTERM', () => {}); console.log(process.pid); setInterval(() => {}, 1000)`
  const parentCode = `const {spawn}=require('node:child_process'); spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], {stdio:['ignore', 'inherit', 'inherit']}); setInterval(() => {}, 1000)`
  const parent = spawn('node', ['-e', parentCode], { stdio: ['ignore', 'pipe', 'pipe'] })
  let descendant = 0
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
  try {
    descendant = Number(String((await once(parent.stdout!, 'data'))[0]).trim())
    expect(descendant).toBeGreaterThan(1)
    await terminateMcpProcessTree(parent.pid)
    for (let i = 0; i < 100 && (alive(parent.pid!) || alive(descendant)); i++) await Bun.sleep(20)
    expect(alive(parent.pid!)).toBe(false)
    expect(alive(descendant)).toBe(false)
  } finally {
    for (const pid of [parent.pid, descendant]) if (pid && pid > 1) { try { process.kill(pid, 'SIGKILL') } catch {} }
  }
}, 5000)
