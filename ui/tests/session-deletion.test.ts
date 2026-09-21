import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  excludeRemovedSessions,
  isSessionAlreadyRemovedError,
} from '../src/renderer-react/lib/session-removal';

const mainSource = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');

function functionSource(name: string, nextName: string): string {
  const start = mainSource.indexOf(`function ${name}`);
  const end = mainSource.indexOf(`function ${nextName}`, start + 1);
  return mainSource.slice(start, end);
}

describe('session deletion', () => {
  test('does not restore a removed session from a stale list response', () => {
    const removed = new Set(['deleted-session']);
    const sessions = [
      { id: 'active-session' },
      { id: 'deleted-session' },
    ];

    expect(excludeRemovedSessions(sessions, removed)).toEqual([
      { id: 'active-session' },
    ]);
  });

  test('recognizes an already-removed session as an idempotent delete', () => {
    expect(isSessionAlreadyRemovedError(
      new Error('Error invoking remote method: Unknown session: deleted-session'),
    )).toBe(true);
    expect(isSessionAlreadyRemovedError(new Error('Database is locked'))).toBe(false);
  });

  test('marks a session deleted before aborting its runtime', () => {
    const start = mainSource.indexOf('async function deleteSessionRecordById');
    const end = mainSource.indexOf("ipcMain.handle('agent:delete-session'", start);
    const source = mainSource.slice(start, end);
    expect(source.indexOf('sessionRecord.deleted = true;')).toBeGreaterThan(-1);
    expect(source.indexOf('sessionRecord.deleted = true;')).toBeLessThan(
      source.indexOf('sessionRecord.runtime?.abort?.()'),
    );
    expect(source).toContain('alreadyRemoved: true');
  });

  test('does not publish metadata or history for deleted sessions', () => {
    expect(functionSource('emitSessionMeta', 'emitSessionHistory')).toContain(
      'if (!sessionRecord || sessionRecord.deleted) return;',
    );
    expect(functionSource('emitSessionHistory', 'isPlainObject')).toContain(
      'if (!sessionRecord || sessionRecord.deleted) return;',
    );
  });

  test('does not list or publish final state for deletion-pending sessions', () => {
    const listStart = mainSource.indexOf('function listVisibleSessionSummaries');
    const listEnd = mainSource.indexOf("ipcMain.handle('agent:list-sessions'", listStart);
    expect(mainSource.slice(listStart, listEnd)).toContain(
      '.filter(s => !s.deleted)',
    );

    const runSource = functionSource('runSessionPromptNow', 'runSessionPrompt');
    expect(runSource).toContain('if (!sessionRecord.deleted) {');
    expect(runSource).toContain("emitToRenderer('agent:state'");
  });

  test('does not continue queued or completed prompt work after deletion', () => {
    const queuedRunSource = functionSource('runSessionPrompt', 'getLatestAssistantTextFromHistory');
    expect(queuedRunSource).toContain('if (options.sessionRecord.deleted)');

    const sendStart = mainSource.indexOf('async function sendAgentPromptNow');
    const sendEnd = mainSource.indexOf('\nfunction sendAgentPrompt(', sendStart);
    const sendSource = mainSource.slice(sendStart, sendEnd);
    expect(sendSource).toContain('if (sessionRecord.deleted)');
    expect(sendSource).toContain('deleted: true');
  });
});
