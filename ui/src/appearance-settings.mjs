export const DEFAULT_APPEARANCE = Object.freeze({
  themeMode: 'light',
  cssThemeId: 'grid-theme',
  autoCollapseToolCalls: false,
});

const THEME_MODES = new Set(['light', 'dark', 'system']);
const CSS_THEME_IDS = new Set(['default', 'grid-theme', 'dot-theme', 'gradient-theme']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeAppearance(input, existing = DEFAULT_APPEARANCE) {
  const source = asObject(input);
  const fallback = asObject(existing);

  return {
    themeMode: THEME_MODES.has(source.themeMode)
      ? source.themeMode
      : THEME_MODES.has(fallback.themeMode)
        ? fallback.themeMode
        : DEFAULT_APPEARANCE.themeMode,
    cssThemeId: CSS_THEME_IDS.has(source.cssThemeId)
      ? source.cssThemeId
      : CSS_THEME_IDS.has(fallback.cssThemeId)
        ? fallback.cssThemeId
        : DEFAULT_APPEARANCE.cssThemeId,
    autoCollapseToolCalls: typeof source.autoCollapseToolCalls === 'boolean'
      ? source.autoCollapseToolCalls
      : typeof fallback.autoCollapseToolCalls === 'boolean'
        ? fallback.autoCollapseToolCalls
        : DEFAULT_APPEARANCE.autoCollapseToolCalls,
  };
}

export function hasPersistedAppearance(settings) {
  return Boolean(
    settings?.appearance && typeof settings.appearance === 'object' && !Array.isArray(settings.appearance),
  );
}
