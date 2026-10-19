export type PresentationItem = { path?: string; resource_uri?: string; artifact_id?: string; title?: string; role?: 'primary' | 'supporting'; view?: 'auto' | 'source' | 'rendered' };
export type PresentationInput = { items: PresentationItem[]; title?: string; mode?: 'auto' | 'background' };
export const PRESENTATION_INPUT_SCHEMA: Record<string, unknown>;
export function validatePresentationInput(input: unknown): PresentationInput;
export type PresentationState = { visible: boolean; activeId: string; activeOrigin: string; autoFollow: boolean; pinnedId: string | null; userIntentVersion: number; manualHold: boolean; turnId: string | null; seq: number; back: string[]; openedIds: string[]; dirty: boolean };
export function initialPresentationState(): PresentationState;
export function transitionPresentation(state: PresentationState, event: Record<string, unknown>): PresentationState;
export const MOSS_PRESENTATION_PROMPT: string;
