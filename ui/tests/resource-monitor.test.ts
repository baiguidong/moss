import { describe, expect, test } from 'bun:test';
import { createProcessSampler, parseCpuTime, parseLinuxStat, parseUnixProcesses, parseWindowsProcesses } from '../src/resource-monitor/process-sampler.mjs';
import { createResourceMonitor, selectMossProcesses } from '../src/resource-monitor/resource-monitor.mjs';

const raw = (pid = 100, cpuSeconds = 0, started = 'boot:1', ppid = 1) => ({ pid, ppid, cpuSeconds, started, memoryBytes: 1024, name: `process-${pid}` });

function fixture() {
  let clock = 1_000_000;
  let rows = [raw()];
  let failure = false;
  const events: any[] = [];
  const service = createResourceMonitor({
    rootPid: 100, now: () => clock, monotonic: () => clock,
    readProcesses: async () => { if (failure) throw new Error('test unavailable'); return rows; },
    onAlert: event => events.push(event),
  });
  return {
    service, events,
    async next(cpu: number, elapsed = 5000, started = 'boot:1') {
      clock += elapsed; rows = [raw(100, cpu, started)];
      await service.sample(); return service.getSnapshot({ active: false });
    },
    setFailure(value: boolean) { failure = value; },
  };
}

describe('process sampler', () => {
  test('parses cumulative CPU time including fractions, hours and days', () => {
    expect(parseCpuTime('1:02.53')).toBeCloseTo(62.53);
    expect(parseCpuTime('01:02:03')).toBe(3723);
    expect(parseCpuTime('2-01:02:03')).toBe(176523);
    expect(parseCpuTime('invalid')).toBeNull();
  });
  test('reads macOS process identity, RSS and executable without exposing arguments', () => {
    const rows = parseUnixProcesses(' 51 1 Mon Sep 28 17:18:16 2026 0:02.50 2048 S /Applications/Moss App.app/Moss Helper\n 52 1 Mon Sep 28 17:18:16 2026 0:00.00 0 Z defunct');
    expect(rows).toEqual([{ pid: 51, ppid: 1, started: 'Mon Sep 28 17:18:16 2026', cpuSeconds: 2.5, memoryBytes: 2097152, name: 'Moss Helper' }]);
  });
  test('reads Windows 100ns counters and byte working sets', () => {
    expect(parseWindowsProcesses(JSON.stringify({ ProcessId: 5, ParentProcessId: 1, Started: '638946123456789000', KernelModeTime: '15000000', UserModeTime: '25000000', WorkingSetSize: '3000000', Name: 'node.exe' }))[0])
      .toEqual({ pid: 5, ppid: 1, started: '638946123456789000', cpuSeconds: 4, memoryBytes: 3000000, name: 'node.exe' });
    expect(parseWindowsProcesses('[]')).toEqual([]);
  });
  test('parses Linux names with parentheses and platform-specific tick/page units', () => {
    const fields = ['S', '1', ...Array(9).fill('0'), '200', '100', ...Array(6).fill('0'), '5000', '0', '10'];
    expect(parseLinuxStat(`7 (worker (node)) ${fields.join(' ')}`, 100, 4096))
      .toEqual({ pid: 7, ppid: 1, started: '5000', cpuSeconds: 3, memoryBytes: 40960, name: 'worker (node)' });
  });
  test('does not count the sampler or its helpers', async () => {
    const sample = createProcessSampler({ platform: 'darwin', run: async () => ({ pid: 20, stdout:
      ' 10 1 Mon Sep 28 17:18:16 2026 0:00.00 100 S Moss\n 20 10 Mon Sep 28 17:18:16 2026 0:00.00 100 S ps\n 30 20 Mon Sep 28 17:18:16 2026 0:00.00 100 S helper' }) });
    expect((await sample()).map(row => row.pid)).toEqual([10]);
  });
});

describe('Moss process ownership', () => {
  test('includes grandchildren and explicit App processes, excludes unrelated node processes, and deduplicates PIDs', () => {
    const rows = [raw(), raw(101, 0, 'a', 100), raw(102, 0, 'b', 101), raw(200), raw(300)];
    const labels = [{ pid: 100, name: 'main', kind: 'main' }, { pid: 200, name: 'app', appId: 'example', kind: 'app' }];
    const selected = selectMossProcesses(rows, labels, 100);
    expect(selected.map(row => row.pid).sort()).toEqual([100, 101, 102, 200]);
    expect(selected.find(row => row.pid === 102)?.kind).toBe('child');
  });
  test('tracks an orphan by identity but does not adopt a reused PID', () => {
    const old = selectMossProcesses([raw(), raw(101, 0, 'old', 100)], [], 100);
    const previous = new Map(old.map(row => [row.id, row]));
    const orphan = selectMossProcesses([raw(), raw(101, 5, 'old', 1)], [], 100, previous);
    expect(orphan.find(row => row.pid === 101)?.orphaned).toBe(true);
    expect(selectMossProcesses([raw(), raw(101, 5, 'new', 1)], [], 100, previous)).toHaveLength(1);
  });
});

describe('resource history and alerts', () => {
  test('uses interval CPU, allows multiple cores and leaves the first sample unknown', async () => {
    const { service, next } = fixture();
    await service.sample();
    expect((await service.getSnapshot()).cpuPercent).toBeNull();
    const snapshot = await next(10, 5000);
    expect(snapshot.cpuPercent).toBe(200);
    expect(snapshot.memoryBytes).toBe(1024);
    expect(snapshot.processCount).toBe(1);
    expect((await service.getSnapshot({ since: snapshot.sampledAt })).history).toEqual([]);
  });
  test('only flags sustained high CPU, records its peak once, and closes it after recovery', async () => {
    const { service, next, events } = fixture();
    await service.sample();
    for (let i = 1; i < 12; i++) expect((await next(i * 5)).alerts).toHaveLength(0);
    expect((await next(60)).alerts[0]?.kind).toBe('cpu');
    expect((await next(70)).alerts[0]?.peakCpu).toBe(200);
    const recovered = await next(70.1);
    expect(recovered.alerts).toHaveLength(0);
    expect(recovered.events).toHaveLength(1);
    expect(recovered.events[0].endedAt).not.toBeNull();
    expect(events.map(event => event.phase)).toEqual(['started', 'ended']);
  });
  test('does not carry a CPU baseline or sustained duration across PID reuse or sleep', async () => {
    const { service, next } = fixture();
    await service.sample();
    await next(50, 50_000); // a gap must not count as 50 seconds of continuous load
    expect((await next(60, 10_000)).alerts).toHaveLength(0);
    const restarted = await next(1, 5000, 'new-start');
    expect(restarted.cpuPercent).toBeNull();
    expect(restarted.processes[0].id).toBe('100:new-start');
    expect(restarted.history[0].processes[0].id).toBe('100:boot:1');
  });
  test('records gaps on failed collection and requires a fresh baseline after recovery', async () => {
    const f = fixture();
    await f.service.sample();
    const before = await f.next(5);
    f.setFailure(true);
    const failed = await f.next(10);
    expect(failed.error).toContain('test unavailable');
    expect(failed.lastSuccessAt).toBe(before.lastSuccessAt);
    expect(failed.history.at(-1)?.cpuPercent).toBeNull();
    expect(failed.processes[0].memoryBytes).toBeNull();
    f.setFailure(false);
    expect((await f.next(15)).cpuPercent).toBeNull();
    expect((await f.next(20)).cpuPercent).toBe(100);
  });
  test('bounds history and shares one in-flight sample', async () => {
    const f = fixture();
    await f.service.sample();
    for (let i = 1; i <= 500; i++) await f.next(i, 2000);
    const snapshot = await f.service.getSnapshot();
    expect(snapshot.history.length).toBeLessThanOrEqual(450);
    expect(snapshot.history.at(-1)!.timestamp - snapshot.history[0].timestamp).toBeLessThan(900_000);
    let calls = 0;
    let resolve: (value: any[]) => void;
    const service = createResourceMonitor({ rootPid: 100, readProcesses: () => { calls++; return new Promise(r => { resolve = r; }); } });
    const first = service.sample();
    const second = service.sample();
    expect(calls).toBe(1);
    resolve!([raw()]);
    await Promise.all([first, second]);
  });
  test('surfaces heartbeat timeout and crash loops even when CPU is low', async () => {
    const service = createResourceMonitor({ rootPid: 100, now: () => 1_000_000, readProcesses: async () => [raw()], getLabels: () => [
      { pid: 100, name: 'App', kind: 'app', state: 'running', lastHeartbeatAt: 800_000, healthCheckTimeoutMs: 65_000, recentCrashCount: 3 },
      { pid: null, targetKey: 'stopped', name: 'Crashed', kind: 'app', state: 'crash-loop' },
    ] });
    const snapshot = await service.getSnapshot();
    expect(snapshot.alerts.map(event => event.kind).sort()).toEqual(['crash', 'crash', 'heartbeat']);
    expect(snapshot.processCount).toBe(1);
    expect(snapshot.processes.find(row => row.name === 'Crashed')?.cpuPercent).toBeNull();
  });
});
