import { describe, expect, it } from 'bun:test';
import {
  getComposerMentionTabs,
  getComposerResourceTabs,
  getDefaultComposerPlaceholder,
  getNextComposerMentionTab,
  getPreviousComposerMentionTab,
} from '../src/renderer-react/lib/composer-mentions';

describe('composer mention tabs', () => {
  it('builds the unified resource picker tabs from available controls', () => {
    expect(getComposerResourceTabs({
      includeAssistants: true,
      includeAgents: true,
      includeSkills: true,
    })).toEqual(['assistants', 'agents', 'skills']);

    expect(getComposerResourceTabs({
      includeAssistants: false,
      includeAgents: false,
      includeSkills: true,
    })).toEqual(['skills']);

    expect(getComposerResourceTabs({
      includeAssistants: false,
      includeAgents: false,
      includeSkills: false,
    })).toEqual([]);
  });

  it('includes experts only when the composer can choose the session expert', () => {
    expect(getComposerMentionTabs({
      includeFiles: false,
      includeAgents: true,
      includeSkills: true,
      includeAssistants: true,
    })).toEqual(['agents', 'skills', 'assistants']);

    expect(getComposerMentionTabs({
      includeFiles: true,
      includeAgents: true,
      includeSkills: true,
      includeAssistants: false,
    })).toEqual(['files', 'agents', 'skills']);

    expect(getComposerMentionTabs({
      includeFiles: true,
      includeAgents: false,
      includeSkills: false,
      includeAssistants: false,
    })).toEqual(['files']);
  });

  it('cycles through every available tab and wraps to the first tab', () => {
    const tabs = getComposerMentionTabs({
      includeFiles: true,
      includeAgents: true,
      includeSkills: true,
      includeAssistants: true,
    });

    expect(getNextComposerMentionTab(tabs, 'files')).toBe('agents');
    expect(getNextComposerMentionTab(tabs, 'agents')).toBe('skills');
    expect(getNextComposerMentionTab(tabs, 'skills')).toBe('assistants');
    expect(getNextComposerMentionTab(tabs, 'assistants')).toBe('files');
    expect(getPreviousComposerMentionTab(tabs, 'files')).toBe('assistants');
    expect(getPreviousComposerMentionTab(tabs, 'assistants')).toBe('skills');
  });

  it('describes only the resources available in each composer', () => {
    expect(getDefaultComposerPlaceholder({
      hasActiveSession: false,
      includeAgents: true,
      includeSkills: true,
      includeAssistants: true,
    })).toBe('输入任务、问题或想法，使用 @ 添加Agent、技能或专家');

    expect(getDefaultComposerPlaceholder({
      hasActiveSession: true,
      includeAgents: true,
      includeSkills: true,
      includeAssistants: false,
    })).toBe('继续输入，使用 @ 引用文件或添加Agent、技能');

    expect(getDefaultComposerPlaceholder({
      hasActiveSession: true,
      includeAgents: false,
      includeSkills: false,
      includeAssistants: false,
    })).toBe('继续输入，使用 @ 引用文件');
  });
});
