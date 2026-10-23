import { describe, expect, test } from 'bun:test';
import { APP_CATEGORIES, getAppCategory, filterApps, groupApps } from '../src/renderer-react/lib/app-categories';
import { filterToolApps } from '../src/renderer-react/lib/app-tool-selection';
import { getSidebarMoreApps } from '../src/renderer-react/components/app-sidebar';
import type { StoredApp } from '../src/renderer-react/types';

describe('App discovery categories', () => {
  const apps = [
    { id: 'browser', displayName: '网页操控', category: 'automation', keywords: ['Chrome', 'Playwright'] },
    { id: 'legacy', displayName: '旧应用' },
    { id: 'future', displayName: '新应用', category: 'future-category' },
    { id: 'files', displayName: '文件系统', category: 'knowledge' },
    { id: 'library', displayName: '知识库', category: 'knowledge', featured: true },
    { id: 'chat', displayName: '即时消息', category: 'communication' },
  ];

  test('groups once per App in taxonomy order, keeps recommendations within their category and does not mutate input', () => {
    const original = structuredClone(apps);
    const groups = groupApps(apps);
    expect(groups.map(group => group.id)).toEqual(['communication', 'knowledge', 'automation', 'other']);
    expect(groups.find(group => group.id === 'knowledge')!.apps.map(app => app.id)).toEqual(['library', 'files']);
    expect(groups.flatMap(group => group.apps)).toHaveLength(apps.length);
    expect(new Set(groups.flatMap(group => group.apps.map(app => app.id))).size).toBe(apps.length);
    expect(apps).toEqual(original);
    expect(groupApps([])).toEqual([]);
    expect(getAppCategory(undefined).id).toBe('other');
    expect(getAppCategory('future').id).toBe('other');
    expect(APP_CATEGORIES.at(-1)!.label).toBe('其他');
  });

  test('searches names, category labels and keywords together with category filtering', () => {
    expect(filterApps(apps, '  CHROME 自动化 ', 'automation').map(app => app.id)).toEqual(['browser']);
    expect(filterApps(apps, 'CHROME', 'knowledge')).toEqual([]);
    expect(filterApps(apps, '文档与知识').map(app => app.id)).toEqual(['files', 'library']);
    expect(filterApps(apps, '', 'other').map(app => app.id)).toEqual(['legacy', 'future']);
    expect(filterApps(apps, '不存在')).toEqual([]);
  });

  test('old installed business tools use the new display categories without losing custom categories', () => {
    const legacy = [
      { id: 'moss.tencent-map', category: 'other' },
      { id: 'moss.sharecrm', category: 'other' },
      { id: 'moss.filesystem', category: 'knowledge' },
      { id: 'external.custom', category: 'other' },
    ];
    expect(groupApps(legacy).map(group => group.id)).toEqual(['files', 'sales', 'life', 'other']);
    expect(filterApps(legacy, '', 'life').map(app => app.id)).toEqual(['moss.tencent-map']);
    expect(filterApps(legacy, '销售').map(app => app.id)).toEqual(['moss.sharecrm']);
    expect(legacy[0].category).toBe('other');
  });

  test('keeps tool selection keyboard order aligned with grouping and preserves selected disabled Apps', () => {
    const tools = apps.map(app => ({ ...app, name: app.id, enabled: true, hasUi: true,
      agentTools: [{ id: 'search', title: '搜索', effect: 'read' }],
    })) as StoredApp[];
    tools[1].agentTools = [];
    tools[1].enabled = false;
    tools[2].hasUi = false;
    expect(filterToolApps(tools, '').map(app => app.id)).not.toContain('legacy');
    expect(filterToolApps(tools, '', ['legacy']).map(app => app.id))
      .toEqual(groupApps(tools).flatMap(group => group.apps.map(app => app.id)));
    expect(filterToolApps(tools, 'Playwright', [], 'automation').map(app => app.id)).toEqual(['browser']);
    const more = groupApps(getSidebarMoreApps(tools));
    expect(more.map(group => group.id)).toEqual(['communication', 'knowledge', 'automation']);
    expect(more.flatMap(group => group.apps.map(app => app.id))).not.toContain('future');
  });
});
