import { describe, expect, test } from 'bun:test';
import {
  deriveProjectSessionTaskStatus,
  shouldCancelProjectTaskOnArchive,
  shouldRecoverInterruptedProjectTask,
} from '../src/shared/project-session-task.mjs';

describe('project session task status', () => {
  test('keeps terminal root-session states authoritative', () => {
    expect(deriveProjectSessionTaskStatus({ persistedStatus: 'completed', pendingDecisionCount: 1 })).toBe('completed');
    expect(deriveProjectSessionTaskStatus({ persistedStatus: 'failed', busy: true })).toBe('failed');
    expect(deriveProjectSessionTaskStatus({ persistedStatus: 'canceled', activeWorkerCount: 1 })).toBe('canceled');
  });

  test('shows pending decisions before running work', () => {
    expect(deriveProjectSessionTaskStatus({
      persistedStatus: 'in_progress',
      pendingDecisionCount: 2,
      busy: true,
      activeWorkerCount: 1,
    })).toBe('waiting_for_user');
  });

  test('derives queued and running states from the root session', () => {
    expect(deriveProjectSessionTaskStatus()).toBe('queued');
    expect(deriveProjectSessionTaskStatus({ messageCount: 1 })).toBe('in_progress');
    expect(deriveProjectSessionTaskStatus({ activeWorkerCount: 1 })).toBe('in_progress');
  });

  test('recovers only tasks that predate the current startup', () => {
    expect(shouldRecoverInterruptedProjectTask({
      status: 'in_progress',
      stateUpdatedAt: 100,
      sessionUpdatedAt: 90,
      recoveryCutoff: 110,
    })).toBe(true);
    expect(shouldRecoverInterruptedProjectTask({
      status: 'queued',
      stateUpdatedAt: 120,
      recoveryCutoff: 110,
    })).toBe(false);
    expect(shouldRecoverInterruptedProjectTask({
      status: 'completed',
      stateUpdatedAt: 100,
      recoveryCutoff: 110,
    })).toBe(false);
  });

  test('archives only active work and preserves terminal history', () => {
    expect(shouldCancelProjectTaskOnArchive({ status: 'in_progress' })).toBe(true);
    expect(shouldCancelProjectTaskOnArchive({ status: 'completed' })).toBe(false);
    expect(shouldCancelProjectTaskOnArchive({ status: 'failed' })).toBe(false);
    expect(shouldCancelProjectTaskOnArchive({ status: 'completed', activeWorkerCount: 1 })).toBe(true);
  });
});
