import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_LOCAL_AUDIT_RULES,
  evaluateLocalAuditSession,
  normalizeLocalAuditSession,
  validateAuditRuleConfig,
} from '../src/local-audit-engine.mjs';

function rules() {
  return DEFAULT_LOCAL_AUDIT_RULES.map((rule) => ({ ...rule, version: 1 }));
}

describe('local audit engine', () => {
  it('normalizes canonical tool calls and detects built-in risks', () => {
    const session = {
      id: 'session-1',
      workspace: '/work/project',
      history: [
        {
          type: 'assistant',
          timestamp: 100,
          message: {
            content: [
              { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'rm -rf ./build' } },
              { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/work/project/.env' } },
              { type: 'tool_use', id: 'write-1', name: 'Write', input: { file_path: '/tmp/out.txt' } },
            ],
          },
        },
        {
          type: 'user',
          timestamp: 200,
          permission_denials: [{ tool_use_id: 'write-1', reason: 'not allowed' }],
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'bash-1', is_error: true, content: 'failed' },
              { type: 'tool_result', tool_use_id: 'read-1', content: 'SECRET=hidden' },
              { type: 'tool_result', tool_use_id: 'write-1', content: 'ok' },
            ],
          },
        },
      ],
    };

    const normalized = normalizeLocalAuditSession(session);
    const findings = evaluateLocalAuditSession(session, normalized, rules());

    expect(normalized.tools).toHaveLength(3);
    expect(normalized.tools.find((tool) => tool.toolUseId === 'bash-1')?.status).toBe('error');
    expect(normalized.completeness).toBe('complete');
    expect(new Set(findings.map((finding) => finding.ruleId))).toEqual(new Set([
      'destructive-command',
      'sensitive-file-access',
      'outside-workspace-write',
      'failed-tool-call',
      'permission-denial',
    ]));
  });

  it('routes interleaved streaming input fragments by content block index', () => {
    const session = {
      id: 'stream-session',
      workspace: '/work/project',
      history: [
        { type: 'stream_event', event: { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'a', name: 'Read', input: {} } } },
        { type: 'stream_event', event: { type: 'content_block_start', index: 4, content_block: { type: 'tool_use', id: 'b', name: 'Bash', input: {} } } },
        { type: 'stream_event', event: { type: 'content_block_delta', index: 4, delta: { type: 'input_json_delta', partial_json: '{"command":"pwd"}' } } },
        { type: 'stream_event', event: { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"file_path":"/work/project/a.txt"}' } } },
      ],
    };

    const normalized = normalizeLocalAuditSession(session);
    expect(normalized.tools.find((tool) => tool.toolUseId === 'a')?.input).toEqual({ file_path: '/work/project/a.txt' });
    expect(normalized.tools.find((tool) => tool.toolUseId === 'b')?.input).toEqual({ command: 'pwd' });
  });

  it('supports bash command history and failure thresholds', () => {
    const session = {
      id: 'bash-session',
      workspace: '/work/project',
      history: [{ type: 'bash_command', command: 'exit 1', output: 'no', exitCode: 1 }],
    };
    const normalized = normalizeLocalAuditSession(session);
    const failureRule = {
      ...rules().find((rule) => rule.id === 'failed-tool-call')!,
      config: { minimumFailures: 2 },
    };

    expect(normalized.tools[0]?.status).toBe('error');
    expect(evaluateLocalAuditSession(session, normalized, [failureRule])).toHaveLength(0);
  });

  it('allows managed global memory writes without trusting the rest of Moss home', () => {
    const previousMossHome = process.env.MOSS_HOME;
    process.env.MOSS_HOME = '/Users/test/.moss';
    try {
      const session = {
        id: 'memory-session',
        workspace: '/work/project',
        history: [{
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'memory-write', name: 'Write', input: { file_path: '/Users/test/.moss/memory/project_note.md' } },
              { type: 'tool_use', id: 'skill-write', name: 'Edit', input: { file_path: '/Users/test/.moss/skills/local-kb/scripts/kb.py' } },
            ],
          },
        }],
      };
      const normalized = normalizeLocalAuditSession(session);
      const outsideWriteRule = rules().find((rule) => rule.id === 'outside-workspace-write')!;
      const findings = evaluateLocalAuditSession(session, normalized, [outsideWriteRule]);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.detail).toBe('/Users/test/.moss/skills/local-kb/scripts/kb.py');
    } finally {
      if (previousMossHome === undefined) delete process.env.MOSS_HOME;
      else process.env.MOSS_HOME = previousMossHome;
    }
  });

  it('rejects invalid regular expressions', () => {
    expect(() => validateAuditRuleConfig('destructive-command', { patterns: ['['] })).toThrow();
  });

  it('normalizes allowed paths for the outside workspace write rule', () => {
    expect(validateAuditRuleConfig('outside-workspace-write', {
      allowedPaths: [' ${MOSS_HOME}/memory ', '', '/shared/audit-safe'],
    })).toEqual({ allowedPaths: ['${MOSS_HOME}/memory', '/shared/audit-safe'] });
  });
});
