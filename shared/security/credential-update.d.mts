export function attachCredentialBaseSnapshot<T extends Record<string, unknown>>(data: T): T;
export function mergeCredentialUpdate<T extends Record<string, unknown>>(
  proposed: T,
  current: T | null | undefined,
): T;
