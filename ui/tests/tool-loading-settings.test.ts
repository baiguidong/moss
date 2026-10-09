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
    expect(names).toHaveLength(20);
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

  it('keeps core browser and computer tools resident and defaults the others to deferred', () => {
    const always = Object.entries(DEFAULT_MOSS_TOOL_LOADING)
      .filter(([, mode]) => mode === 'always')
      .map(([name]) => name);
    expect(always).toEqual([
      'browser_open',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'computer_use',
    ]);
    expect(Object.entries(DEFAULT_MOSS_TOOL_LOADING).filter(([, mode]) => mode === 'deferred'))
      .toHaveLength(15);
  });

  it('uses defaults for missing or invalid entries and ignores unknown tools', () => {
    expect(normalizeMossToolLoading({
      browser_open: 'deferred',
      app_build: 'always',
      image_generate: 'invalid',
      unknown_tool: 'always',
    })).toMatchObject({
      browser_open: 'deferred',
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
});
