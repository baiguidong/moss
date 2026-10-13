import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Capture descendants before npx exits, so orphaned server children are also reclaimed. */
export async function terminateMcpProcessTree(pid: number | null | undefined): Promise<void> {
  if (!pid || pid <= 1 || pid === process.pid) return
  if (process.platform === 'win32') {
    await exec('taskkill', ['/pid', String(pid), '/T', '/F'], { timeout: 3000 }).catch(() => {})
    return
  }
  const children = new Map<number, number[]>()
  try {
    const { stdout } = await exec('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], { timeout: 2000, maxBuffer: 4 * 1024 * 1024 })
    for (const line of stdout.trim().split('\n')) {
      const [child, parent] = line.trim().split(/\s+/).map(Number)
      if (child > 1 && child !== process.pid) children.set(parent, [...(children.get(parent) || []), child])
    }
  } catch { /* The known direct child can still be terminated. */ }
  const pids = new Set<number>()
  const collect = (parent: number) => { if (pids.has(parent)) return; pids.add(parent); for (const child of children.get(parent) || []) collect(child) }
  collect(pid)
  const alive = (value: number) => { try { process.kill(value, 0); return true } catch { return false } }
  const signal = (value: number, name: NodeJS.Signals) => { try { process.kill(value, name) } catch {} }
  for (const value of [...pids].reverse()) signal(value, 'SIGTERM')
  for (let attempt = 0; attempt < 6 && [...pids].some(alive); attempt++) await sleep(50)
  for (const value of [...pids].reverse()) if (alive(value)) signal(value, 'SIGKILL')
}
