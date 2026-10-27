import type { ComposerResourceRef, DesktopAgentDefinition } from '../types';
import type { InstalledSkillOption } from '../components/skill-selection-area';
import type { AppComposerResource } from './app-composer';
import type { ComposerIntent } from './composer-intent';

export type ComposerAttachment = { name: string; path: string; resource?: ComposerResourceRef };
export type ComposerChoices = { skills: InstalledSkillOption[]; agent: DesktopAgentDefinition | null };
export type QueuedMessage = {
  id: string;
  prompt: string;
  intent: ComposerIntent;
  files?: ComposerAttachment[];
  skills?: InstalledSkillOption[];
  agentType?: string;
  agent?: DesktopAgentDefinition | null;
  appSelection?: AppComposerResource | null;
  workspace?: string;
  status?: 'queued' | 'dispatching' | 'draft';
  notice?: string;
};
export type ComposerDraft = {
  text: string;
  files: ComposerAttachment[];
  appSelection?: AppComposerResource | null;
  choices?: ComposerChoices;
  intent?: ComposerIntent;
  workspace?: string;
  queued?: QueuedMessage[];
};

export function composerIsEmpty(draft: ComposerDraft) {
  return !draft.text.trim() && !draft.files.length && !draft.appSelection &&
    !draft.choices?.skills.length && !draft.choices?.agent;
}

/** Only entries still owned by the UI queue can be withdrawn. */
export function withdrawMessage(queue: QueuedMessage[], id: string, draft: ComposerDraft, workspace?: string) {
  const item = queue.find(value => value.id === id);
  if (!item || item.status === 'dispatching') return { queue, draft, restored: false };
  const mismatch = item.workspace !== undefined && item.workspace !== workspace;
  if (mismatch || !composerIsEmpty(draft)) {
    return {
      queue: queue.map(value => value.id === id ? { ...value, status: 'draft' as const,
        notice: mismatch ? '工作区已变化，请切回原工作区后编辑。' : '当前输入已有内容，草稿已保留。' } : value),
      draft, restored: false,
    };
  }
  return {
    queue: queue.filter(value => value.id !== id),
    draft: { text: item.prompt, files: item.files ?? [], appSelection: item.appSelection,
      choices: { skills: item.skills ?? [], agent: item.agent ?? null }, intent: item.intent, workspace: item.workspace },
    restored: true,
  };
}

export function preserveQueuedMessages(queue: QueuedMessage[]) {
  return queue.map(item => item.status === 'dispatching' ? item :
    { ...item, status: 'draft' as const, notice: '已停止排队，内容已保留。' });
}

/** Stop interrupts the current turn while keeping queued messages live. */
export function requeueMessagesAfterStop(queue: QueuedMessage[]) {
  return queue.map(item => item.status === 'dispatching'
    ? { ...item, status: 'queued' as const, notice: undefined }
    : item);
}

/** Restored browser/desktop drafts never resume sending automatically. */
export function recoverQueuedMessages(queue: QueuedMessage[] = []) {
  return queue.map(item => ({ ...item, status: 'draft' as const,
    notice: item.status === 'dispatching' ? '发送状态未确认，请先核对会话记录。' : item.notice || '已恢复草稿，附件将在发送时重新校验。' }));
}

export function messageFromDraft(draft: ComposerDraft, id: string): QueuedMessage {
  return { id, prompt: draft.text, files: draft.files, skills: draft.choices?.skills, agent: draft.choices?.agent,
    agentType: draft.choices?.agent?.agentType, intent: draft.intent ?? 'chat', appSelection: draft.appSelection,
    workspace: draft.workspace, status: 'draft' };
}

export function mergeRecoveredDraft(current: ComposerDraft, incoming: ComposerDraft, id: string): ComposerDraft {
  const queued = [...(current.queued ?? []), ...recoverQueuedMessages(incoming.queued)];
  if (composerIsEmpty(current)) return { ...incoming, queued };
  if (!composerIsEmpty(incoming)) queued.push(messageFromDraft(incoming, id));
  return { ...current, queued };
}
