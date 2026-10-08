import { describe, expect, it } from 'bun:test';
import {
  parseSkillCoordinate,
  syncProjectMarketplaceResources,
} from '../src/renderer-react/lib/project-resource-sync';

describe('project resource synchronization', () => {
  it('parses namespaced and plain skill ids', () => {
    expect(parseSkillCoordinate('@team/research')).toEqual({ slug: 'research', namespace: 'team' });
    expect(parseSkillCoordinate('meeting-notes')).toEqual({ slug: 'meeting-notes', namespace: '' });
  });

  it('installs only selected skills and experts missing locally', async () => {
    const calls: Array<{ method: string; payload?: unknown }> = [];
    const api = {
      skillHub: {
        getInstalled: async () => ({ success: true, data: [{ id: '@team/existing', slug: 'existing', namespace: { handle: 'team' } }] }),
        fetchDetail: async (payload: unknown) => {
          calls.push({ method: 'skillHub.fetchDetail', payload });
          return { success: true, data: { skill: { id: '@team/new-skill', slug: 'new-skill', namespace: { handle: 'team' } } } };
        },
        install: async (payload: unknown) => { calls.push({ method: 'skillHub.install', payload }); return { success: true }; },
      },
      expertHub: {
        getInstalled: async () => ({ success: true, data: [{ id: 'installed-expert' }] }),
        install: async (payload: unknown) => { calls.push({ method: 'expertHub.install', payload }); return { success: true }; },
      },
    };

    await syncProjectMarketplaceResources({
      skillIds: ['@team/existing', '@team/new-skill'],
      expertIds: ['installed-expert', 'new-expert'],
    }, api);

    expect(calls.filter((call) => call.method === 'skillHub.fetchDetail')).toEqual([
      { method: 'skillHub.fetchDetail', payload: { slug: 'new-skill', namespace: 'team' } },
    ]);
    expect(calls.filter((call) => call.method === 'skillHub.install')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'expertHub.install')).toEqual([
      { method: 'expertHub.install', payload: { expertId: 'new-expert' } },
    ]);
  });

  it('surfaces installation failures to stop project creation', async () => {
    let expertInstalls = 0;
    const api = {
      skillHub: {
        getInstalled: async () => ({ success: true, data: [] }),
        fetchDetail: async () => ({ success: true, data: { skill: { id: 'missing-skill', slug: 'missing-skill' } } }),
        install: async () => ({ success: false, error: 'download unavailable' }),
      },
      expertHub: {
        getInstalled: async () => ({ success: true, data: [] }),
        install: async () => { expertInstalls++; return { success: true }; },
      },
    };

    await expect(syncProjectMarketplaceResources({
      skillIds: ['missing-skill'],
      expertIds: ['must-not-install'],
    }, api)).rejects.toThrow('技能“missing-skill”安装失败：download unavailable');
    expect(expertInstalls).toBe(0);
  });
});
