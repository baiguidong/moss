import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildTerminalLaunch, createTerminalManager } from '../src/terminal-service.mjs';

const session = { workspace: '/workspace', title: 'Test', underlyingSessionId: 'engine-session', agentMode: 'local' };
const options = {
  session, cliPath: '/app/cli.js', nodePath: '/runtime/node', transcriptPath: '/data/engine-session.jsonl',
  env: { SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' }, platform: 'darwin', fileExists: () => true,
};

describe('terminal launch', () => {
  it('opens a shell without requiring a CLI runtime', () => {
    const launch = buildTerminalLaunch({ ...options, action: 'terminal', nodePath: null, cliPath: null });
    expect(launch.shell).toBe('/bin/zsh');
    expect(launch.args).toEqual(['-l']);
    expect(launch.cwd).toBe(session.workspace);
  });

  it('starts a new CLI or resumes the desktop transcript, without confusing UI and engine IDs', () => {
    const fresh = buildTerminalLaunch({ ...options, action: 'new' });
    const resumed = buildTerminalLaunch({ ...options, action: 'resume' });
    expect(fresh.args.join(' ')).not.toContain('--resume');
    expect(fresh.args.join(' ')).toContain("'--trust-directory' '/workspace'");
    expect(resumed.args.join(' ')).toContain("'--resume' '/data/engine-session.jsonl'");
    expect(resumed.cwd).toBe('/workspace');
  });

  it('rejects remote, missing and busy resume targets', () => {
    expect(() => buildTerminalLaunch({ ...options, action: 'terminal', session: { ...session, agentMode: 'remote-direct' } })).toThrow('本地会话');
    expect(() => buildTerminalLaunch({ ...options, action: 'resume', session: { ...session, busy: true } })).toThrow('回复完成');
    expect(() => buildTerminalLaunch({ ...options, action: 'resume', transcriptPath: null })).toThrow('可恢复的记录');
    expect(() => buildTerminalLaunch({ ...options, action: 'new', cliPath: null })).toThrow('尚未构建');
    expect(() => buildTerminalLaunch({ ...options, action: 'resume', session: { ...session, resumeReadOnlyReason: '只读会话' } })).toThrow('只读会话');
  });

  it('preserves model/profile environment while removing Electron and nested-CLI flags', () => {
    const launch = buildTerminalLaunch({ ...options, action: 'new', env: {
      MOSS_CONFIG_DIR: '/isolated', MOSS_MODEL_BASE_URL: 'http://localhost',
      ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'local-agent',
    } });
    expect(launch.env.MOSS_CONFIG_DIR).toBe('/isolated');
    expect(launch.env.MOSS_MODEL_BASE_URL).toBe('http://localhost');
    expect(launch.env.CLAUDECODE).toBeUndefined();
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(launch.env.NODE_OPTIONS).toBeUndefined();
  });

  it('executes paths containing shell metacharacters as literal arguments', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moss-terminal-'));
    try {
      const cwd = path.join(root, "work ' $d `x`");
      mkdirSync(cwd);
      const cliPath = path.join(root, "cli ' $(exit 42) `exit 43`.cjs");
      const transcriptPath = path.join(root, "session ' $d `x`.jsonl");
      writeFileSync(cliPath, 'console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),node:process.env.MOSS_NODE_PATH,path:process.env.PATH}));');
      writeFileSync(transcriptPath, '');
      const launch = buildTerminalLaunch({
        ...options, action: 'resume', session: { ...session, workspace: cwd },
        cliPath, transcriptPath, nodePath: process.execPath,
        env: { HOME: root, PATH: '/usr/bin:/bin', SHELL: '/bin/sh' },
      });
      const result = spawnSync(launch.shell, launch.args, { cwd, env: launch.env, input: 'exit\n', encoding: 'utf8', timeout: 10000 });
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.args).toEqual(['--trust-directory', cwd, '--resume', transcriptPath]);
      expect(output.node).toBe(process.execPath);
      expect(output.path.split(':')[0]).toBe(path.dirname(process.execPath));
      // macOS resolves /var to /private/var for the child process cwd.
      expect(output.cwd.endsWith(path.basename(cwd))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('passes Windows paths through a literal PowerShell command', () => {
    const launch = buildTerminalLaunch({ ...options, action: 'resume', platform: 'win32',
      cliPath: "C:\\Program Files\\Moss's\\cli.js", transcriptPath: 'C:\\work\\$session.jsonl' });
    expect(launch.args.slice(0, 3)).toEqual(['-NoLogo', '-NoExit', '-EncodedCommand']);
    const command = Buffer.from(launch.args[3], 'base64').toString('utf16le');
    expect(command).toContain("'C:\\Program Files\\Moss''s\\cli.js'");
    expect(command).toContain("'--resume' 'C:\\work\\$session.jsonl'");
    expect(command).toContain("'--trust-directory' '/workspace'");
    expect(command).toContain('$env:Path =');
  });
});

function owner(id = 1) {
  return Object.assign(new EventEmitter(), { id, isDestroyed: () => false, sent: [] as unknown[],
    send(channel: string, payload: unknown) { this.sent.push({ channel, payload }); },
  });
}

function fakePty() {
  let onData = (_data: string) => {};
  let onExit = (_event: { exitCode: number }) => {};
  return {
    killed: false, writes: [] as string[], size: [] as number[],
    write(data: string) { this.writes.push(data); },
    resize(cols: number, rows: number) { this.size = [cols, rows]; },
    kill() { this.killed = true; },
    onData(callback: typeof onData) { onData = callback; return { dispose() {} }; },
    onExit(callback: typeof onExit) { onExit = callback; return { dispose() {} }; },
    emitData(data: string) { onData(data); },
    emitExit(exitCode: number) { onExit({ exitCode }); },
  };
}

describe('terminal lifecycle', () => {
  it('routes input, output and resizing only to the owning window and kills on close', async () => {
    const pty = fakePty();
    const manager = createTerminalManager({ loadPty: async () => ({ spawn: () => pty }) });
    const window = owner();
    manager.attach(window, buildTerminalLaunch({ ...options, action: 'terminal' }));
    await manager.start(window, { requestId: 'one', cols: 80, rows: 24 });
    manager.write(window, { requestId: 'stale', data: 'ignored' });
    manager.write(window, { requestId: 'one', data: 'ls\r' });
    manager.resize(window, { requestId: 'one', cols: 120, rows: 40 });
    expect(pty.writes).toEqual(['ls\r']);
    expect(pty.size).toEqual([120, 40]);
    expect(() => manager.write(owner(2), { requestId: 'one', data: 'ls\r' })).toThrow();
    pty.emitData('hello');
    expect(window.sent).toEqual([{ channel: 'terminal:data', payload: { requestId: 'one', data: 'hello' } }]);
    window.emit('destroyed');
    expect(pty.killed).toBe(true);
    pty.emitData('ignored');
    expect(window.sent).toHaveLength(1);
  });

  it('cancels an in-flight startup and ignores stale cleanup after a restart', async () => {
    let release!: (module: unknown) => void;
    const pending = new Promise((resolve) => { release = resolve; });
    const spawned: ReturnType<typeof fakePty>[] = [];
    const manager = createTerminalManager({ loadPty: () => pending });
    const window = owner();
    manager.attach(window, buildTerminalLaunch({ ...options, action: 'terminal' }));
    const first = manager.start(window, { requestId: 'first' });
    manager.stop(window, { requestId: 'first' });
    const second = manager.start(window, { requestId: 'second' });
    manager.stop(window, { requestId: 'first' });
    release({ spawn: () => { const pty = fakePty(); spawned.push(pty); return pty; } });
    expect(await first).toBeNull();
    expect(await second).not.toBeNull();
    expect(spawned).toHaveLength(1);
    window.emit('did-navigate');
    expect(spawned[0].killed).toBe(true);
    manager.dispose();
  });
});
