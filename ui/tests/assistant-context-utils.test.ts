import { describe, expect, it } from 'bun:test';
import { resolveInstalledSkillInfos } from '../src/assistant-context-utils.mjs';

describe('assistant context skill resolution', () => {
  it('resolves canonical marketplace ids to installed skill commands', () => {
    expect(resolveInstalledSkillInfos(['@team/research'], [{
      id: '@team/research',
      slug: 'research',
      name: 'research',
      displayName: '调研',
      namespace: { handle: 'team', canonicalName: '@team/research' },
      enabled: true,
      source: '/skills/research',
    }])).toEqual([{
      id: '@team/research',
      name: 'research',
      path: '/skills/research',
    }]);
  });

  it('does not expose disabled installed skills to a project', () => {
    expect(resolveInstalledSkillInfos(['research'], [{
      id: 'research',
      name: 'research',
      enabled: false,
      source: '/skills/research',
    }])).toEqual([]);
  });
});
