import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { OverviewTabs } from '../src/renderer-react/components/overview-view';
import {
  defaultSelection,
  GlobalList,
  SessionList,
} from '../src/renderer-react/components/memory-overview';

describe('overview memory navigation', () => {
  test('keeps usage and all three memory scopes in one top tab bar', () => {
    const html = renderToStaticMarkup(
      <OverviewTabs activeTab="project" onChange={() => {}} />,
    );

    expect(html).toContain('aria-label="概览内容"');
    expect(html).toContain('>使用概览<');
    expect(html).toContain('>全局记忆<');
    expect(html).toContain('>项目记忆<');
    expect(html).toContain('>会话摘要<');
    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-selected="true"[^>]*>.*项目记忆/s);
  });

  test('separates active global memories from unindexed files', () => {
    const entries = [
      {
        id: 'MEMORY.md',
        path: 'MEMORY.md',
        title: '记忆索引',
        description: '',
        type: 'index',
        isIndex: true,
        indexed: true,
        bytes: 10,
        updatedAt: 3,
        readable: true,
      },
      {
        id: 'preference.md',
        path: 'preference.md',
        title: '回复偏好',
        description: '长期有效',
        type: 'feedback',
        isIndex: false,
        indexed: true,
        bytes: 10,
        updatedAt: 2,
        readable: true,
      },
      {
        id: 'old-task.md',
        path: 'old-task.md',
        title: '旧任务状态',
        description: '已取消索引',
        type: 'project',
        isIndex: false,
        indexed: false,
        bytes: 10,
        updatedAt: 1,
        readable: true,
      },
    ];

    const collapsed = renderToStaticMarkup(
      <GlobalList entries={entries} selected="" onSelect={() => {}} />,
    );
    expect(collapsed).toContain('有效记忆');
    expect(collapsed).toContain('回复偏好');
    expect(collapsed).toContain('未索引文件');
    expect(collapsed).not.toContain('旧任务状态');

    const searching = renderToStaticMarkup(
      <GlobalList entries={entries} selected="" queryActive onSelect={() => {}} />,
    );
    expect(searching).toContain('旧任务状态');
    expect(searching).toContain('未索引');
  });

  test('does not select or enable memory entries that exceed the display limit', () => {
    const catalog = {
      generatedAt: 1,
      global: {
        rootLabel: 'Moss Server / memory',
        files: [{
          id: 'remote:large.md',
          path: 'large.md',
          source: 'remote' as const,
          title: 'Large memory',
          description: '',
          type: 'memory',
          isIndex: false,
          indexed: true,
          bytes: 600_000,
          updatedAt: 1,
          readable: false,
        }],
      },
      projects: [{
        id: 'project-1',
        name: 'Project',
        updatedAt: 1,
        version: 1,
        memoryUpdatedAt: null,
        finalizedSessionCount: 1,
        hasOverview: false,
        history: [{
          id: 'project-session',
          sessionId: 'project-session',
          title: 'Large project memory',
          conclusion: '',
          bytes: 600_000,
          updatedAt: 1,
          readable: false,
        }],
      }],
      sessions: [{
        id: 'remote-session',
        title: 'Large session memory',
        projectId: null,
        projectName: null,
        agentMode: 'remote-direct' as const,
        busy: false,
        createdAt: 1,
        updatedAt: 1,
        hasSummary: true,
        summaryUpdatedAt: 1,
        bytes: 600_000,
        readable: false,
      }],
    };

    expect(defaultSelection(catalog, 'global')).toBeNull();
    expect(defaultSelection(catalog, 'project')).toBeNull();
    expect(defaultSelection(catalog, 'session')).toBeNull();
    const html = renderToStaticMarkup(
      <SessionList sessions={catalog.sessions} selected="" onSelect={() => {}} />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('超过大小限制');
  });
});
