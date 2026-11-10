export const DEFAULT_DECLARED_CONTEXT_WINDOW: 200000;
export const DECLARED_CONTEXT_WINDOW_CHOICES: readonly [200000, 500000, 800000, 1000000];
export function normalizeDeclaredContextWindow(size: unknown): number;
