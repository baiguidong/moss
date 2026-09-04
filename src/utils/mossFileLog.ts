import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'fs'
import { join } from 'path'

import { getMossConfigHomeDir } from './envUtils.js'

// Runtime-safe twin of ui/src/log-ipc.mjs `mossLog`. That module can't be
// imported here because it pulls in electron and only runs in the desktop main
// process; the agent runtime also runs on the moss server (remote-direct), so we
// re-emit the same line format into the same ~/.moss/logs/moss.log target.
// Keep the format and rotation defaults in sync with ui/src/log-ipc.mjs.
const LOG_FILE = 'moss.log'
const ROTATION_MAX_SIZE = 10 * 1024 * 1024
const ROTATION_MAX_FILES = 5

function getLogsDir(): string {
  return join(getMossConfigHomeDir(), 'logs')
}

function rotateIfNeeded(logPath: string, nextEntryBytes: number): void {
  if (!existsSync(logPath)) return
  if (statSync(logPath).size + nextEntryBytes <= ROTATION_MAX_SIZE) return

  const archiveCount = ROTATION_MAX_FILES - 1
  if (archiveCount <= 0) {
    rmSync(logPath, { force: true })
    return
  }
  rmSync(`${logPath}.${archiveCount}`, { force: true })
  for (let index = archiveCount - 1; index >= 1; index -= 1) {
    const archived = `${logPath}.${index}`
    if (existsSync(archived)) renameSync(archived, `${logPath}.${index + 1}`)
  }
  renameSync(logPath, `${logPath}.1`)
}

export function appendMossLog(
  level: string,
  category: string,
  message: string,
  data?: unknown,
): void {
  const timestamp = new Date().toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const levelPad = level.toUpperCase().padEnd(5, ' ')
  const categoryPad = category.padEnd(12, ' ')

  let line = `${timestamp} [${levelPad}] [${categoryPad}] ${message}`
  if (data !== undefined) {
    line += ` | ${typeof data === 'object' ? JSON.stringify(data) : String(data)}`
  }
  line += '\n'

  try {
    const logsDir = getLogsDir()
    const logPath = join(logsDir, LOG_FILE)
    mkdirSync(logsDir, { recursive: true })
    rotateIfNeeded(logPath, Buffer.byteLength(line, 'utf8'))
    appendFileSync(logPath, line, 'utf8')
  } catch {
    // Logging must never throw into the runtime.
  }
}
