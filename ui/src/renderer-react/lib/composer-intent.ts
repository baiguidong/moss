import type { SessionSummary } from '../types';

export type ComposerIntent = 'chat' | 'boss';

type IntentSummary = Pick<SessionSummary, 'id' | 'composerIntent' | 'projectId'> & Partial<Pick<SessionSummary, 'updatedAt'>>;

export type ComposerIntentState = {
  selected?: ComposerIntent;
  persisted?: { intent: ComposerIntent; updatedAt: number; project: boolean };
};

export function restoreComposerIntent(session?: Partial<IntentSummary> | null): ComposerIntent {
  const intent = session?.composerIntent as string | undefined;
  return intent === 'boss' || intent === 'coordinator' ? 'boss' : 'chat';
}

export function reconcileComposerIntent(
  session: IntentSummary,
  states: Map<string, ComposerIntentState>,
): ComposerIntent {
  const current = states.get(session.id);
  const incoming = {
    intent: restoreComposerIntent(session),
    updatedAt: session.updatedAt ?? 0,
    project: Boolean(session.projectId),
  };
  // Keep the last acknowledged value as well as any pending selection: an
  // older state/history snapshot may arrive after the acknowledgment.
  const persisted = current?.persisted && current.persisted.updatedAt > incoming.updatedAt
    ? current.persisted
    : incoming;
  const selected = current?.selected === persisted.intent
    ? undefined
    : current?.selected;
  states.set(session.id, { persisted, selected });
  // A title, permission or worker update can arrive before the next send
  // persists the user's selection. Keep that local draft until acknowledged.
  return selected ?? persisted.intent;
}
