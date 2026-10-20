import type { ComposerAttachment } from './composer-queue';
import type { AgentEvent } from '../types';

export type PendingFirstMessage = {
  id: string;
  sessionId: string;
  prompt: string;
  files: ComposerAttachment[];
  submittedAt: number;
};

export function firstMessageTitle(prompt: string): string | undefined {
  const line = prompt.split('\n').map(part => part.trim()).find(Boolean);
  if (!line) return undefined;
  return line.length > 36 ? `${line.slice(0, 36)}...` : line;
}

export function historyWithPendingFirstMessage(
  history: AgentEvent[],
  pending: PendingFirstMessage | null,
  sessionId: string | null,
): AgentEvent[] {
  if (!pending || pending.sessionId !== sessionId) return history;
  // The Host receipt becomes authoritative as soon as it arrives. In
  // particular, never show both copies while send() is still running.
  if (history.some(event => event?.type === 'user' && !event.isMeta && !event.isSynthetic)) return history;
  return [...history, {
    type: 'user',
    uuid: pending.id,
    prompt: pending.prompt,
    timestamp: pending.submittedAt,
    files: pending.files.filter(file => !file.resource).map(file => file.path),
    resources: pending.files.flatMap(file => file.resource ? [file.resource] : []),
  }];
}
