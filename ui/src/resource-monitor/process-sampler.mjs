import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

// Read only process metadata. Command arguments and environment variables may contain credentials.
function execute(file, args) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, {
      timeout: 4000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, LC_ALL: 'C' },
    }, (error, stdout) => error ? reject(error) : resolve({ stdout, pid: child.pid }));
  });
}

export function parseCpuTime(value) {
  const match = String(value).match(/^(?:(\d+)-)?([\d:]+(?:\.\d+)?)$/);
  if (!match) return null;
  const parts = match[2].split(':').map(Number);
  if (parts.length > 3) return null;
  return Number(match[1] || 0) * 86400 + parts.reduce((total, part) => total * 60 + part, 0);
}

export function parseUnixProcesses(stdout) {
  return stdout.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+([\d:.-]+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match || /^[ZX]/.test(match[6])) return [];
    return [{
      pid: Number(match[1]), ppid: Number(match[2]), started: match[3].replace(/\s+/g, ' '),
      cpuSeconds: parseCpuTime(match[4]), memoryBytes: Number(match[5]) * 1024,
      name: path.posix.basename(match[7].trim()),
    }];
  });
}

export function parseWindowsProcesses(stdout) {
  const data = JSON.parse(stdout.replace(/^\uFEFF/, '').trim() || '[]');
  return (Array.isArray(data) ? data : [data]).flatMap(row => {
    if (!row.ProcessId || !row.Started) return [];
    return [{
      pid: Number(row.ProcessId), ppid: Number(row.ParentProcessId), started: String(row.Started),
      cpuSeconds: row.KernelModeTime == null || row.UserModeTime == null ? null
        : (Number(row.KernelModeTime) + Number(row.UserModeTime)) / 1e7,
      memoryBytes: row.WorkingSetSize == null ? null : Number(row.WorkingSetSize),
      name: String(row.Name || '进程'),
    }];
  });
}

export function parseLinuxStat(stat, ticks, pageSize) {
  const end = stat.lastIndexOf(')');
  const fields = stat.slice(end + 2).trim().split(/\s+/);
  if (end < 0 || fields.length < 22 || /^[ZX]$/.test(fields[0])) return null;
  return {
    pid: Number(stat.slice(0, stat.indexOf(' '))), ppid: Number(fields[1]),
    started: fields[19], name: stat.slice(stat.indexOf('(') + 1, end),
    cpuSeconds: (Number(fields[11]) + Number(fields[12])) / ticks,
    memoryBytes: Number(fields[21]) * pageSize,
  };
}

export function createProcessSampler({ platform = process.platform, run = execute } = {}) {
  let linuxUnits;
  return async () => {
    if (platform === 'linux') {
      linuxUnits ||= Promise.all([run('getconf', ['CLK_TCK']), run('getconf', ['PAGESIZE'])])
        .then(values => values.map(value => Number(value.stdout.trim())));
      const [ticks, pageSize] = await linuxUnits;
      if (!(ticks > 0 && pageSize > 0)) throw new Error('无法读取系统进程计量单位');
      const entries = (await fs.readdir('/proc')).filter(name => /^\d+$/.test(name));
      const rows = [];
      for (let i = 0; i < entries.length; i += 32) {
        const batch = await Promise.all(entries.slice(i, i + 32).map(async pid => {
          try { return parseLinuxStat(await fs.readFile(`/proc/${pid}/stat`, 'utf8'), ticks, pageSize); }
          catch (error) { if (['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) return null; throw error; }
        }));
        rows.push(...batch.filter(Boolean));
      }
      return rows;
    }
    const result = platform === 'win32'
      ? await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,KernelModeTime,UserModeTime,WorkingSetSize,Name | Select-Object ProcessId,ParentProcessId,KernelModeTime,UserModeTime,WorkingSetSize,Name,@{Name='Started';Expression={if ($_.CreationDate) {$_.CreationDate.ToUniversalTime().Ticks.ToString()} else {''}}}) | ConvertTo-Json -Compress"])
      : await run('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,time=,rss=,stat=,comm=']);
    const rows = platform === 'win32' ? parseWindowsProcesses(result.stdout) : parseUnixProcesses(result.stdout);
    // Exclude the sampler itself and any of its helpers from Moss's process count.
    const ignored = new Set([result.pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) if (ignored.has(row.ppid) && !ignored.has(row.pid)) { ignored.add(row.pid); changed = true; }
    }
    return rows.filter(row => !ignored.has(row.pid));
  };
}
