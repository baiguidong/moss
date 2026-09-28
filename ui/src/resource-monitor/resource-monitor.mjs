import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { createProcessSampler } from './process-sampler.mjs';

export const HISTORY_MS = 15 * 60_000;
const identity = row => `${row.pid}:${row.started}`;
const validMetric = value => Number.isFinite(value) && value >= 0;

export function selectMossProcesses(rows, labels, rootPid, previous = new Map()) {
  const byPid = new Map(rows.map(row => [row.pid, row]));
  const byLabel = new Map(labels.filter(row => row.pid).map(row => [row.pid, row]));
  const selected = new Map();
  for (const row of rows) {
    const label = byLabel.get(row.pid);
    if (label || row.pid === rootPid) selected.set(row.pid, {
      ...row, kind: row.pid === rootPid ? 'main' : 'helper', state: 'running',
      ...(label || {}), id: identity(row), pid: row.pid, started: row.started,
    });
  }
  const expand = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        const parent = selected.get(row.ppid);
        if (!parent || selected.has(row.pid)) continue;
        selected.set(row.pid, {
          ...row, id: identity(row), kind: 'child', state: 'running',
          appId: parent.appId, appName: parent.appName, parentName: parent.name,
          orphaned: Boolean(parent.orphaned),
        });
        changed = true;
      }
    }
  };
  expand();
  // Continue tracking known children after their parent exits. Never match by executable name.
  for (const row of rows) {
    const old = previous.get(identity(row));
    if (!selected.has(row.pid) && old) selected.set(row.pid, {
      ...old, ...row, id: identity(row), state: 'running', canManage: false, orphaned: true,
    });
  }
  expand();
  for (const label of labels) {
    if (label.kind !== 'app' || (label.pid && byPid.has(label.pid))) continue;
    selected.set(`app:${label.targetKey}`, {
      ...label, id: `app:${label.targetKey}`, pid: null, cpuSeconds: null, memoryBytes: null,
    });
  }
  return [...selected.values()];
}

export function createResourceMonitor({
  rootPid = process.pid, readProcesses = createProcessSampler(), getLabels = () => [],
  now = Date.now, monotonic = () => performance.now(), onAlert = () => {}, getLoopDelay = () => null,
} = {}) {
  let previous = new Map();
  let previousMono = null;
  let previousTime = null;
  let history = [];
  let events = [];
  const active = new Map();
  const highSince = new Map();
  let pending = null;
  let timer = null;
  let running = false;
  let visibleUntil = 0;
  let snapshot = {
    sampledAt: 0, lastSuccessAt: 0, cpuPercent: null, memoryBytes: null,
    cpuCount: os.cpus().length, processCount: 0, processes: [], loopDelayMs: null,
    collectionMs: 0, error: '', alerts: [], events: [],
  };

  function reconcileAlerts(conditions, time) {
    const current = new Set();
    for (const condition of conditions) {
      const key = `${condition.processId}:${condition.kind}`;
      current.add(key);
      const existing = active.get(key);
      if (existing) {
        existing.peakCpu = Math.max(existing.peakCpu || 0, condition.peakCpu || 0);
        continue;
      }
      const event = { ...condition, id: `${key}:${time}`, detectedAt: time, endedAt: null };
      active.set(key, event);
      events.push(event);
      try { onAlert({ ...event, phase: 'started' }); } catch {}
    }
    for (const [key, event] of active) {
      if (current.has(key)) continue;
      event.endedAt = time;
      active.delete(key);
      try { onAlert({ ...event, phase: 'ended' }); } catch {}
    }
    events = events.filter(event => event.endedAt === null || event.endedAt >= time - HISTORY_MS).slice(-100);
  }

  async function collect() {
    const begin = monotonic();
    const time = now();
    try {
      const labels = getLabels();
      const raw = await readProcesses();
      if (!raw.some(row => row.pid === rootPid)) throw new Error('未能读取 Moss 主进程');
      const end = monotonic();
      const dt = previousMono === null ? null : (end - previousMono) / 1000;
      // Sleep, missed samples and clock changes must not create a fake continuous high-CPU interval.
      const continuous = dt !== null && dt > 0 && dt <= 15 && previousTime !== null
        && time > previousTime && time - previousTime <= 15_000;
      const selected = selectMossProcesses(raw, labels, rootPid, previous);
      const conditions = [];
      const next = new Map();
      const processes = selected.map(row => {
        const old = previous.get(row.id);
        const cpuPercent = continuous && old && validMetric(row.cpuSeconds) && validMetric(old.cpuSeconds)
          && row.cpuSeconds >= old.cpuSeconds ? (row.cpuSeconds - old.cpuSeconds) / dt * 100 : null;
        const memoryBytes = validMetric(row.memoryBytes) ? row.memoryBytes : null;
        if (cpuPercent !== null && cpuPercent >= 80) {
          if (!highSince.has(row.id)) highSince.set(row.id, previousTime);
        } else highSince.delete(row.id);
        const highAt = highSince.get(row.id);
        const cpuHighSince = highAt !== undefined && time - highAt >= 60_000 ? highAt : null;
        const issue = (kind, message, startedAt = time) => conditions.push({
          processId: row.id, name: row.name, kind, message, startedAt, peakCpu: cpuPercent,
        });
        if (cpuHighSince !== null) issue('cpu', 'CPU ≥ 80% 已持续至少 1 分钟', cpuHighSince);
        if (row.state === 'crash-loop') issue('crash', 'App 反复崩溃，已停止自动重启');
        else if (row.recentCrashCount >= 2) issue('crash', `最近 5 分钟异常退出 ${row.recentCrashCount} 次`);
        if (row.state === 'error') issue('runtime', row.lastError || 'App 运行异常');
        if (row.state === 'running' && row.lastHeartbeatAt && time - row.lastHeartbeatAt > row.healthCheckTimeoutMs) {
          issue('heartbeat', 'App 心跳超时');
        }
        if (row.orphaned) issue('orphan', '父进程退出后仍在运行');
        const result = { ...row, cpuPercent, memoryBytes, cpuHighSince };
        if (row.pid) next.set(row.id, result);
        // Only public, bounded metadata crosses IPC. Raw cumulative counters stay in the collector.
        const { cpuSeconds, started, owner, ...publicRow } = result;
        return publicRow;
      });
      for (const id of highSince.keys()) if (!next.has(id)) highSince.delete(id);
      reconcileAlerts(conditions, time);
      const live = processes.filter(row => row.pid);
      const sum = key => live.length && live.every(row => row[key] !== null)
        ? live.reduce((total, row) => total + row[key], 0) : null;
      snapshot = {
        ...snapshot, sampledAt: time, lastSuccessAt: time, processes, processCount: live.length,
        cpuPercent: sum('cpuPercent'), memoryBytes: sum('memoryBytes'),
        loopDelayMs: getLoopDelay(), collectionMs: end - begin, error: '',
      };
      previous = next;
      previousMono = end;
      previousTime = time;
    } catch (error) {
      previousMono = null;
      previousTime = null;
      highSince.clear();
      reconcileAlerts([], time);
      snapshot = {
        ...snapshot, sampledAt: time, cpuPercent: null, memoryBytes: null, loopDelayMs: null,
        collectionMs: monotonic() - begin, error: `进程采集失败：${error.message || String(error)}`,
        processes: snapshot.processes.map(row => ({ ...row, cpuPercent: null, memoryBytes: null, cpuHighSince: null })),
      };
    }
    const frame = {
      timestamp: time, cpuPercent: snapshot.cpuPercent, memoryBytes: snapshot.memoryBytes,
      processes: snapshot.processes.filter(row => row.pid).map(({ id, cpuPercent, memoryBytes }) => ({ id, cpuPercent, memoryBytes })),
    };
    history = [...history.filter(point => point.timestamp > time - HISTORY_MS), frame].slice(-460);
    snapshot.alerts = [...active.values()].map(event => ({ ...event }));
    snapshot.events = events.map(event => ({ ...event }));
  }

  function schedule() {
    if (!running) return;
    clearTimeout(timer);
    timer = setTimeout(() => void sample(), now() < visibleUntil ? 2000 : 5000);
    timer.unref?.();
  }

  function sample() {
    if (pending) return pending;
    pending = collect().finally(() => { pending = null; schedule(); });
    return pending;
  }

  return {
    start() { if (!running) { running = true; void sample(); } },
    stop() { running = false; clearTimeout(timer); },
    sample,
    async getSnapshot({ since = 0, active: foreground = true } = {}) {
      if (foreground) visibleUntil = now() + 6000;
      if (!snapshot.sampledAt || now() - snapshot.sampledAt >= 1950) await sample();
      const cursor = Number.isFinite(since) && since <= snapshot.sampledAt ? since : 0;
      return { ...snapshot, history: history.filter(point => point.timestamp > cursor) };
    },
  };
}
