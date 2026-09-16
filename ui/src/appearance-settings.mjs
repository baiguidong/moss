export const DEFAULT_APPEARANCE = Object.freeze({
  themeMode: 'light',
  cssThemeId: 'grid-theme',
  autoCollapseToolCalls: false,
  chatFontSize: 14,
  chatLineHeight: 1.55,
  chatMessageSpacing: 10,
});

const THEME_MODES = new Set(['light', 'dark', 'system']);
const CSS_THEME_IDS = new Set(['default', 'grid-theme', 'dot-theme', 'gradient-theme']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function boundedNumber(value, fallback, defaultValue, min, max, decimals = 0) {
  const candidate = typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof fallback === 'number' && Number.isFinite(fallback)
      ? fallback
      : defaultValue;
  const bounded = Math.min(max, Math.max(min, candidate));
  const multiplier = 10 ** decimals;
  return Math.round(bounded * multiplier) / multiplier;
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
    chatFontSize: boundedNumber(
      source.chatFontSize,
      fallback.chatFontSize,
      DEFAULT_APPEARANCE.chatFontSize,
      12,
      18,
    ),
    chatLineHeight: boundedNumber(
      source.chatLineHeight,
      fallback.chatLineHeight,
      DEFAULT_APPEARANCE.chatLineHeight,
      1.3,
      2,
      2,
    ),
    chatMessageSpacing: boundedNumber(
      source.chatMessageSpacing,
      fallback.chatMessageSpacing,
      DEFAULT_APPEARANCE.chatMessageSpacing,
      4,
      24,
    ),
  };
}

export function hasPersistedAppearance(settings) {
  return Boolean(
    settings?.appearance && typeof settings.appearance === 'object' && !Array.isArray(settings.appearance),
  );
}
