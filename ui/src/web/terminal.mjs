import { randomUUID } from 'node:crypto';
import { prepareTerminalShell } from '../terminal-shell.mjs';

const dimension = (value, fallback) => Number.isFinite(value) ? Math.min(500, Math.max(2, Math.floor(value))) : fallback;
export function createWebTerminals({ registry, resolveLaunch, loadPty = () => import('node-pty') }) {
  const terminals = new Map();
  function entryFor(principal, payload) {
    const entry = terminals.get(payload?.terminalId);
    if (!entry || entry.userId !== principal.userId) throw new Error('找不到终端。');
    return entry;
  }
  function stop(entry) { try { entry.pty?.kill(); } catch {} entry.pty = null; entry.cleanup?.(); entry.cleanup = null; }
  const handlers = new Map([
    ['terminal:open', async ({ principal }, payload) => {
      if (terminals.size >= 24) throw new Error('终端数量已达上限，请关闭不再使用的终端。');
      const launch = await resolveLaunch(payload);
      const terminalId = randomUUID();
      terminals.set(terminalId, { userId: principal.userId, launch, terminalId, buffer: '', pty: null });
      return { terminalId };
    }],
    ['terminal:start', async ({ principal }, payload) => {
      const entry = entryFor(principal, payload);
      const module = await loadPty();
      if (!entry.pty) {
        const launch = prepareTerminalShell(entry.launch);
        entry.cleanup = launch.cleanup;
        entry.requestId = payload.requestId;
        entry.pty = (module.default || module).spawn(launch.shell, launch.args, {
          name: 'xterm-256color', cwd: launch.cwd, env: launch.env,
          cols: dimension(payload.cols, 100), rows: dimension(payload.rows, 30),
        });
        entry.pty.onData(data => {
          entry.buffer = (entry.buffer + data).slice(-256 * 1024);
          registry.publish('terminal:data', { requestId: entry.requestId, terminalId: entry.terminalId, data });
        });
        entry.pty.onExit(({ exitCode }) => {
          registry.publish('terminal:exit', { requestId: entry.requestId, terminalId: entry.terminalId, exitCode });
          stop(entry); terminals.delete(entry.terminalId);
        });
      }
      return { title: entry.launch.title, cwd: entry.launch.cwd, shell: entry.launch.shell, buffer: entry.buffer };
    }],
    ['terminal:write', ({ principal }, payload) => {
      const entry = entryFor(principal, payload);
      if (typeof payload.data !== 'string' || payload.data.length > 64 * 1024) throw new Error('终端输入无效。');
      entry.pty?.write(payload.data);
    }],
    ['terminal:resize', ({ principal }, payload) => entryFor(principal, payload).pty?.resize(dimension(payload.cols, 100), dimension(payload.rows, 30))],
    ['terminal:stop', ({ principal }, payload) => { const entry = entryFor(principal, payload); stop(entry); terminals.delete(entry.terminalId); }],
  ]);
  return { handlers, close() { for (const entry of terminals.values()) stop(entry); terminals.clear(); } };
}
