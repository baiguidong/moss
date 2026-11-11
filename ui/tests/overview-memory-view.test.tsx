import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { OverviewTabs } from '../src/renderer-react/components/overview-view';
import {
  defaultSelection,
  GlobalList,
  MemoryOverview,
} from '../src/renderer-react/components/memory-overview';
import type { MemoryCatalog, MemoryGlobalEntry } from '../src/renderer-react/types';

describe('overview memory navigation', () => {
  test('keeps usage, resource monitoring, global and project memories without session summaries', () => {
    const html = renderToStaticMarkup(
      <OverviewTabs activeTab="project" onChange={() => {}} />,
    );

    expect(html).toContain('aria-label="概览内容"');
    expect(html).toContain('>使用概览<');
    expect(html).toContain('>全局记忆<');
    expect(html).toContain('>项目记忆<');
    expect(html).not.toContain('会话摘要');
    expect(html).toContain('>资源监控<');
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

  test('only shows local files and pins the local index ahead of memories', () => {
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

    const html = renderToStaticMarkup(
      <GlobalList entries={entries} selected="global:local:MEMORY.md" onSelect={() => {}} />,
    );
    expect(html).toContain('本地回复偏好');
    expect(html).not.toContain('云端回复偏好');
    expect(html.match(/>MEMORY.md</g)).toHaveLength(1);
    expect(html.indexOf('>MEMORY.md<')).toBeLessThan(html.indexOf('本地回复偏好'));
    expect(defaultSelection(catalog, 'global')).toEqual({ scope: 'global', path: 'MEMORY.md', source: 'local' });

    const overview = renderToStaticMarkup(<MemoryOverview scope="global" />);
    expect(overview).toContain('搜索本地全局记忆');
    expect(overview).not.toContain('云端全局记忆');
    expect(overview).not.toContain('全局记忆来源');
    expect(overview).not.toContain('role="tab"');
  });

  test('does not fall back to cloud files when local memory is empty', () => {
    const entries: MemoryGlobalEntry[] = [{
      id: 'remote:MEMORY.md', path: 'MEMORY.md', source: 'remote', title: '记忆索引', description: '', type: 'index',
      isIndex: true, indexed: true, readable: true, bytes: 10, updatedAt: 1,
    }];
    const catalog: MemoryCatalog = {
      generatedAt: 1, global: { rootLabel: '/local/memory', files: entries }, projects: [], sessions: [],
    };
    expect(defaultSelection(catalog, 'global')).toBeNull();
    const html = renderToStaticMarkup(<GlobalList entries={entries} selected="" onSelect={() => {}} />);
    expect(html).toContain('暂无本地全局记忆');
    expect(html).not.toContain('MEMORY.md');
  });

  test('does not select or enable memory entries that exceed the display limit', () => {
    const catalog = {
      generatedAt: 1,
      global: {
        rootLabel: '/local/memory',
        files: [{
          id: 'large.md',
          path: 'large.md',
          source: 'local' as const,
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
  });
});
