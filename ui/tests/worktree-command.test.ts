import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileNoThrowWithCwd } from '../../src/utils/execFileNoThrow';

test('the Git command executor timeout waits for the child process to exit', async () => {
  const result = await execFileNoThrowWithCwd('/bin/sh', ['-c', 'echo "$$"; exec sleep 30'], {
    cwd: tmpdir(), timeout: 1000,
  });
  expect(result.code).not.toBe(0);
  const pid = Number(result.stdout.trim());
  expect(pid).toBeGreaterThan(0);
  expect(() => process.kill(pid, 0)).toThrow();
});

test('a pre-cancelled Git command does not execute', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await execFileNoThrowWithCwd(process.execPath, ['-e', 'console.log("unexpected execution")'], {
    cwd: tmpdir(), abortSignal: controller.signal,
  });
  expect(result.code).not.toBe(0);
  expect(result.stdout).not.toContain('unexpected execution');
});

test('cancelling an active command terminates it and resolves the no-throw result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moss-command-cancel-'));
  const ready = join(root, 'pid');
  const controller = new AbortController();
  const work = execFileNoThrowWithCwd(process.execPath, ['-e',
    'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)', ready,
  ], { cwd: root, abortSignal: controller.signal, timeout: 5000 });
  try {
    let pid = 0;
    const deadline = Date.now() + 4000;
    while (!pid && Date.now() < deadline) {
      pid = await readFile(ready, 'utf8').then(Number, () => 0);
      if (!pid) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(pid).toBeGreaterThan(0);
    controller.abort();
    expect((await work).code).not.toBe(0);
    expect(() => process.kill(pid, 0)).toThrow();
  } finally { controller.abort(); await work; await rm(root, { recursive: true, force: true }); }
});
