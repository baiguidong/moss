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
      includeSkills: true,
      includeConnectors: true,
    })).toEqual(['assistants', 'skills', 'connectors']);

    expect(getComposerResourceTabs({
      includeAssistants: false,
      includeSkills: true,
      includeConnectors: true,
    })).toEqual(['skills', 'connectors']);

    expect(getComposerResourceTabs({
      includeAssistants: false,
      includeSkills: false,
      includeConnectors: false,
    })).toEqual([]);
  });

  it('includes experts only when the composer can choose the session expert', () => {
    expect(getComposerMentionTabs({
      includeFiles: false,
      includeSkills: true,
      includeAssistants: true,
      includeConnectors: true,
    })).toEqual(['skills', 'assistants', 'connectors']);

    expect(getComposerMentionTabs({
      includeFiles: true,
      includeSkills: true,
      includeAssistants: false,
      includeConnectors: true,
    })).toEqual(['files', 'skills', 'connectors']);

    expect(getComposerMentionTabs({
      includeFiles: true,
      includeSkills: false,
      includeAssistants: false,
      includeConnectors: false,
    })).toEqual(['files']);
  });

  it('cycles through every available tab and wraps to the first tab', () => {
    const tabs = getComposerMentionTabs({
      includeFiles: true,
      includeSkills: true,
      includeAssistants: true,
      includeConnectors: true,
    });

    expect(getNextComposerMentionTab(tabs, 'files')).toBe('skills');
    expect(getNextComposerMentionTab(tabs, 'skills')).toBe('assistants');
    expect(getNextComposerMentionTab(tabs, 'assistants')).toBe('connectors');
    expect(getNextComposerMentionTab(tabs, 'connectors')).toBe('files');
    expect(getPreviousComposerMentionTab(tabs, 'files')).toBe('connectors');
    expect(getPreviousComposerMentionTab(tabs, 'connectors')).toBe('assistants');
  });

  it('describes only the resources available in each composer', () => {
    expect(getDefaultComposerPlaceholder({
      hasActiveSession: false,
      includeSkills: true,
      includeAssistants: true,
      includeConnectors: true,
    })).toBe('输入任务、问题或想法，使用 @ 添加技能、专家或连接器');

    expect(getDefaultComposerPlaceholder({
      hasActiveSession: true,
      includeSkills: true,
      includeAssistants: false,
      includeConnectors: true,
    })).toBe('继续输入，使用 @ 引用文件或添加技能、连接器');

    expect(getDefaultComposerPlaceholder({
      hasActiveSession: true,
      includeSkills: false,
      includeAssistants: false,
      includeConnectors: false,
    })).toBe('继续输入，使用 @ 引用文件');
  });
});
