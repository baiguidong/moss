import { describe, expect, it } from 'bun:test';
import {
  buildProjectCoordinatorSelectedSkillsInstruction,
  buildSelectedSkillsInstruction,
  getSessionConnectorOverrides,
  mergeProjectConnectorIds,
  normalizeSelectedSkills,
  resolveProjectSessionResourceScope,
  scopeProjectResourceManifestForWorker,
} from '../src/shared/project-runtime-resources.mjs';

describe('project runtime resources', () => {
  it('merges project connectors before session-specific connectors', () => {
    expect(mergeProjectConnectorIds(
      ['project-a', 'shared'],
      ['shared', 'session-b'],
    )).toEqual(['project-a', 'shared', 'session-b']);
  });

  it('stores only session connector overrides', () => {
    expect(getSessionConnectorOverrides(
      ['project-a', 'shared'],
      ['project-a', 'shared', 'session-b'],
    )).toEqual(['session-b']);
  });

  it('exposes the full project resource scope to a coordinator root session', () => {
    const project = {
      connectorIds: ['mail', 'meeting'],
      skillIds: ['review', 'slides'],
      expertIds: ['reviewer', 'designer'],
    };
    expect(resolveProjectSessionResourceScope(project)).toEqual({
      connectorIds: ['mail', 'meeting'],
      skillIds: ['review', 'slides'],
      expertIds: ['reviewer', 'designer'],
    });
  });

  it('normalizes and deduplicates explicitly selected skills', () => {
    expect(normalizeSelectedSkills([
      { name: 'research', displayName: '调研' },
      { name: ' research ', displayName: '重复项' },
      { name: '', displayName: '空项' },
    ])).toEqual([{ name: 'research', displayName: '调研' }]);
  });

  it('builds an invocation instruction without exposing skill paths', () => {
    const instruction = buildSelectedSkillsInstruction([
      { name: 'research', displayName: '调研', source: '/private/skill' },
    ]);
    expect(instruction).toContain('invoke each listed skill');
    expect(instruction).toContain('- research (调研)');
    expect(instruction).not.toContain('/private/skill');
  });

  it('routes selected project skills through a coordinator worker', () => {
    const instruction = buildProjectCoordinatorSelectedSkillsInstruction([
      { name: 'research', displayName: '调研' },
    ]);
    expect(instruction).toContain('project coordinator cannot invoke Skill directly');
    expect(instruction).toContain('instructions are preloaded');
    expect(instruction).toContain('- research (调研)');
  });

  it('scopes a worker manifest to its explicit resource assignment', () => {
    const scoped = scopeProjectResourceManifestForWorker({
      projectId: 'project-1',
      connectors: [{ id: 'mail' }, { id: 'meeting' }],
      skills: [{ id: 'review' }, { id: 'slides' }],
      unavailableSkillIds: ['review', 'slides'],
      experts: [{ id: 'reviewer' }, { id: 'designer' }],
      unavailableExpertIds: ['reviewer', 'designer'],
      assets: [{ id: 'asset-1' }],
      memory: { version: 2 },
    }, {
      connectorIds: ['mail'],
      skillIds: ['review'],
      expertId: 'reviewer',
    });
    expect(scoped?.connectors).toEqual([{ id: 'mail' }]);
    expect(scoped?.skills).toEqual([{ id: 'review' }]);
    expect(scoped?.unavailableSkillIds).toEqual(['review']);
    expect(scoped?.experts).toEqual([{ id: 'reviewer' }]);
    expect(scoped?.unavailableExpertIds).toEqual(['reviewer']);
    expect(scoped?.assets).toEqual([{ id: 'asset-1' }]);
    expect(scoped?.memory).toEqual({ version: 2 });
  });
});
