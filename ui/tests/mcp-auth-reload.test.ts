import { describe, expect, it } from 'bun:test';
import { buildConnectorMcpAuthToolResult } from '../src/app-ipc.mjs';
import {
  applyPendingMcpRuntimeReload,
  scheduleMcpRuntimeReload,
} from '../src/mcp-runtime-reload.mjs';

describe('MCP runtime reload', () => {
  it('reloads idle sessions immediately', () => {
    const session = { agentMode: 'local', busy: false, runtime: {} };
    const disposed: unknown[] = [];

    expect(scheduleMcpRuntimeReload([session], (record) => disposed.push(record))).toEqual({
      resetSessionCount: 1,
      skippedBusySessionCount: 0,
    });
    expect(disposed).toEqual([session]);
  });

  it('reloads a busy session as soon as its turn finishes', () => {
    const session = { agentMode: 'local', busy: true, runtime: {} };
    const disposed: unknown[] = [];
    const dispose = (record: unknown) => disposed.push(record);

    expect(scheduleMcpRuntimeReload([session], dispose)).toEqual({
      resetSessionCount: 0,
      skippedBusySessionCount: 1,
    });
    expect(session.pendingMcpRuntimeReload).toBe(true);
    expect(applyPendingMcpRuntimeReload(session, dispose)).toBe(false);

    session.busy = false;
    expect(applyPendingMcpRuntimeReload(session, dispose)).toBe(true);
    expect(session.pendingMcpRuntimeReload).toBe(false);
    expect(disposed).toEqual([session]);
  });
});

describe('connector authentication tool result', () => {
  it('reports completed authentication without exposing the authorization URL', () => {
    const result = buildConnectorMcpAuthToolResult({
      auth: {
        name: 'lexiang',
        status: 'authenticated',
        authorizationUrl: 'https://example.test/private-oauth-request',
      },
    });

    expect(result.auth).toEqual({ name: 'lexiang', status: 'authenticated' });
    expect(result.message).toContain('授权已完成');
    expect(result.message).toContain('不要再次发起授权');
  });
});
