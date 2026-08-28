export type ComposerMentionTab = 'files' | 'skills' | 'assistants' | 'connectors';
export type ComposerResourceTab = Exclude<ComposerMentionTab, 'files'>;

export function getComposerResourceTabs({
  includeAssistants,
  includeSkills,
  includeConnectors,
}: {
  includeAssistants: boolean;
  includeSkills: boolean;
  includeConnectors: boolean;
}): ComposerResourceTab[] {
  const tabs: ComposerResourceTab[] = [];
  if (includeAssistants) tabs.push('assistants');
  if (includeSkills) tabs.push('skills');
  if (includeConnectors) tabs.push('connectors');
  return tabs;
}

export function getComposerMentionTabs({
  includeFiles,
  includeSkills,
  includeAssistants,
  includeConnectors,
}: {
  includeFiles: boolean;
  includeSkills: boolean;
  includeAssistants: boolean;
  includeConnectors: boolean;
}): ComposerMentionTab[] {
  const tabs: ComposerMentionTab[] = [];
  if (includeFiles) tabs.push('files');
  if (includeSkills) tabs.push('skills');
  if (includeAssistants) tabs.push('assistants');
  if (includeConnectors) tabs.push('connectors');
  return tabs;
}

export function getDefaultComposerPlaceholder({
  hasActiveSession,
  includeSkills,
  includeAssistants,
  includeConnectors,
}: {
  hasActiveSession: boolean;
  includeSkills: boolean;
  includeAssistants: boolean;
  includeConnectors: boolean;
}) {
  const additions = [
    includeSkills ? '技能' : null,
    includeAssistants ? '专家' : null,
    includeConnectors ? '连接器' : null,
  ].filter((label): label is string => Boolean(label));

  if (!hasActiveSession) {
    const additionLabel = additions.length > 1
      ? `${additions.slice(0, -1).join('、')}或${additions.at(-1)}`
      : additions[0];
    return additions.length > 0
      ? `输入任务、问题或想法，使用 @ 添加${additionLabel}`
      : '输入任务、问题或想法';
  }
  return additions.length > 0
    ? `继续输入，使用 @ 引用文件或添加${additions.join('、')}`
    : '继续输入，使用 @ 引用文件';
}

export function getNextComposerMentionTab(
  tabs: ComposerMentionTab[],
  current: ComposerMentionTab,
): ComposerMentionTab {
  if (tabs.length === 0) return 'files';
  const currentIndex = tabs.indexOf(current);
  return tabs[(currentIndex + 1 + tabs.length) % tabs.length];
}

export function getPreviousComposerMentionTab(
  tabs: ComposerMentionTab[],
  current: ComposerMentionTab,
): ComposerMentionTab {
  if (tabs.length === 0) return 'files';
  const currentIndex = tabs.indexOf(current);
  const normalizedIndex = currentIndex < 0 ? 0 : currentIndex;
  return tabs[(normalizedIndex - 1 + tabs.length) % tabs.length];
}
