import { migrateThemeId, UI_FONTS, CODE_FONTS } from './theme-catalog.mjs';

export const DEFAULT_PROFILE = Object.freeze({ themeId: 'codex', accent: '', background: '', foreground: '', uiFontSize: 14, codeFontSize: 12, uiFont: 'system', contentFont: 'system', codeFont: 'system', contrast: 60 });
export const DEFAULT_APPEARANCE = Object.freeze({
  themeMode: 'light',
  cssThemeId: 'codex',
  uiFontSize: 14, codeFontSize: 12, uiFont: 'system', contentFont: 'system', codeFont: 'system', contrast: 60,
  lightProfile: DEFAULT_PROFILE, darkProfile: DEFAULT_PROFILE, separateLightDark: false,
  reduceMotion: 'system', translucentSidebar: false, diffMarkers: 'both', pointerCursors: true, fontSmoothing: true, dockIcon: 'default',
  toolDisplayMode: 'expanded',
  chatFontSize: 14,
  chatLineHeight: 1.55,
  chatMessageSpacing: 10,
  showAssistantMessageBorder: false,
  showAssistantAvatar: true,
});

const THEME_MODES = new Set(['light', 'dark', 'system']);
const TOOL_DISPLAY_MODES = new Set(['expanded', 'collapsed', 'merged']);

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
  const themeId = migrateThemeId(source.cssThemeId) || migrateThemeId(fallback.cssThemeId) || 'codex';
  const typography = normalizeTypography(source, fallback);
  const separateLightDark = bool(source.separateLightDark, fallback.separateLightDark, false);
  function profileFor(key) {
    const prior = { ...asObject(fallback[key]) };
    // Legacy/shared settings seed both profiles. Explicit saved profiles retain
    // their independent choices when the separate-modes toggle is turned off.
    if (!separateLightDark) {
      if (migrateThemeId(source.cssThemeId)) prior.themeId = themeId;
      for (const field of Object.keys(typography)) if (Object.hasOwn(source, field)) prior[field] = typography[field];
    }
    return normalizeProfile(source[key], prior, themeId);
  }

  return {
    themeMode: THEME_MODES.has(source.themeMode)
      ? source.themeMode
      : THEME_MODES.has(fallback.themeMode)
        ? fallback.themeMode
        : DEFAULT_APPEARANCE.themeMode,
    cssThemeId: themeId,
    ...typography,
    lightProfile: profileFor('lightProfile'),
    darkProfile: profileFor('darkProfile'),
    separateLightDark,
    reduceMotion: choice(source.reduceMotion, fallback.reduceMotion, ['system', 'always', 'never'], 'system'),
    translucentSidebar: bool(source.translucentSidebar, fallback.translucentSidebar, false),
    diffMarkers: choice(source.diffMarkers, fallback.diffMarkers, ['colors', 'markers', 'both'], 'both'),
    pointerCursors: bool(source.pointerCursors, fallback.pointerCursors, true),
    fontSmoothing: bool(source.fontSmoothing, fallback.fontSmoothing, true),
    dockIcon: choice(source.dockIcon, fallback.dockIcon, ['default', 'graphite', 'inverted'], 'default'),
    toolDisplayMode: TOOL_DISPLAY_MODES.has(source.toolDisplayMode)
      ? source.toolDisplayMode
      : typeof source.autoCollapseToolCalls === 'boolean'
        ? (source.autoCollapseToolCalls ? 'collapsed' : 'expanded')
        : TOOL_DISPLAY_MODES.has(fallback.toolDisplayMode)
          ? fallback.toolDisplayMode
          : typeof fallback.autoCollapseToolCalls === 'boolean'
            ? (fallback.autoCollapseToolCalls ? 'collapsed' : 'expanded')
            : DEFAULT_APPEARANCE.toolDisplayMode,
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
    showAssistantMessageBorder: typeof source.showAssistantMessageBorder === 'boolean'
      ? source.showAssistantMessageBorder
      : typeof fallback.showAssistantMessageBorder === 'boolean'
        ? fallback.showAssistantMessageBorder
        : DEFAULT_APPEARANCE.showAssistantMessageBorder,
    showAssistantAvatar: typeof source.showAssistantAvatar === 'boolean'
      ? source.showAssistantAvatar
      : typeof fallback.showAssistantAvatar === 'boolean'
        ? fallback.showAssistantAvatar
        : DEFAULT_APPEARANCE.showAssistantAvatar,
  };
}

export function hasPersistedAppearance(settings) {
  return Boolean(
    settings?.appearance && typeof settings.appearance === 'object' && !Array.isArray(settings.appearance),
  );
}

function choice(value, fallback, values, defaultValue) {
  return values.includes(value) ? value : values.includes(fallback) ? fallback : defaultValue;
}
function bool(value, fallback, defaultValue) {
  return typeof value === 'boolean' ? value : typeof fallback === 'boolean' ? fallback : defaultValue;
}
function normalizeTypography(source, fallback) {
  return {
    uiFontSize: boundedNumber(source.uiFontSize, fallback.uiFontSize, 14, 12, 18),
    codeFontSize: boundedNumber(source.codeFontSize, fallback.codeFontSize, 12, 10, 20),
    contrast: boundedNumber(source.contrast, fallback.contrast, 60, 0, 100),
    uiFont: choice(source.uiFont, fallback.uiFont, UI_FONTS.map(font => font.id), 'system'),
    contentFont: choice(source.contentFont, fallback.contentFont, UI_FONTS.map(font => font.id), 'system'),
    codeFont: choice(source.codeFont, fallback.codeFont, CODE_FONTS.map(font => font.id), 'system'),
  };
}
function normalizeProfile(input, existing, themeId) {
  const source = asObject(input), fallback = asObject(existing);
  const color = value => typeof value === 'string' && (value === '' || /^#[0-9a-f]{6}$/i.test(value));
  return {
    themeId: migrateThemeId(source.themeId) || migrateThemeId(fallback.themeId) || migrateThemeId(themeId) || 'codex',
    ...Object.fromEntries(['accent', 'background', 'foreground'].map(key => [key, color(source[key]) ? source[key].toUpperCase() : color(fallback[key]) ? fallback[key] : ''])),
    ...normalizeTypography(source, fallback),
  };
}
