import type { QueuedMessage } from './composer-queue';
export type InteractionKind = 'steer' | 'side_question';
export type InteractionDetails = Omit<QueuedMessage, 'id' | 'prompt' | 'status' | 'notice'>;
export type SessionInteraction = { type: 'session_interaction'; id: string; kind: InteractionKind; prompt: string; details?: InteractionDetails; status: string; response?: string | null; error?: string; timestamp: number };
export type SendInteraction = (kind: InteractionKind, prompt: string, details?: InteractionDetails) => Promise<void>;

export function latestSessionInteractions(history: unknown[]): SessionInteraction[] {
  const latest = new Map<string, SessionInteraction>();
  for (const item of history) {
    const event = item as SessionInteraction;
    if (event?.type === 'session_interaction' && typeof event.id === 'string') latest.set(event.id, event);
  }
  return [...latest.values()];
}

export function composerDelivery({ loading, value }: { loading: boolean; value: string }) {
  if (/^\/btw(?:\s|$)/i.test(value.trim())) return 'side_question';
  return loading ? 'steer' : 'send';
}
