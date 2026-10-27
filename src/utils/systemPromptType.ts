/**
 * Branded type for system prompt arrays.
 *
 * This module is intentionally dependency-free so it can be imported
 * from anywhere without risking circular initialization issues.
 */

export type SystemPrompt = readonly string[] & {
  readonly __brand: 'SystemPrompt'
}

export function asSystemPrompt(value: readonly string[]): SystemPrompt {
  return value as SystemPrompt
}

/** Main-session instructions are kept as a separate block at composition time. */
export function stripMainSessionSystemPrompt(
  prompt: SystemPrompt,
  mainSessionSystemPrompt: string | undefined,
): SystemPrompt {
  return mainSessionSystemPrompt
    ? asSystemPrompt(prompt.filter(part => part !== mainSessionSystemPrompt))
    : prompt
}
