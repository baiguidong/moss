export const DEFAULT_DECLARED_CONTEXT_WINDOW = 200_000;
export const DECLARED_CONTEXT_WINDOW_CHOICES = Object.freeze([
  200_000,
  500_000,
  800_000,
  1_000_000,
]);

export function normalizeDeclaredContextWindow(size) {
  const parsed = typeof size === 'number' ? size : Number(size);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_DECLARED_CONTEXT_WINDOW;
  return DECLARED_CONTEXT_WINDOW_CHOICES.filter(choice => choice <= parsed).at(-1)
    ?? DEFAULT_DECLARED_CONTEXT_WINDOW;
}
