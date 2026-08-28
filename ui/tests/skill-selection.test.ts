import { describe, expect, it } from 'bun:test';
import { getSelectableInstalledSkills } from '../src/renderer-react/components/skill-selection-area';

describe('skill selection', () => {
  it('shows only enabled installed skills in display-name order', () => {
    expect(getSelectableInstalledSkills([
      { name: 'z-skill', displayName: 'Zeta' },
      { name: 'disabled', displayName: 'Alpha', enabled: false },
      { name: 'a-skill', displayName: 'Beta', enabled: true },
    ]).map((skill) => skill.name)).toEqual(['a-skill', 'z-skill']);
  });
});
