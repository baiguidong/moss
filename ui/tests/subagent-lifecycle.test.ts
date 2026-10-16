import { describe, expect, test } from 'bun:test';
import {
  isAgentTeamSidechain,
  isSubAgentFailureEntry,
  parseSubAgentTranscript,
  resolveSubAgentStatus,
} from '../src/shared/subagent-lifecycle.mjs';

describe('sub-agent lifecycle', () => {
  test('clears a recovered API failure when a later assistant response succeeds', () => {
    const parsed = parseSubAgentTranscript([
      { type: 'assistant', isSidechain: true, isApiErrorMessage: true, error: 'overloaded', message: { content: [] } },
      { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'Recovered' }] } },
    ].map(entry => JSON.stringify(entry)).join('\n'));
    expect(parsed.failed).toBe(false);
    expect(parsed.history).toHaveLength(2);
    expect(parsed.history[1].isSidechain).toBe(false);
    expect(resolveSubAgentStatus({ metadataStatus: 'completed', transcriptFailed: parsed.failed })).toBe('completed');
  });

  test('a follow-up prompt starts a new run after a terminal transcript result', () => {
    const parsed = parseSubAgentTranscript([
      { type: 'result', subtype: 'success' },
      { type: 'user', message: { role: 'user', content: 'Continue the work' } },
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n{"type":');
    expect(parsed.terminalStatus).toBeNull();
    expect(parsed.failed).toBe(false);
    expect(parsed.history).toHaveLength(1);
  });

  test('live worker state overrides prior transcript and metadata while resuming or stopping', () => {
    const previous = { metadataStatus: 'completed', transcriptStatus: 'completed', transcriptFailed: true, parentBusy: true };
    expect(resolveSubAgentStatus({ ...previous, runtimeStatus: 'running' })).toBe('running');
    expect(resolveSubAgentStatus({ ...previous, runtimeStatus: 'killed' })).toBe('failed');
    expect(resolveSubAgentStatus({ ...previous, runtimeStatus: 'failed' })).toBe('failed');
    expect(resolveSubAgentStatus({ ...previous, runtimeStatus: 'completed' })).toBe('completed');
  });

  test('keeps Agent Team member sidechains out of coordinator children', () => {
    expect(isAgentTeamSidechain({ teamName: 'system-check' }, [])).toBe(true);
    expect(isAgentTeamSidechain({}, [{
      type: 'user',
      message: {
        role: 'user',
        content: '<teammate-message teammate_id="team-lead">work</teammate-message>',
      },
    }])).toBe(true);
    expect(isAgentTeamSidechain({ agentType: 'general-purpose' }, [{
      type: 'user',
      message: { role: 'user', content: 'ordinary coordinator work' },
    }])).toBe(false);
  });

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
    })).toBe('failed');
    expect(resolveSubAgentStatus({
      metadataStatus: 'completed',
      transcriptStatus: null,
      transcriptFailed: true,
      parentBusy: true,
    })).toBe('failed');
    expect(resolveSubAgentStatus({
      metadataStatus: 'failed',
      transcriptStatus: 'completed',
      transcriptFailed: true,
      parentBusy: false,
    })).toBe('completed');
  });

  test('keeps a live background worker running while its parent is idle', () => {
    expect(resolveSubAgentStatus({
      metadataStatus: 'running',
      transcriptStatus: null,
      transcriptFailed: false,
      parentBusy: false,
      runtimeStatus: 'running',
    })).toBe('running');
    expect(resolveSubAgentStatus({
      metadataStatus: null,
      transcriptStatus: null,
      transcriptFailed: false,
      parentBusy: false,
      runtimeStatus: 'running',
    })).toBe('running');
  });

  test('lets a transcript failure override metadata that has not flushed yet', () => {
    expect(resolveSubAgentStatus({
      metadataStatus: 'running',
      transcriptStatus: null,
      transcriptFailed: true,
      parentBusy: true,
    })).toBe('failed');
  });

  test('recovers an abandoned running child as failed after restart', () => {
    expect(resolveSubAgentStatus({
      metadataStatus: 'running',
      transcriptStatus: null,
      transcriptFailed: false,
      parentBusy: false,
    })).toBe('failed');
  });
});
