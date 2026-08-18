import fs from 'fs/promises'
import path from 'path'
import { getMossConfigHomeDir } from '../utils/envUtils.js'

function getLockPath(): string {
  return path.join(getMossConfigHomeDir(), 'direct-connect-server.json')
}

export type ServerLock = {
  pid: number
  port: number
  host: string
  httpUrl: string
  startedAt: number
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(getMossConfigHomeDir(), { recursive: true })
}

export async function writeServerLock(lock: ServerLock): Promise<void> {
  await ensureDir()
  await fs.writeFile(getLockPath(), JSON.stringify(lock, null, 2), 'utf8')
}

export async function removeServerLock(): Promise<void> {
  await fs.rm(getLockPath(), { force: true })
}

export async function probeRunningServer(): Promise<ServerLock | null> {
  try {
    const raw = await fs.readFile(getLockPath(), 'utf8')
    const parsed = JSON.parse(raw) as ServerLock
    process.kill(parsed.pid, 0)
    return parsed
  } catch {
    return null
  }
}
