import { describe, expect, it } from 'bun:test';
import {
  getSelectableInstalledAssistants,
  type InstalledAssistant,
} from '../src/renderer-react/components/assistant-selection-area';

function assistant(
  name: string,
  displayName: string,
  source: string,
  enabled = true,
): InstalledAssistant {
  return {
    name,
    displayName,
    description: '',
    avatar: '',
    emoji: '',
    category: '',
    categories: [],
    version: '',
    source,
    isBuiltin: false,
    isHubInstalled: false,
    tag: '',
    enabled,
    skills: [],
    enabledSkills: [],
  };
}

describe('assistant selection', () => {
  it('shows one entry for duplicate logical assistants and keeps the first source', () => {
    const selected = getSelectableInstalledAssistants([
      assistant('app-builder-assistant', 'App 构建助手', '/assistants/app-builder'),
      assistant('job-search', '求职冲刺', '/assistants/job-search'),
      assistant('app-builder-assistant', 'App 构建助手', '/assistants/system/app-builder'),
    ]);

    expect(selected.map((item) => item.name)).toEqual([
      'job-search',
      'app-builder-assistant',
    ]);
    expect(selected.find((item) => item.name === 'app-builder-assistant')?.source)
      .toBe('/assistants/app-builder');
  });

  it('excludes disabled assistants', () => {
    expect(getSelectableInstalledAssistants([
      assistant('enabled', '启用', '/assistants/enabled'),
      assistant('disabled', '禁用', '/assistants/disabled', false),
    ]).map((item) => item.name)).toEqual(['enabled']);
  });
});
