import { randomUUID } from 'node:crypto';
import { prepareTerminalShell } from '../terminal-shell.mjs';

const dimension = (value, fallback) => Number.isFinite(value) ? Math.min(500, Math.max(2, Math.floor(value))) : fallback;
export function createWebTerminals({ registry, resolveLaunch, loadPty = () => import('node-pty'), now = Date.now, retentionMs = 24 * 60 * 60_000 }) {
  const terminals = new Map();
  let closed = false;
  function prune() {
    for (const [id, entry] of terminals) if (!entry.pty && !entry.starting && now() - entry.touchedAt > retentionMs) terminals.delete(id);
  }
  function entryFor(principal, payload) {
    prune();
    const entry = terminals.get(payload?.terminalId);
    if (!entry || entry.userId !== principal.userId) throw new Error('终端已过期或 Host 已重启，请从会话重新打开终端。');
    entry.touchedAt = now();
    return entry;
  }
  function finish(entry, exitCode = 0) {
    entry.pty = null; entry.status = 'exited'; entry.exitCode = exitCode; entry.touchedAt = now();
    entry.cleanup?.(); entry.cleanup = null;
    registry.publish('terminal:exit', { requestId: entry.requestId, terminalId: entry.terminalId, generation: entry.generation, sequence: ++entry.sequence, exitCode });
  }
  function stop(entry) {
    const pty = entry.pty;
    if (!pty) return;
    finish(entry);
    try { pty.kill(); } catch {}
  }
  const snapshot = entry => ({ title: entry.launch.title, cwd: entry.launch.cwd, shell: entry.launch.shell, buffer: entry.buffer,
    status: entry.status, generation: entry.generation, sequence: entry.sequence, exitCode: entry.exitCode });
  const handlers = new Map([
    ['terminal:open', async ({ principal }, payload) => {
      prune();
      if (terminals.size >= 24) { const oldest = [...terminals.values()].filter(entry => !entry.pty && !entry.starting && entry.status === 'exited').sort((a, b) => a.touchedAt - b.touchedAt)[0]; if (oldest) terminals.delete(oldest.terminalId); }
      if (closed || terminals.size >= 24) throw new Error('终端数量已达上限，请终止不再使用的终端。');
      const terminalId = randomUUID();
      const entry = { userId: principal.userId, terminalId, buffer: '', pty: null, status: 'reserved', generation: 0, sequence: 0, touchedAt: now(), starting: true };
      terminals.set(terminalId, entry); // Reserve before awaiting to enforce the limit under concurrency.
      try { entry.launch = await resolveLaunch(payload); }
      catch (error) { terminals.delete(terminalId); throw error; }
      finally { entry.starting = null; }
      return { terminalId };
    }],
    ['terminal:start', async ({ principal }, payload) => {
      const entry = entryFor(principal, payload);
      if (entry.starting) { await entry.starting; return snapshot(entry); }
      if (entry.pty || (entry.status === 'exited' && !payload.restart)) return snapshot(entry);
      // Restart may only target the generation the user actually saw.
      if (payload.restart && payload.generation !== entry.generation) return snapshot(entry);
      entry.starting = (async () => {
        const module = await loadPty();
        if (closed) throw new Error('Host 已停止。');
        const launch = prepareTerminalShell(entry.launch);
        entry.cleanup = launch.cleanup;
        entry.requestId = payload.requestId;
        try {
          const pty = (module.default || module).spawn(launch.shell, launch.args, {
            name: 'xterm-256color', cwd: launch.cwd, env: launch.env,
            cols: dimension(payload.cols, 100), rows: dimension(payload.rows, 30),
          });
          entry.pty = pty; entry.generation++; entry.buffer = ''; entry.sequence = 0; entry.status = 'running'; entry.exitCode = null;
          pty.onData(data => {
            if (entry.pty !== pty) return;
            entry.buffer = (entry.buffer + data).slice(-256 * 1024);
            registry.publish('terminal:data', { requestId: entry.requestId, terminalId: entry.terminalId, generation: entry.generation, sequence: ++entry.sequence, data });
          });
          pty.onExit(({ exitCode }) => { if (entry.pty === pty) finish(entry, exitCode); });
        } catch (error) { entry.cleanup?.(); entry.cleanup = null; throw error; }
      })();
      try { await entry.starting; return snapshot(entry); }
      finally { entry.starting = null; }
    }],
    ['terminal:write', ({ principal }, payload) => {
      const entry = entryFor(principal, payload);
      if (typeof payload.data !== 'string' || payload.data.length > 64 * 1024) throw new Error('终端输入无效。');
      if (!entry.pty || payload.generation !== entry.generation) throw new Error('终端状态已变化，请重新连接。');
      entry.pty.write(payload.data);
    }],
    ['terminal:resize', ({ principal }, payload) => {
      const entry = entryFor(principal, payload);
      if (payload.generation === entry.generation) entry.pty?.resize(dimension(payload.cols, 100), dimension(payload.rows, 30));
    }],
    ['terminal:stop', async ({ principal }, payload) => {
      const entry = entryFor(principal, payload);
      await entry.starting;
      if (payload.generation !== entry.generation) throw new Error('终端状态已变化，请重新连接。');
      stop(entry);
    }],
  ]);
  return { handlers, activeCount: () => [...terminals.values()].filter(entry => entry.pty || entry.starting).length,
    close() { closed = true; for (const entry of terminals.values()) stop(entry); terminals.clear(); } };
}
