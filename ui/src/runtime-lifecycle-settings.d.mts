export type RuntimeLifecycleSettings = { sessionIdleMinutes: number; maxSessionRuntimes: number; mcpIdleMinutes: number };
export const DEFAULT_RUNTIME_LIFECYCLE: Readonly<RuntimeLifecycleSettings>;
export function normalizeRuntimeLifecycle(value?: unknown, previous?: Partial<RuntimeLifecycleSettings>): RuntimeLifecycleSettings;
