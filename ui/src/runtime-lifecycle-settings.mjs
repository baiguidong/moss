export const DEFAULT_RUNTIME_LIFECYCLE = Object.freeze({
  sessionIdleMinutes: 60,
  maxSessionRuntimes: 15,
  mcpIdleMinutes: 60,
});

export function normalizeRuntimeLifecycle(value, previous = DEFAULT_RUNTIME_LIFECYCLE) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(DEFAULT_RUNTIME_LIFECYCLE).map(([key, fallback]) => {
    const maximum = key === 'maxSessionRuntimes' ? 100 : 1440;
    const valid = candidate => Number.isInteger(candidate) && candidate >= 1 && candidate <= maximum;
    return [key, valid(source[key]) ? source[key] : valid(previous?.[key]) ? previous[key] : fallback];
  }));
}
