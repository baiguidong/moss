import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_MOSS_TOOL_LOADING,
  MOSS_TOOL_GROUPS,
  normalizeMossToolLoading,
} from '../src/tool-loading-settings.mjs';
import {
  DEFAULT_MOSS_TOOL_LOADING as RUNTIME_DEFAULT_MOSS_TOOL_LOADING,
  MOSS_TOOL_GROUPS as RUNTIME_MOSS_TOOL_GROUPS,
} from '../../src/tools/MossTool/toolLoading.js';

describe('Moss tool loading settings', () => {
  it('defines every split host tool exactly once', () => {
    const names = MOSS_TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => tool.name));
    expect(names).toHaveLength(13);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(DEFAULT_MOSS_TOOL_LOADING)).toEqual(names);
  });

  it('keeps renderer groups and runtime activation groups in sync', () => {
    expect(MOSS_TOOL_GROUPS.map((group) => ({
      id: group.id,
      tools: group.tools.map((tool) => tool.name),
    }))).toEqual(Object.entries(RUNTIME_MOSS_TOOL_GROUPS).map(([id, tools]) => ({
      id,
      tools: [...tools],
    })));
    expect(DEFAULT_MOSS_TOOL_LOADING).toEqual(RUNTIME_DEFAULT_MOSS_TOOL_LOADING);
  });

  it('keeps moss_browser_open and computer_use resident and defaults the others to deferred', () => {
    const always = Object.entries(DEFAULT_MOSS_TOOL_LOADING)
      .filter(([, mode]) => mode === 'always')
      .map(([name]) => name);
    expect(always).toEqual([
      'moss_browser_open',
      'computer_use',
    ]);
    expect(Object.entries(DEFAULT_MOSS_TOOL_LOADING).filter(([, mode]) => mode === 'deferred'))
      .toHaveLength(11);
  });

  it('uses defaults for missing or invalid entries and ignores unknown tools', () => {
    expect(normalizeMossToolLoading({
      moss_browser_open: 'deferred',
      app_build: 'always',
      image_generate: 'invalid',
      unknown_tool: 'always',
    })).toMatchObject({
      moss_browser_open: 'deferred',
      app_build: 'always',
      image_generate: 'deferred',
    });
    const normalized = normalizeMossToolLoading(
      { WorkflowRun: 'always', WorkflowCreate: 'always', unknown_tool: 'always' },
      { WorkflowEdit: 'always', WorkflowManage: 'always' },
    );
    for (const name of ['unknown_tool', 'WorkflowRun', 'WorkflowCreate', 'WorkflowEdit', 'WorkflowManage']) {
      expect(normalized).not.toHaveProperty(name);
    }
  });

  it('drops removed browser tools from both saved and incoming loading settings', () => {
    const removed = ['browser_snapshot', 'browser_click', 'browser_type', 'browser_press', 'browser_scroll', 'browser_wait', 'browser_reload'];
    const legacy = Object.fromEntries(removed.map((name) => [name, 'always']));
    for (const normalized of [normalizeMossToolLoading(legacy), normalizeMossToolLoading({}, legacy)]) {
      expect(Object.keys(normalized).filter((name) => /^(moss_)?browser_/.test(name)))
        .toEqual(['moss_browser_open']);
    }
  });

  it('migrates browser_open preferences and gives the new tool name precedence', () => {
    for (const normalized of [
      normalizeMossToolLoading({ browser_open: 'deferred' }),
      normalizeMossToolLoading({}, { browser_open: 'deferred' }),
      normalizeMossToolLoading({ browser_open: 'deferred' }, { moss_browser_open: 'always' }),
    ]) {
      expect(normalized.moss_browser_open).toBe('deferred');
      expect(normalized).not.toHaveProperty('browser_open');
    }
    expect(normalizeMossToolLoading({ moss_browser_open: 'always', browser_open: 'deferred' })
      .moss_browser_open).toBe('always');
  });
});
