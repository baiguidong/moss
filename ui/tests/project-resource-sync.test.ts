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
    const calls: Array<{ channel: string; payload?: unknown }> = [];
    const ipcInvoke = async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload });
      if (channel === 'public-skillhub:get-installed-skills') {
        return { success: true, data: [{ id: '@team/existing', slug: 'existing', namespace: { handle: 'team' } }] };
      }
      if (channel === 'public-experthub:get-installed-experts') {
        return { success: true, data: [{ id: 'installed-expert' }] };
      }
      if (channel === 'public-skillhub:fetch-detail') {
        return {
          success: true,
          data: {
            skill: {
              id: '@team/new-skill',
              slug: 'new-skill',
              name: 'new-skill',
              namespace: { handle: 'team' },
            },
          },
        };
      }
      return { success: true };
    };

    await syncProjectMarketplaceResources({
      skillIds: ['@team/existing', '@team/new-skill'],
      expertIds: ['installed-expert', 'new-expert'],
    }, ipcInvoke);

    expect(calls.filter((call) => call.channel === 'public-skillhub:fetch-detail')).toEqual([
      { channel: 'public-skillhub:fetch-detail', payload: { slug: 'new-skill', namespace: 'team' } },
    ]);
    expect(calls.filter((call) => call.channel === 'public-skillhub:install-skill')).toHaveLength(1);
    expect(calls.filter((call) => call.channel === 'public-experthub:install-expert')).toEqual([
      { channel: 'public-experthub:install-expert', payload: { expertId: 'new-expert' } },
    ]);
  });

  it('surfaces installation failures to stop project creation', async () => {
    const ipcInvoke = async (channel: string) => {
      if (channel === 'public-skillhub:get-installed-skills') return { success: true, data: [] };
      if (channel === 'public-experthub:get-installed-experts') return { success: true, data: [] };
      if (channel === 'public-skillhub:fetch-detail') {
        return { success: true, data: { skill: { id: 'missing-skill', slug: 'missing-skill' } } };
      }
      if (channel === 'public-skillhub:install-skill') {
        return { success: false, error: 'download unavailable' };
      }
      return { success: true };
    };

    await expect(syncProjectMarketplaceResources({
      skillIds: ['missing-skill'],
      expertIds: [],
    }, ipcInvoke)).rejects.toThrow('技能“missing-skill”安装失败：download unavailable');
  });
});
