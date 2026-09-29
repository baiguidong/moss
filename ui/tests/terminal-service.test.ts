import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildTerminalLaunch, createTerminalManager } from '../src/terminal-service.mjs';
import { prepareTerminalShell } from '../src/terminal-shell.mjs';

const session = { workspace: '/workspace', title: 'Test', underlyingSessionId: 'engine-session', agentMode: 'local' };
const options = {
  session, cliPath: '/app/cli.js', nodePath: '/runtime/node', pythonPath: '/python/bin/python3', transcriptPath: '/data/engine-session.jsonl',
  env: { SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' }, platform: 'darwin', fileExists: () => true,
};

describe('terminal launch', () => {
  it('opens a shell with managed runtimes without requiring a CLI build', () => {
    const launch = buildTerminalLaunch({ ...options, action: 'terminal', cliPath: null });
    expect(launch.shell).toBe('/bin/zsh');
    expect(launch.args).toEqual(['-l', '-i']);
    expect(launch.cwd).toBe(session.workspace);
    expect(launch.env.PATH.split(':').slice(0, 2)).toEqual(['/runtime', '/python/bin']);
  });

  it('starts a new CLI or resumes the desktop transcript, without confusing UI and engine IDs', () => {
    const fresh = buildTerminalLaunch({ ...options, action: 'new' });
    const resumed = buildTerminalLaunch({ ...options, action: 'resume' });
    expect(fresh.startup).not.toContain('--resume');
    expect(fresh.startup).toContain("'--trust-directory' '/workspace'");
    expect(resumed.startup).toContain("'--resume' '/data/engine-session.jsonl'");
    expect(resumed.cwd).toBe('/workspace');
  });

  it('rejects remote, missing and busy resume targets', () => {
    expect(() => buildTerminalLaunch({ ...options, action: 'terminal', session: { ...session, agentMode: 'remote-direct' } })).toThrow('本地会话');
    expect(() => buildTerminalLaunch({ ...options, action: 'resume', session: { ...session, busy: true } })).toThrow('回复完成');
    expect(() => buildTerminalLaunch({ ...options, action: 'resume', transcriptPath: null })).toThrow('可恢复的记录');
    expect(() => buildTerminalLaunch({ ...options, action: 'new', cliPath: null })).toThrow('尚未构建');
    expect(() => buildTerminalLaunch({ ...options, action: 'resume', session: { ...session, resumeReadOnlyReason: '只读会话' } })).toThrow('只读会话');
    expect(() => buildTerminalLaunch({ ...options, action: 'terminal', nodePath: null })).toThrow('Node.js');
    expect(() => buildTerminalLaunch({ ...options, action: 'terminal', pythonPath: null })).toThrow('Python');
  });

  it.each(['terminal', 'new', 'resume'])('preserves the diagnostic environment for %s', (action) => {
    const env = {
      MOSS_CONFIG_DIR: '/isolated', MOSS_MODEL_BASE_URL: 'http://localhost',
      ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'local-agent',
      npm_config_prefix: '/pnpm/global/node', NPM_CONFIG_PREFIX: '/npm/global', Npm_Config_Prefix: '/mixed/global',
      npm_config_registry: 'https://registry.npmjs.org', NVM_DIR: '/user/.nvm', NVM_BIN: '/user/.nvm/versions/node/v22/bin',
      DIAGNOSTIC_MARKER: 'inherited', HOME: '/user', MOSS_HOME: '/user/.moss',
    };
    const launch = buildTerminalLaunch({ ...options, action, env });
    expect(launch.env.MOSS_CONFIG_DIR).toBe('/isolated');
    expect(launch.env.MOSS_MODEL_BASE_URL).toBe('http://localhost');
    expect(launch.env.CLAUDECODE).toBeUndefined();
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(launch.env.NODE_OPTIONS).toBeUndefined();
    expect(launch.env.npm_config_prefix).toBe(env.npm_config_prefix);
    expect(launch.env.NPM_CONFIG_PREFIX).toBe(env.NPM_CONFIG_PREFIX);
    expect(launch.env.Npm_Config_Prefix).toBe(env.Npm_Config_Prefix);
    expect(launch.env.npm_config_registry).toBe(env.npm_config_registry);
    expect(launch.env.NVM_DIR).toBe(env.NVM_DIR);
    expect(launch.env.NVM_BIN).toBe(env.NVM_BIN);
    expect(launch.env.DIAGNOSTIC_MARKER).toBe(env.DIAGNOSTIC_MARKER);
    expect(launch.env.HOME).toBe(env.HOME);
    expect(launch.env.MOSS_HOME).toBe(env.MOSS_HOME);
    expect(env.npm_config_prefix).toBe('/pnpm/global/node');
    expect(env.NPM_CONFIG_PREFIX).toBe('/npm/global');
    expect(env.Npm_Config_Prefix).toBe('/mixed/global');
  });

  it('executes paths containing shell metacharacters as literal arguments', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moss-terminal-'));
    let prepared;
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
      prepared = prepareTerminalShell(launch);
      const result = spawnSync(prepared.shell, prepared.args, { cwd, env: prepared.env, input: 'exit\n', encoding: 'utf8', timeout: 10000 });
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.args).toEqual(['--trust-directory', cwd, '--resume', transcriptPath]);
      expect(output.node).toBe(process.execPath);
      expect(output.path.split(':')[0]).toBe(path.dirname(process.execPath));
      // macOS resolves /var to /private/var for the child process cwd.
      expect(output.cwd.endsWith(path.basename(cwd))).toBe(true);
    } finally { prepared?.cleanup?.(); rmSync(root, { recursive: true, force: true }); }
  });

  it('passes Windows paths through a literal PowerShell command', () => {
    const launch = buildTerminalLaunch({ ...options, action: 'resume', platform: 'win32',
      nodePath: 'C:\\runtime\\node.exe', pythonPath: 'C:\\python\\python.exe',
      cliPath: "C:\\Program Files\\Moss's\\cli.js", transcriptPath: 'C:\\work\\$session.jsonl' });
    expect(launch.args.slice(0, 3)).toEqual(['-NoLogo', '-NoExit', '-EncodedCommand']);
    const command = Buffer.from(launch.args[3], 'base64').toString('utf16le');
    expect(command).toContain("'C:\\Program Files\\Moss''s\\cli.js'");
    expect(command).toContain("'--resume' 'C:\\work\\$session.jsonl'");
    expect(command).toContain("'--trust-directory' '/workspace'");
    expect(command).toContain('$env:Path =');
    expect(command).toContain("'C:\\runtime;C:\\python;C:\\python\\Scripts;'");
    expect(command).toContain("Set-Location -LiteralPath '/workspace'");
  });
});

const shellCases = ['/bin/zsh', '/bin/bash', '/bin/sh'].filter(existsSync)
  .flatMap((shell) => ['terminal', 'new', 'resume'].map((action) => [shell, action]));
const quoteShell = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

describe('terminal shell initialization', () => {
  it.skipIf(!existsSync('/bin/zsh'))('respects custom ZDOTDIR changes and restores them for the interactive shell', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'moss-terminal-zdotdir-'));
    let prepared;
    try {
      const first = path.join(root, 'first');
      const second = path.join(root, "second ' $dir");
      mkdirSync(first);
      mkdirSync(second);
      writeFileSync(path.join(first, '.zshenv'), `export ZDOTDIR=${quoteShell(second)}\nexport PROFILE_ORDER=env\n`);
      for (const [name, label] of [['.zprofile', 'profile'], ['.zshrc', 'rc'], ['.zlogin', 'login']]) {
        writeFileSync(path.join(second, name), `export PROFILE_ORDER="$PROFILE_ORDER,${label}"\n`);
      }
      const launch = buildTerminalLaunch({ ...options, action: 'terminal',
        session: { ...session, workspace: root }, env: { HOME: root, SHELL: '/bin/zsh', ZDOTDIR: first, PATH: '/usr/bin:/bin' },
      });
      prepared = prepareTerminalShell(launch);
      const result = spawnSync(prepared.shell, prepared.args, { cwd: root, env: prepared.env, encoding: 'utf8',
        input: 'printf "%s\\n" "$PROFILE_ORDER" "$ZDOTDIR"\nexit\n', timeout: 10000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual(['env,profile,rc,login', second]);
    } finally { prepared?.cleanup?.(); rmSync(root, { recursive: true, force: true }); }
  });

  it.each(shellCases)('%s keeps managed runtimes and workspace after user profiles for %s', (shell, action) => {
    const root = mkdtempSync(path.join(tmpdir(), 'moss-terminal-profile-'));
    let prepared;
    try {
      const cwd = path.join(root, "workspace ' $d `x`");
      const nodeDir = path.join(root, "node's bin");
      const pythonDir = path.join(root, 'python bin');
      const shadowDir = path.join(root, 'other-bin');
      for (const directory of [cwd, nodeDir, pythonDir, shadowDir]) mkdirSync(directory);
      symlinkSync(process.execPath, path.join(nodeDir, 'node'));
      writeFileSync(path.join(pythonDir, 'python3'), '#!/bin/sh\nprintf "managed-python\\n"\n', { mode: 0o755 });
      symlinkSync('python3', path.join(pythonDir, 'python'));
      for (const name of ['node', 'python', 'python3']) {
        writeFileSync(path.join(shadowDir, name), '#!/bin/sh\nprintf "wrong-runtime\\n"\n', { mode: 0o755 });
      }
      const profile = `export PATH=${quoteShell(shadowDir)}:/usr/bin:/bin
export MOSS_NODE_PATH=/other/node MOSS_PYTHON_PATH=/other/python
alias moss_test_alias='echo user-shell-ready'
cd "$HOME"
printf 'profile-diagnostic-visible\\n' >&2
`;
      for (const name of ['.zshrc', '.zlogin', '.bashrc', '.profile']) writeFileSync(path.join(root, name), profile);
      writeFileSync(path.join(root, '.bash_profile'), '. "$HOME/.bashrc"\n');
      const cliPath = path.join(root, 'report.cjs');
      writeFileSync(cliPath, `console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),home:process.env.HOME,
        node:process.env.MOSS_NODE_PATH,python:process.env.MOSS_PYTHON_PATH,path:process.env.PATH,
        prefix:process.env.npm_config_prefix,diagnostic:process.env.DIAGNOSTIC_MARKER,zdotdir:process.env.ZDOTDIR}));`);
      const launch = buildTerminalLaunch({
        ...options, action, session: { ...session, workspace: cwd }, cliPath,
        nodePath: path.join(nodeDir, 'node'), pythonPath: path.join(pythonDir, 'python3'),
        env: { HOME: root, SHELL: shell, PATH: '/usr/bin:/bin', npm_config_prefix: '/pnpm/global/node', DIAGNOSTIC_MARKER: 'keep-me' },
      });
      prepared = prepareTerminalShell(launch);
      const result = spawnSync(prepared.shell, prepared.args, {
        cwd, env: prepared.env, encoding: 'utf8', timeout: 10000,
        input: `node ${quoteShell(cliPath)} interactive\npython\npython3\nmoss_test_alias\nexit\n`,
      });
      expect(result.status).toBe(0);
      const reports = result.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
      expect(reports).toHaveLength(action === 'terminal' ? 1 : 2);
      for (const report of reports) {
        expect(realpathSync(report.cwd)).toBe(realpathSync(cwd));
        expect(report.home).toBe(root);
        expect(report.path.split(':').slice(0, 2)).toEqual([nodeDir, pythonDir]);
        expect(report.node).toBe(path.join(nodeDir, 'node'));
        expect(report.python).toBe(path.join(pythonDir, 'python3'));
        expect(report.prefix).toBe('/pnpm/global/node');
        expect(report.diagnostic).toBe('keep-me');
        expect(report.zdotdir).toBeUndefined();
      }
      expect(reports.at(-1).args).toEqual(['interactive']);
      expect(result.stdout).toContain('user-shell-ready');
      expect(result.stdout.match(/managed-python/g)).toHaveLength(2);
      expect(result.stdout).not.toContain('wrong-runtime');
      expect(result.stderr).toContain('profile-diagnostic-visible');
    } finally {
      prepared?.cleanup?.();
      rmSync(root, { recursive: true, force: true });
    }
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
  it.each(['exit', 'spawn-error'])('removes shell startup files after %s', async (reason) => {
    const pty = fakePty();
    let directory = '';
    const manager = createTerminalManager({ loadPty: async () => ({
      spawn: (_shell, _args, { env }) => {
        directory = env.ZDOTDIR;
        expect(existsSync(directory)).toBe(true);
        if (reason === 'spawn-error') throw new Error('spawn failed');
        return pty;
      },
    }) });
    const window = owner();
    manager.attach(window, buildTerminalLaunch({ ...options, action: 'terminal' }));
    try {
      if (reason === 'spawn-error') {
        await expect(manager.start(window, { requestId: 'one' })).rejects.toThrow('spawn failed');
      } else {
        await manager.start(window, { requestId: 'one' });
        pty.emitExit(0);
      }
      expect(existsSync(directory)).toBe(false);
    } finally { manager.dispose(); }
  });

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
