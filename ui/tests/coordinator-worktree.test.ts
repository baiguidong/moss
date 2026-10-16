import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { runAgentWorktreeCleanup, waitForAgentWorktreeCleanup } from '../../src/tools/AgentTool/worktreeCleanup';

const source = readFileSync(new URL('../../src/tools/AgentTool/AgentTool.tsx', import.meta.url), 'utf8');
const start = source.indexOf('const cleanupWorktreeIfNeeded =');
const end = source.indexOf('if (shouldRunAsync)', start);
const transpiler = new Bun.Transpiler({ loader: 'tsx' });

function fixture(removed: boolean) {
  const updates: any[] = [];
  const context = {
    worktreeInfo: { worktreePath: '/tmp/worker', worktreeBranch: 'worker-branch', headCommit: 'base', gitRoot: '/tmp/repo' },
    earlyAgentId: 'worker', asAgentId: (id: string) => id,
    hasWorktreeChanges: async () => false,
    removeAgentWorktree: async () => removed,
    updateAgentMetadata: async (_id: string, change: any) => { updates.push(change); },
    logForDebugging: () => {},
    runAgentWorktreeCleanup,
  };
  return { updates, cleanup: runInNewContext(`${transpiler.transformSync(source.slice(start, end))}; cleanupWorktreeIfNeeded`, context) };
}

test('failed worktree removal preserves its path in metadata and the completion receipt', async () => {
  const f = fixture(false);
  expect(await f.cleanup()).toEqual({ worktreePath: '/tmp/worker', worktreeBranch: 'worker-branch' });
  expect(f.updates).toHaveLength(0);
});

test('successful worktree removal clears the saved path', async () => {
  const f = fixture(true);
  expect(await f.cleanup()).toEqual({});
  expect(f.updates).toEqual([{ worktreePath: undefined }]);
});

test('resume waits for pending directory cleanup, but cancellation does not wait for Git', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const cleanup = runAgentWorktreeCleanup('/tmp/pending-worker', () => gate);
  const controller = new AbortController();
  let resumed = false;
  const resume = waitForAgentWorktreeCleanup('/tmp/pending-worker', controller.signal).then(() => { resumed = true; });
  await Promise.resolve();
  expect(resumed).toBe(false);
  controller.abort();
  await expect(resume).rejects.toMatchObject({ name: 'AbortError' });
  const next = waitForAgentWorktreeCleanup('/tmp/pending-worker', new AbortController().signal);
  release();
  expect(await next).toBe(true);
  await cleanup;
  expect(await waitForAgentWorktreeCleanup('/tmp/pending-worker', new AbortController().signal)).toBe(false);
});
