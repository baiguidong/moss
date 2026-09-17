import { describe, expect, it } from 'bun:test';
import {
  getToolExecutionState,
  resolveToolDisplayMode,
  shouldAutoCollapseToolCall,
  shouldExpandThinking,
} from '../src/renderer-react/components/chat/tool-display-settings';

describe('tool display settings', () => {
  it('uses the session setting before the global default', () => {
    expect(resolveToolDisplayMode('merged', 'expanded')).toBe('merged');
    expect(resolveToolDisplayMode('collapsed', 'merged')).toBe('collapsed');
    expect(resolveToolDisplayMode(null, 'merged')).toBe('merged');
    expect(resolveToolDisplayMode(undefined, 'expanded')).toBe('expanded');
  });

  it('keeps the current expanded behavior when automatic collapse is disabled', () => {
    expect(shouldAutoCollapseToolCall({
      mode: 'expanded',
      status: 'success',
      failed: false,
      hasResult: true,
    })).toBe(false);
  });

  it('keeps only actively executing tools expanded', () => {
    expect(shouldAutoCollapseToolCall({
      mode: 'collapsed',
      status: 'running',
      failed: false,
      hasResult: false,
    })).toBe(false);
    expect(shouldAutoCollapseToolCall({
      mode: 'collapsed',
      status: 'pending',
      failed: false,
      hasResult: false,
    })).toBe(false);
    expect(shouldAutoCollapseToolCall({
      mode: 'collapsed',
      status: 'success',
      failed: false,
      hasResult: true,
    })).toBe(true);
    expect(shouldAutoCollapseToolCall({
      mode: 'collapsed',
      status: 'error',
      failed: true,
      hasResult: true,
    })).toBe(true);
  });

  it('collapses as soon as a pending tool receives a terminal result', () => {
    expect(shouldAutoCollapseToolCall({
      mode: 'collapsed',
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

  it('applies tool display modes to thinking content', () => {
    expect(shouldExpandThinking('expanded', false)).toBe(true);
    expect(shouldExpandThinking('collapsed', true)).toBe(true);
    expect(shouldExpandThinking('collapsed', false)).toBe(false);
    expect(shouldExpandThinking('merged', true)).toBe(false);
    expect(shouldExpandThinking('merged', false)).toBe(false);
  });
});
