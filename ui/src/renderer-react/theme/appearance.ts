import { normalizeAppearance } from '../../appearance-settings.mjs';
import { THEME_CATALOG, UI_FONTS, CODE_FONTS } from '../../theme-catalog.mjs';
import type { DesktopSettings, AppearanceProfile } from '../types';
import { applyCssTheme } from './cssTheme';

type Appearance = DesktopSettings['appearance'];
export function resolveAppearance(input: Appearance, mode: 'light' | 'dark') {
  const appearance = normalizeAppearance(input);
  const profile = appearance[mode === 'dark' ? 'darkProfile' : 'lightProfile'];
  const selected = THEME_CATALOG.find(theme => theme.id === (appearance.separateLightDark ? profile.themeId : appearance.cssThemeId));
  const theme = selected?.[mode] ? selected : THEME_CATALOG[0];
  return { theme, palette: { ...theme[mode], ...Object.fromEntries(['accent', 'background', 'foreground'].filter(key => profile[key]).map(key => [key, profile[key]])) },
    profile: { ...(appearance.separateLightDark ? profile : appearance), themeId: theme.id } as AppearanceProfile };
}
const mix = (background: string, foreground: string, percent: number) => `color-mix(in srgb, ${foreground} ${percent}%, ${background})`;
function readableInk(hex: string) {
  const channels = hex.slice(1).match(/../g)!.map(value => { const c = parseInt(value, 16) / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return luminance > .179 ? '#111111' : '#FFFFFF';
}
export function buildAppearanceCss(input: Appearance) {
  const appearance = normalizeAppearance(input);
  let css = (['light', 'dark'] as const).map(mode => {
    const { palette: p, profile } = resolveAppearance(appearance, mode);
    const surface = mix(p.background, p.foreground, 3 + profile.contrast / 25);
    const hover = mix(p.background, p.foreground, 6 + profile.contrast / 20);
    const border = mix(p.background, p.foreground, 5 + profile.contrast / 10);
    const values: Record<string, string | number> = {
      background: p.background, foreground: p.foreground, card: p.background, 'card-foreground': p.foreground,
      popover: surface, 'popover-foreground': p.foreground, primary: p.accent, 'primary-foreground': readableInk(p.accent),
      secondary: surface, 'secondary-foreground': p.foreground, muted: surface, 'muted-foreground': mix(p.background, p.foreground, 56 + profile.contrast / 5),
      accent: hover, 'accent-foreground': p.foreground, border, input: border, ring: p.accent,
      sidebar: appearance.translucentSidebar ? `color-mix(in srgb, ${surface} 78%, transparent)` : surface,
      'sidebar-foreground': p.foreground, 'sidebar-primary': p.accent, 'sidebar-primary-foreground': readableInk(p.accent),
      'sidebar-accent': hover, 'sidebar-accent-foreground': p.foreground, 'sidebar-border': border, 'sidebar-ring': p.accent,
      'color-code-bg': surface, 'color-code-fg': p.foreground, 'color-code-string': p.string, 'color-code-keyword': p.keyword,
      'color-code-comment': p.comment, 'color-code-function': p.accent, 'color-code-number': p.keyword,
      'color-code-type': p.accent, 'color-code-property': p.foreground, 'color-code-punctuation': p.foreground,
      'color-surface-user-msg': surface,
      'color-diff-added-bg': appearance.diffMarkers === 'markers' ? 'transparent' : mix(p.background, '#46A758', mode === 'dark' ? 22 : 12),
      'color-diff-removed-bg': appearance.diffMarkers === 'markers' ? 'transparent' : mix(p.background, '#E5484D', mode === 'dark' ? 22 : 12),
      'color-repl-diff-added-bg': 'var(--color-diff-added-bg)', 'color-repl-diff-removed-bg': 'var(--color-diff-removed-bg)',
      'color-repl-diff-added-fg': appearance.diffMarkers === 'markers' ? p.foreground : mode === 'dark' ? '#85DF7B' : '#16783A',
      'color-repl-diff-removed-fg': appearance.diffMarkers === 'markers' ? p.foreground : mode === 'dark' ? '#FF9292' : '#B42328',
      'color-diff-added-text': 'var(--color-repl-diff-added-fg)', 'color-diff-removed-text': 'var(--color-repl-diff-removed-fg)',
      'ui-font-scale': profile.uiFontSize / 14,
      'font-sans': UI_FONTS.find(font => font.id === profile.uiFont)!.css,
      'moss-content-font': UI_FONTS.find(font => font.id === profile.contentFont)!.css,
      'font-mono': CODE_FONTS.find(font => font.id === profile.codeFont)!.css,
      'moss-code-size': `${profile.codeFontSize}px`,
    };
    return `html[data-theme='${mode}'] {${Object.entries(values).map(([name, value]) => `--${name}:${value};`).join('')}font-size:${16 * profile.uiFontSize / 14}px;}`;
  }).join('\n');
  css += `
body { color: var(--foreground); background-color: var(--background); font-family: var(--font-sans); -webkit-font-smoothing: ${appearance.fontSmoothing ? 'auto' : 'antialiased'}; }
.app-shell { background: var(--background); color: var(--foreground); }
.prose, [data-chat-content], [data-message-body="user"] { font-family: var(--moss-content-font); }
pre, code, .font-mono, .cm-editor, .cm-scroller { font-family: var(--font-mono) !important; }
pre, pre code, .cm-editor, [data-code-viewer] { font-size: var(--moss-code-size) !important; }
[data-sidebar-shell] { backdrop-filter: ${appearance.translucentSidebar ? 'blur(20px) saturate(125%)' : 'none'}; }
button:not(:disabled), [role='button']:not([aria-disabled='true']), [role='radio'], [role='menuitem'], a[href], select, summary { cursor: ${appearance.pointerCursors ? 'pointer' : 'default'} !important; }
.moss-diff-marker { visibility: ${appearance.diffMarkers === 'colors' ? 'hidden' : 'visible'}; }
`;
  for (const size of [10, 11, 12, 13, 14, 15, 16, 18, 20]) css += `.text-\\[${size}px\\] { font-size: calc(${size}px * var(--ui-font-scale)); }\n`;
  const reduced = `*, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }`;
  if (appearance.reduceMotion === 'always') css += reduced;
  if (appearance.reduceMotion === 'system') css += `@media (prefers-reduced-motion: reduce) { ${reduced} }`;
  return css;
}
export function applyAppearanceTheme(input: Appearance) { applyCssTheme(buildAppearanceCss(input)); }

export function readCachedAppearance(): Appearance {
  try {
    const cached = localStorage.getItem('ui.appearance');
    if (cached) return normalizeAppearance(JSON.parse(cached));
    return normalizeAppearance({ themeMode: localStorage.getItem('ui.themeMode'), cssThemeId: localStorage.getItem('ui.cssThemeId') });
  } catch { return normalizeAppearance(); }
}
