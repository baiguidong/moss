import { describe, expect, it } from 'bun:test';
import {
  getToolExecutionState,
  resolveAutoCollapseToolCalls,
  shouldAutoCollapseToolCall,
} from '../src/renderer-react/components/chat/tool-display-settings';

describe('tool display settings', () => {
  it('uses the session setting before the global default', () => {
    expect(resolveAutoCollapseToolCalls(true, false)).toBe(true);
    expect(resolveAutoCollapseToolCalls(false, true)).toBe(false);
    expect(resolveAutoCollapseToolCalls(null, true)).toBe(true);
    expect(resolveAutoCollapseToolCalls(undefined, false)).toBe(false);
  });

  it('keeps the current expanded behavior when automatic collapse is disabled', () => {
    expect(shouldAutoCollapseToolCall({
      enabled: false,
      status: 'success',
      failed: false,
      hasResult: true,
    })).toBe(false);
  });

  it('keeps only actively executing tools expanded', () => {
    expect(shouldAutoCollapseToolCall({
      enabled: true,
      status: 'running',
      failed: false,
      hasResult: false,
    })).toBe(false);
    expect(shouldAutoCollapseToolCall({
      enabled: true,
      status: 'pending',
      failed: false,
      hasResult: false,
    })).toBe(false);
    expect(shouldAutoCollapseToolCall({
      enabled: true,
      status: 'success',
      failed: false,
      hasResult: true,
    })).toBe(true);
    expect(shouldAutoCollapseToolCall({
      enabled: true,
      status: 'error',
      failed: true,
      hasResult: true,
    })).toBe(true);
  });

  it('collapses as soon as a pending tool receives a terminal result', () => {
    expect(shouldAutoCollapseToolCall({
      enabled: true,
      status: 'pending',
      failed: false,
      hasResult: true,
    })).toBe(true);
  });

  it('derives a single visual and folding state from status and result data', () => {
    expect(getToolExecutionState({
      status: 'pending',
      failed: false,
      hasResult: true,
    })).toBe('completed');
    expect(getToolExecutionState({
      status: 'pending',
      failed: true,
      hasResult: false,
    })).toBe('failed');
    expect(getToolExecutionState({
      status: 'success',
      failed: false,
      hasResult: false,
    })).toBe('completed');
    expect(getToolExecutionState({
      status: 'running',
      failed: false,
      hasResult: false,
    })).toBe('running');
  });
});
