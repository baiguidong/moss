import { describe, expect, test } from 'bun:test';

import {
  appendAgentMailThreadSummary,
  buildAgentMailMailboxKey,
  buildAgentMailMailboxLabel,
  buildAgentMailReceivedSummary,
  buildAgentMailSessionTitle,
  buildAgentMailThreadContext,
  isEncryptedContentVerificationError,
  normalizeAgentMailSessionMode,
} from '../src/agent-mail-context.mjs';

describe('Agent Mail inference context', () => {
  test('normalizes session modes without accepting unknown persisted values', () => {
    expect(normalizeAgentMailSessionMode('new')).toBe('new');
    expect(normalizeAgentMailSessionMode('fixed')).toBe('fixed');
    expect(normalizeAgentMailSessionMode('legacy')).toBe('fixed');
  });

  test('isolates mailbox state by server, organization, and authenticated user', () => {
    const admin = buildAgentMailMailboxKey({
      serverUrl: 'https://moss.test/',
      orgId: 'org-1',
      userId: 'admin',
      userName: 'Admin',
    });
    const secondUser = buildAgentMailMailboxKey({
      serverUrl: 'https://moss.test',
      orgId: 'org-1',
      userId: 'user-2',
    });

    expect(admin).toStartWith('mailbox:');
    expect(admin).not.toBe(secondUser);
    expect(buildAgentMailMailboxLabel({ userName: ' Admin ' })).toBe('Admin');
    expect(buildAgentMailMailboxKey({ serverUrl: 'https://moss.test' })).toBe('');
  });

  test('stores only stable plain-text thread facts', () => {
    const summary = appendAgentMailThreadSummary('', {
      timestamp: Date.UTC(2026, 8, 14),
      received: '检查磁盘容量',
      conclusion: 'Data 分区使用率 99%',
      replies: ['已发送 df -h 和 uname -a，并提示磁盘告警'],
    });

    expect(summary).toBe([
      '2026-09-14',
      '收到：检查磁盘容量',
      '结论：Data 分区使用率 99%',
      '已回复：已发送 df -h 和 uname -a，并提示磁盘告警',
    ].join('\n'));
    expect(summary).not.toContain('thinking');
    expect(summary).not.toContain('tool_use');
    expect(buildAgentMailThreadContext(summary)).toContain(JSON.stringify(summary));
  });

  test('bounds summaries and recognizes encrypted reasoning verification failures', () => {
    const oversized = appendAgentMailThreadSummary('旧结论', {
      timestamp: Date.UTC(2026, 8, 14),
      conclusion: 'x'.repeat(6_000),
    }, { maxChars: 500 });

    expect(oversized.length).toBeLessThanOrEqual(500);
    expect(oversized).toStartWith('2026-09-14\n结论：');
    expect(isEncryptedContentVerificationError(
      'The encrypted content EqMF... could not be verified. Reason: Encrypted content could not be decrypted or parsed.',
    )).toBe(true);
    expect(isEncryptedContentVerificationError('API Error: 401')).toBe(false);
  });

  test('builds concise mail labels and received facts', () => {
    const message = {
      fromName: 'Alice',
      subject: '环境检查',
      content: '请检查磁盘和系统版本。',
    };
    expect(buildAgentMailSessionTitle(message)).toBe('协作邮箱：Alice · 环境检查');
    expect(buildAgentMailReceivedSummary(message)).toBe('环境检查；请检查磁盘和系统版本。');
  });
});
