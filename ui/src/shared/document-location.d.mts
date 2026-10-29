export type DocumentLocation = { page?: number; text?: string; occurrence?: number; sheet?: string; range?: string };
export function splitDocumentReference(value: string): { reference: string; location?: DocumentLocation };
export function parseCellRange(value: string): { start: { row: number; col: number }; end: { row: number; col: number } } | null;
export function compactDocumentText(value: string): string;
