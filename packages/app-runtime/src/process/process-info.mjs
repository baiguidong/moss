import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const options = { timeout: 5_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } }

async function windowsProcesses(pid) {
  const filter = pid === undefined ? '' : ` -Filter 'ProcessId = ${pid}'`
  const script = `@(Get-CimInstance Win32_Process${filter} | Select-Object ProcessId,CommandLine,@{Name='Started';Expression={if ($_.CreationDate) {$_.CreationDate.ToUniversalTime().Ticks.ToString()} else {''}}}) | ConvertTo-Json -Compress`
  // Cold CIM startup on Windows CI can exceed five seconds; stay within the
  // supervisor's 15-second handshake deadline without skipping identity checks.
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { ...options, timeout: 12_000 })
  const values = JSON.parse(stdout.trim() || '[]')
  return (Array.isArray(values) ? values : [values]).map(value => ({
    pid: Number(value.ProcessId), started: value.Started, command: value.CommandLine || '', state: '',
  }))
}

export async function readProcessInfo(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new TypeError('Invalid process id')
  if (process.platform === 'win32') {
    const info = (await windowsProcesses(pid))[0] || null
    if (info && (typeof info.started !== 'string' || !info.started)) throw new Error(`Cannot read process identity: ${pid}`)
    return info
  }
  if (process.platform === 'linux') {
    try {
      const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      if (fields[0] === 'Z') return null
      const [boot, command] = await Promise.all([
        fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
        fs.readFile(`/proc/${pid}/cmdline`, 'utf8'),
      ])
      return { pid, started: `${boot.trim()}:${fields[19]}`, command: command.replaceAll('\0', ' ').trim(), state: fields[0] }
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') return null
      throw error
    }
  }
  try {
    const { stdout } = await execute('/bin/ps', ['-ww', '-p', String(pid), '-o', 'lstart=', '-o', 'stat=', '-o', 'command='], options)
    const match = stdout.trim().match(/^(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(\S+)\s+([\s\S]+)$/)
    if (!match) throw new Error(`Cannot read process identity: ${pid}`)
    if (match[2].startsWith('Z')) return null
    return { pid, started: match[1].replace(/\s+/g, ' '), state: match[2], command: match[3] }
  } catch (error) {
    if (error.code === 1 && !error.stdout?.trim()) return null
    throw error
  }
}

export function hasProcessMarker(info, marker) {
  return Boolean(info && info.command.split(/[\s"\0]+/).includes(marker))
}

// Also covers a Host killed between spawn() and persisting the child's PID.
export async function findMarkedProcesses(marker) {
  if (process.platform === 'win32') {
    const candidates = (await windowsProcesses()).filter(info => hasProcessMarker(info, marker))
    return (await Promise.all(candidates.map(info => readProcessInfo(info.pid)))).filter(info => hasProcessMarker(info, marker))
  }
  const { stdout } = await execute('/bin/ps', ['-ww', '-axo', 'pid=,command='], options)
  const pids = stdout.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+([\s\S]+)$/)
    return match && hasProcessMarker({ command: match[2] }, marker) ? [Number(match[1])] : []
  })
  return (await Promise.all(pids.map(readProcessInfo))).filter(info => hasProcessMarker(info, marker))
}
