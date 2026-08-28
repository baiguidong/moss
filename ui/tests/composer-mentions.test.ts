import { describe, expect, it } from 'bun:test';
import {
  getComposerMentionTabs,
  getDefaultComposerPlaceholder,
  getNextComposerMentionTab,
} from '../src/renderer-react/lib/composer-mentions';

describe('composer mention tabs', () => {
  it('includes experts only when the composer can choose the session expert', () => {
    expect(getComposerMentionTabs({
      includeSkills: true,
      includeAssistants: true,
      includeConnectors: true,
    })).toEqual(['files', 'skills', 'assistants', 'connectors']);

    expect(getComposerMentionTabs({
      includeSkills: true,
      includeAssistants: false,
      includeConnectors: true,
    })).toEqual(['files', 'skills', 'connectors']);

    expect(getComposerMentionTabs({
      includeSkills: false,
      includeAssistants: false,
      includeConnectors: false,
    })).toEqual(['files']);
  });

  it('cycles through every available tab and wraps to the first tab', () => {
    const tabs = getComposerMentionTabs({
      includeSkills: true,
      includeAssistants: true,
      includeConnectors: true,
    });

    expect(getNextComposerMentionTab(tabs, 'files')).toBe('skills');
    expect(getNextComposerMentionTab(tabs, 'skills')).toBe('assistants');
    expect(getNextComposerMentionTab(tabs, 'assistants')).toBe('connectors');
    expect(getNextComposerMentionTab(tabs, 'connectors')).toBe('files');
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
