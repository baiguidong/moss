import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { OverviewTabs } from '../src/renderer-react/components/overview-view';
import {
  defaultSelection,
  GlobalList,
  GlobalMemorySourceTabs,
  SessionList,
} from '../src/renderer-react/components/memory-overview';
import type { MemoryCatalog, MemoryGlobalEntry } from '../src/renderer-react/types';

describe('overview memory navigation', () => {
  test('keeps usage and all three memory scopes in one top tab bar when session summaries are enabled', () => {
    const html = renderToStaticMarkup(
      <OverviewTabs activeTab="project" sessionSummaryEnabled onChange={() => {}} />,
    );

    expect(html).toContain('aria-label="概览内容"');
    expect(html).toContain('>使用概览<');
    expect(html).toContain('>全局记忆<');
    expect(html).toContain('>项目记忆<');
    expect(html).toContain('>会话摘要<');
    expect(html).toContain('>资源监控<');
    expect(html.match(/role="tab"/g)).toHaveLength(5);
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
      <GlobalList entries={entries} source="local" selected="" onSelect={() => {}} />,
    );
    expect(collapsed).toContain('有效记忆');
    expect(collapsed).toContain('回复偏好');
    expect(collapsed).toContain('未索引文件');
    expect(collapsed).not.toContain('旧任务状态');

    const searching = renderToStaticMarkup(
      <GlobalList entries={entries} source="local" selected="" queryActive onSelect={() => {}} />,
    );
    expect(searching).toContain('旧任务状态');
    expect(searching).toContain('未索引');
  });

  test('separates cloud and local files and pins each source index ahead of memories', () => {
    const file = (path: string, source: 'local' | 'remote', title: string): MemoryGlobalEntry => ({
      id: `${source}:${path}`, path, source, title, description: '',
      type: path === 'MEMORY.md' ? 'index' : 'memory',
      isIndex: path === 'MEMORY.md', indexed: true, bytes: 10, updatedAt: 1, readable: true,
    });
    const entries = [
      file('preference.md', 'local', '本地回复偏好'),
      file('MEMORY.md', 'local', '记忆索引'),
      file('preference.md', 'remote', '云端回复偏好'),
      file('MEMORY.md', 'remote', '记忆索引'),
    ];
    const catalog: MemoryCatalog = {
      generatedAt: 1, global: { rootLabel: '/local/memory', files: entries }, projects: [], sessions: [],
    };

    for (const source of ['remote', 'local'] as const) {
      const html = renderToStaticMarkup(
        <GlobalList entries={entries} source={source} selected={`global:${source}:MEMORY.md`} onSelect={() => {}} />,
      );
      const title = source === 'remote' ? '云端回复偏好' : '本地回复偏好';
      expect(html).toContain(title);
      expect(html).not.toContain(source === 'remote' ? '本地回复偏好' : '云端回复偏好');
      expect(html.match(/>MEMORY.md</g)).toHaveLength(1);
      expect(html.indexOf('>MEMORY.md<')).toBeLessThan(html.indexOf(title));
      expect(defaultSelection(catalog, 'global', source)).toEqual({ scope: 'global', path: 'MEMORY.md', source });
    }

    const tabs = renderToStaticMarkup(<GlobalMemorySourceTabs source="remote" onChange={() => {}} />);
    expect(tabs).toContain('全局记忆来源');
    expect(tabs).toContain('云端全局记忆');
    expect(tabs).toContain('本地全局记忆');
    expect(tabs.match(/aria-selected="true"/g)).toHaveLength(1);
  });

  test('does not fall back to local files when cloud memory is empty', () => {
    const entries: MemoryGlobalEntry[] = [{
      id: 'MEMORY.md', path: 'MEMORY.md', title: '记忆索引', description: '', type: 'index',
      isIndex: true, indexed: true, readable: true, bytes: 10, updatedAt: 1,
    }];
    const catalog: MemoryCatalog = {
      generatedAt: 1, global: { rootLabel: '/local/memory', files: entries }, projects: [], sessions: [],
    };
    expect(defaultSelection(catalog, 'global', 'remote')).toBeNull();
    expect(defaultSelection(catalog, 'global', 'local')).toMatchObject({ path: 'MEMORY.md', source: 'local' });
    const html = renderToStaticMarkup(<GlobalList entries={entries} source="remote" selected="" onSelect={() => {}} />);
    expect(html).toContain('暂无云端全局记忆');
    expect(html).not.toContain('MEMORY.md');
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

    expect(defaultSelection(catalog, 'global', 'remote')).toBeNull();
    expect(defaultSelection(catalog, 'project')).toBeNull();
    expect(defaultSelection(catalog, 'session')).toBeNull();
    const html = renderToStaticMarkup(
      <SessionList sessions={catalog.sessions} selected="" onSelect={() => {}} />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('超过大小限制');
  });
});
