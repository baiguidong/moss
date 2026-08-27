import { describe, expect, test } from 'bun:test';
import {
  isSubAgentFailureEntry,
  resolveSubAgentStatus,
} from '../src/shared/subagent-lifecycle.mjs';

describe('sub-agent lifecycle', () => {
  test('recognizes structured API failures without relying on display text', () => {
    expect(isSubAgentFailureEntry({
      type: 'assistant',
      isApiErrorMessage: true,
      error: 'invalid_request',
      message: { content: [{ type: 'text', text: 'Prompt is too long' }] },
    })).toBe(true);
    expect(isSubAgentFailureEntry({ type: 'assistant', apiError: 'authentication_failed' })).toBe(true);
    expect(isSubAgentFailureEntry({ type: 'assistant', message: { content: [] } })).toBe(false);
  });

  test('uses durable terminal evidence instead of parent busy state', () => {
    expect(resolveSubAgentStatus({
      metadataStatus: 'failed',
      transcriptStatus: null,
      transcriptFailed: false,
      parentBusy: true,
      runtimeActive: true,
    })).toBe('failed');
    expect(resolveSubAgentStatus({
      metadataStatus: 'completed',
      transcriptStatus: null,
      transcriptFailed: true,
      parentBusy: true,
      runtimeActive: true,
    })).toBe('failed');
    expect(resolveSubAgentStatus({
      metadataStatus: 'failed',
      transcriptStatus: 'completed',
      transcriptFailed: true,
      parentBusy: false,
      runtimeActive: false,
    })).toBe('completed');
  });

  test('keeps a background child running while its parent runtime is active', () => {
    expect(resolveSubAgentStatus({
      metadataStatus: 'running',
      transcriptStatus: null,
      transcriptFailed: false,
      parentBusy: false,
      runtimeActive: true,
    })).toBe('running');
    expect(resolveSubAgentStatus({
      metadataStatus: null,
      transcriptStatus: null,
      transcriptFailed: false,
      parentBusy: false,
      runtimeActive: true,
    })).toBe('running');
  });

  test('lets a transcript failure override metadata that has not flushed yet', () => {
    expect(resolveSubAgentStatus({
      metadataStatus: 'running',
      transcriptStatus: null,
      transcriptFailed: true,
      parentBusy: true,
      runtimeActive: true,
    })).toBe('failed');
  });

  test('recovers an abandoned running child as failed after restart', () => {
    expect(resolveSubAgentStatus({
      metadataStatus: 'running',
      transcriptStatus: null,
      transcriptFailed: false,
      parentBusy: false,
      runtimeActive: false,
    })).toBe('failed');
  });
});
