import { describe, expect, test } from 'bun:test';
import {
  deriveProjectSessionTaskStatus,
  runProjectFinalizerBestEffort,
  shouldCancelProjectTaskOnArchive,
  shouldRecoverInterruptedProjectTask,
  waitForProjectTaskRunBeforeContinuation,
} from '../src/shared/project-session-task.mjs';

describe('project session task status', () => {
  test('keeps terminal root-session states authoritative', () => {
    expect(deriveProjectSessionTaskStatus({ persistedStatus: 'completed', pendingDecisionCount: 1 })).toBe('completed');
    expect(deriveProjectSessionTaskStatus({ persistedStatus: 'failed', busy: true })).toBe('failed');
    expect(deriveProjectSessionTaskStatus({ persistedStatus: 'stopped', activeWorkerCount: 1 })).toBe('stopped');
  });

  test('shows pending decisions before running work', () => {
    expect(deriveProjectSessionTaskStatus({
      persistedStatus: 'working',
      pendingDecisionCount: 2,
      busy: true,
      activeWorkerCount: 1,
    })).toBe('waiting_for_user');
  });

  test('derives working state from the root session', () => {
    expect(deriveProjectSessionTaskStatus()).toBe('working');
    expect(deriveProjectSessionTaskStatus({ activeWorkerCount: 1 })).toBe('working');
  });

  test('recovers only tasks that predate the current startup', () => {
    expect(shouldRecoverInterruptedProjectTask({
      status: 'working',
      sessionUpdatedAt: 90,
      recoveryCutoff: 110,
    })).toBe(true);
    expect(shouldRecoverInterruptedProjectTask({
      status: 'working',
      sessionUpdatedAt: 120,
      recoveryCutoff: 110,
    })).toBe(false);
    expect(shouldRecoverInterruptedProjectTask({
      status: 'completed',
      sessionUpdatedAt: 100,
      recoveryCutoff: 110,
    })).toBe(false);
  });

  test('archives only active work and preserves terminal history', () => {
    expect(shouldCancelProjectTaskOnArchive({ status: 'working' })).toBe(true);
    expect(shouldCancelProjectTaskOnArchive({ status: 'completed' })).toBe(false);
    expect(shouldCancelProjectTaskOnArchive({ status: 'failed' })).toBe(false);
    expect(shouldCancelProjectTaskOnArchive({ status: 'completed', activeWorkerCount: 1 })).toBe(true);
  });

  test('keeps a completed task successful when finalization fails', async () => {
    const failure = new Error('memory write failed');
    let observed = null;
    const outcome = await runProjectFinalizerBestEffort(
      async () => { throw failure; },
      async (error) => { observed = error; },
    );
    expect(outcome.result).toBeNull();
    expect(outcome.error).toBe(failure);
    expect(observed).toBe(failure);
  });

  test('does not revive task failure when finalizer error reporting also fails', async () => {
    const outcome = await runProjectFinalizerBestEffort(
      async () => { throw new Error('finalizer failed'); },
      async () => { throw new Error('event write failed'); },
    );
    expect(outcome.result).toBeNull();
    expect(outcome.error?.message).toBe('finalizer failed');
  });

  test('queues a continuation behind the active coordinator run', async () => {
    let release;
    const activeRun = new Promise((resolve) => { release = resolve; });
    let continued = false;
    const waiting = waitForProjectTaskRunBeforeContinuation(activeRun)
      .then(() => { continued = true; });
    await Promise.resolve();
    expect(continued).toBe(false);
    release();
    await waiting;
    expect(continued).toBe(true);
  });

  test('does not continue a task that was stopped while waiting', async () => {
    let stopped = false;
    await expect(waitForProjectTaskRunBeforeContinuation(
      Promise.resolve().then(() => { stopped = true; }),
      () => stopped,
    )).rejects.toThrow('任务已停止');
  });
});
