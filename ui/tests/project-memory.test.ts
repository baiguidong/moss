import { describe, expect, it } from 'bun:test';
import {
  formatProjectMemoryForDisplay,
  parseProjectFinalizerResponse,
  redactProjectMemorySecrets,
  renderFallbackProjectMemory,
  renderProjectSessionMemory,
} from '../src/shared/project-memory.mjs';

describe('project memory finalization', () => {
  it('parses a fenced structured finalizer response', () => {
    expect(parseProjectFinalizerResponse(`\`\`\`json
{"conclusion":"完成调研","decisions":["使用方案 A"],"facts":["接口可用"],"completedWork":["验证接口"],"unresolvedQuestions":[],"assetCandidates":[{"path":"report.md","name":"报告"}],"projectMemory":"# Project Memory"}
\`\`\``)).toEqual({
      conclusion: '完成调研',
      decisions: ['使用方案 A'],
      facts: ['接口可用'],
      completedWork: ['验证接口'],
      unresolvedQuestions: [],
      assetCandidates: [{ path: 'report.md', name: '报告', reason: '' }],
      projectMemory: '# Project Memory',
    });
  });

  it('falls back to plain text when the model does not return JSON', () => {
    expect(parseProjectFinalizerResponse('最终完成了资料整理。').conclusion)
      .toBe('最终完成了资料整理。');
  });

  it('renders durable session memory with published assets', () => {
    const markdown = renderProjectSessionMemory({
      projectId: 'project-1',
      sessionId: 'session-1',
      sessionTitle: '调研任务',
      completedAt: Date.UTC(2026, 0, 1),
      result: { conclusion: '形成结论', completedWork: ['完成报告'] },
      publishedAssets: [{ name: 'report.md' }],
    });
    expect(markdown).toContain('# 调研任务');
    expect(markdown).toContain('形成结论');
    expect(markdown).toContain('- report.md');
  });

  it('formats stored project memory for compact Chinese display', () => {
    expect(formatProjectMemoryForDisplay(`# 项目记忆

## 当前上下文

- 已确认范围

## 会话结论：调研任务

- 使用方案 A`)).toBe(`- 已确认范围

## 会话结论：调研任务

- 使用方案 A`);
  });

  it('uses Chinese headings in fallback project memory', () => {
    const memory = renderFallbackProjectMemory('', { conclusion: '完成调研' }, '调研任务', Date.UTC(2026, 0, 1));
    expect(memory).toContain('# 项目记忆');
    expect(memory).toContain('## 当前上下文');
    expect(memory).toContain('## 会话结论：调研任务');
    expect(memory).not.toContain('Current Context');
  });

  it('redacts credentials before writing durable project memory', () => {
    expect(redactProjectMemorySecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz'))
      .toBe('Authorization: [REDACTED]');
    expect(parseProjectFinalizerResponse('{"conclusion":"api_key=secret-value-123"}').conclusion)
      .toBe('api_key=[REDACTED]');
    expect(redactProjectMemorySecrets('github_pat_abcdefghijklmnopqrstuvwxyz123456'))
      .toBe('[REDACTED]');
    expect(redactProjectMemorySecrets('Authorization: "Basic dXNlcjpwYXNzd29yZA=="'))
      .toBe('Authorization: [REDACTED]');
    expect(redactProjectMemorySecrets('cookie=session=private-value'))
      .toBe('cookie=[REDACTED]');
    expect(redactProjectMemorySecrets('AWS key AKIAABCDEFGHIJKLMNOP'))
      .toBe('AWS key [REDACTED]');
    expect(redactProjectMemorySecrets('confirmation_token=one-time-secret'))
      .toBe('confirmation_token=[REDACTED]');
    expect(redactProjectMemorySecrets('百度网盘提取码 m827'))
      .toBe('百度网盘提取码 m827');
  });
});
