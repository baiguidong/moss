import { contextBridge, ipcRenderer } from 'electron'

// App documents are isolated from the Moss renderer, so they cannot inherit
// the renderer's CSS variables. The same dependency-free source is injected
// into the web host by web/apps.mjs.
const THEME_PALETTES = {
  codex: { light: { background: '#FFFFFF', foreground: '#0D0D0D', accent: '#0169CC', string: '#008000', keyword: '#7C3AED', comment: '#727272' }, dark: { background: '#111111', foreground: '#FCFCFC', accent: '#0169CC', string: '#85DF7B', keyword: '#B06DFF', comment: '#999999' } },
  github: { light: { background: '#FFFFFF', foreground: '#24292E', accent: '#2188FF', string: '#032F62', keyword: '#D73A49', comment: '#6A737D' }, dark: { background: '#0D1117', foreground: '#E6EDF3', accent: '#1F6FEB', string: '#A5D6FF', keyword: '#FF7B72', comment: '#8B949E' } },
  catppuccin: { light: { background: '#EFF1F5', foreground: '#4C4F69', accent: '#8839EF', string: '#40A02B', keyword: '#8839EF', comment: '#6C6F85' }, dark: { background: '#1E1E2E', foreground: '#CDD6F4', accent: '#CBA6F7', string: '#A6E3A1', keyword: '#CBA6F7', comment: '#9399B2' } },
  everforest: { light: { background: '#FDF6E3', foreground: '#5C6A72', accent: '#93B259', string: '#6C782E', keyword: '#8F3F71', comment: '#829181' }, dark: { background: '#2D353B', foreground: '#D3C6AA', accent: '#A7C080', string: '#A7C080', keyword: '#D699B6', comment: '#859289' } },
  gruvbox: { light: { background: '#FBF1C7', foreground: '#3C3836', accent: '#458588', string: '#79740E', keyword: '#9D0006', comment: '#7C6F64' }, dark: { background: '#282828', foreground: '#EBDBB2', accent: '#458588', string: '#B8BB26', keyword: '#FB4934', comment: '#A89984' } },
  solarized: { light: { background: '#FDF6E3', foreground: '#657B83', accent: '#B58900', string: '#2AA198', keyword: '#859900', comment: '#93A1A1' }, dark: { background: '#002B36', foreground: '#839496', accent: '#D30102', string: '#2AA198', keyword: '#859900', comment: '#586E75' } },
  ayu: { dark: { background: '#10141C', foreground: '#BFBDB6', accent: '#E6B450', string: '#AAD94C', keyword: '#FF8F40', comment: '#ACB6BF' } },
  dracula: { dark: { background: '#282A36', foreground: '#F8F8F2', accent: '#FF79C6', string: '#F1FA8C', keyword: '#FF79C6', comment: '#9AA9D7' } },
  nord: { dark: { background: '#2E3440', foreground: '#D8DEE9', accent: '#88C0D0', string: '#A3BE8C', keyword: '#81A1C1', comment: '#8996AF' } },
}
const UI_FONTS = { system: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', sans: 'Arial, "Helvetica Neue", sans-serif', serif: 'Georgia, "Songti SC", serif', mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace' }
const CODE_FONTS = { system: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace', menlo: 'Menlo, Consolas, monospace', monaco: 'Monaco, Consolas, monospace', courier: '"Courier New", Courier, monospace' }
const LEGACY_BACKGROUND_STYLES = new Set(['default', 'grid-theme', 'dot-theme', 'gradient-theme', 'takt-theme'])
const clamp = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
const validHex = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
const mix = (background, foreground, percent) => `color-mix(in srgb, ${foreground} ${percent}%, ${background})`
function readableInk(hex) {
  const channels = String(hex).slice(1).match(/../g)?.map(value => { const c = parseInt(value, 16) / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 }) || [0, 0, 0]
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? '#111111' : '#FFFFFF'
}
function profileFor(appearance, mode) {
  const separate = appearance?.separateLightDark === true
  const profile = appearance?.[mode === 'dark' ? 'darkProfile' : 'lightProfile'] || {}
  const themeId = (separate ? profile.themeId : appearance?.cssThemeId) || 'codex'
  const palette = THEME_PALETTES[themeId]?.[mode] || THEME_PALETTES.codex[mode]
  // With the shared light/dark mode Core keeps the editable values in the
  // light profile for backwards compatibility while also exposing the
  // top-level appearance fields. Prefer explicit top-level values.
  const shared = separate ? profile : { ...profile, ...(appearance || {}) }
  return {
    ...palette, themeId,
    accent: validHex(shared.accent) ? shared.accent.toUpperCase() : palette.accent,
    background: validHex(shared.background) ? shared.background.toUpperCase() : palette.background,
    foreground: validHex(shared.foreground) ? shared.foreground.toUpperCase() : palette.foreground,
    uiFontSize: clamp(shared.uiFontSize, 14, 12, 18), codeFontSize: clamp(shared.codeFontSize, 12, 10, 20),
    uiFont: UI_FONTS[shared.uiFont] ? shared.uiFont : 'system', contentFont: UI_FONTS[shared.contentFont] ? shared.contentFont : 'system',
    codeFont: CODE_FONTS[shared.codeFont] ? shared.codeFont : 'system', contrast: clamp(shared.contrast, 60, 0, 100),
  }
}
function resolveAppearance(appearance) {
  const mode = appearance?.themeMode === 'dark' || appearance?.themeMode === 'light' ? appearance.themeMode : 'system'
  const theme = mode === 'system' ? (globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode
  const profile = profileFor(appearance, theme)
  const surface = mix(profile.background, profile.foreground, 3 + profile.contrast / 25)
  const hover = mix(profile.background, profile.foreground, 6 + profile.contrast / 20)
  const border = mix(profile.background, profile.foreground, 5 + profile.contrast / 10)
  const muted = mix(profile.background, profile.foreground, 56 + profile.contrast / 5)
  const backgroundStyle = LEGACY_BACKGROUND_STYLES.has(appearance?.cssThemeId) ? appearance.cssThemeId : 'default'
  const pageImage = backgroundStyle === 'grid-theme'
    ? `linear-gradient(${mix(profile.background, profile.foreground, 5)} 1px, transparent 1px), linear-gradient(90deg, ${mix(profile.background, profile.foreground, 5)} 1px, transparent 1px)`
    : backgroundStyle === 'dot-theme' || backgroundStyle === 'takt-theme'
      ? `radial-gradient(${mix(profile.background, profile.foreground, 8)} 1px, transparent 1px)`
      : backgroundStyle === 'gradient-theme' ? `linear-gradient(135deg, ${profile.background}, ${surface})` : 'none'
  const diffAdded = appearance?.diffMarkers === 'markers' ? 'transparent' : mix(profile.background, '#46A758', theme === 'dark' ? 22 : 12)
  const diffRemoved = appearance?.diffMarkers === 'markers' ? 'transparent' : mix(profile.background, '#E5484D', theme === 'dark' ? 22 : 12)
  return { mode, theme, profile, backgroundStyle, vars: {
    '--background': profile.background, '--foreground': profile.foreground, '--card': profile.background, '--card-foreground': profile.foreground,
    '--popover': surface, '--popover-foreground': profile.foreground, '--primary': profile.accent, '--primary-foreground': readableInk(profile.accent),
    '--secondary': surface, '--secondary-foreground': profile.foreground, '--muted': surface, '--muted-foreground': muted,
    '--accent': hover, '--accent-foreground': profile.foreground, '--border': border, '--input': border, '--ring': profile.accent, '--radius': '0.625rem',
    '--sidebar': appearance?.translucentSidebar ? `color-mix(in srgb, ${surface} 78%, transparent)` : surface, '--sidebar-foreground': profile.foreground,
    '--sidebar-primary': profile.accent, '--sidebar-primary-foreground': readableInk(profile.accent), '--sidebar-accent': hover, '--sidebar-accent-foreground': profile.foreground,
    '--sidebar-border': border, '--sidebar-ring': profile.accent, '--destructive': theme === 'dark' ? '#FF6B6B' : '#D92D20', '--destructive-foreground': '#FFFFFF',
    '--color-success': theme === 'dark' ? '#85DF7B' : '#16783A', '--color-warning': theme === 'dark' ? '#F5C36A' : '#A15C00', '--color-error': theme === 'dark' ? '#FF9292' : '#B42328',
    '--color-surface': profile.background, '--color-surface-container': surface, '--color-surface-user-msg': surface,
    '--color-surface-hover': `color-mix(in srgb, ${profile.accent} 8%, ${profile.background})`, '--color-text-primary': profile.foreground,
    '--color-text-secondary': mix(profile.foreground, muted, 78), '--color-text-tertiary': muted,
    '--color-brand': profile.accent, '--color-code-bg': surface, '--color-code-fg': profile.foreground, '--color-code-string': profile.string || profile.foreground, '--color-code-keyword': profile.keyword || profile.accent,
    '--color-code-comment': profile.comment || muted, '--color-code-number': profile.keyword || profile.accent, '--color-code-function': profile.accent,
    '--color-code-type': profile.accent, '--color-code-parameter': profile.foreground, '--color-code-property': profile.foreground, '--color-code-punctuation': profile.foreground,
    '--color-code-inserted': theme === 'dark' ? '#85DF7B' : '#16783A', '--color-code-deleted': theme === 'dark' ? '#FF9292' : '#B42328',
    '--color-diff-added-bg': diffAdded, '--color-diff-removed-bg': diffRemoved,
    '--color-repl-diff-added-bg': 'var(--color-diff-added-bg)', '--color-repl-diff-removed-bg': 'var(--color-diff-removed-bg)',
    '--color-repl-diff-added-fg': appearance?.diffMarkers === 'markers' ? profile.foreground : (theme === 'dark' ? '#85DF7B' : '#16783A'),
    '--color-repl-diff-removed-fg': appearance?.diffMarkers === 'markers' ? profile.foreground : (theme === 'dark' ? '#FF9292' : '#B42328'),
    '--color-diff-added-text': 'var(--color-repl-diff-added-fg)', '--color-diff-removed-text': 'var(--color-repl-diff-removed-fg)',
    '--color-outline': `color-mix(in srgb, ${profile.foreground} 26%, transparent)`, '--color-outline-variant': `color-mix(in srgb, ${border} 88%, transparent)`,
    '--color-terminal-bg': theme === 'dark' ? '#171B25' : '#F5F7FA', '--color-terminal-fg': profile.foreground, '--color-terminal-header': surface, '--color-terminal-border': border,
    '--color-terminal-muted': muted, '--color-terminal-danger': theme === 'dark' ? '#FF9292' : '#B42328', '--color-terminal-warning': theme === 'dark' ? '#F5C36A' : '#A15C00', '--color-terminal-accent': profile.accent,
    '--bg': profile.background, '--text': profile.foreground, '--surface': profile.background, '--sidebar-surface': appearance?.translucentSidebar ? `color-mix(in srgb, ${surface} 78%, transparent)` : surface,
    '--soft': surface, '--takt-muted': muted, '--takt-accent': profile.accent, '--line': border, '--accent-color': profile.accent, '--on-accent': readableInk(profile.accent), '--grid': mix(profile.background, profile.foreground, 8), '--page-image': pageImage,
    '--page-size': backgroundStyle === 'grid-theme' ? '40px 40px' : backgroundStyle === 'dot-theme' ? '20px 20px' : backgroundStyle === 'takt-theme' ? '22px 22px' : 'auto',
    '--font-sans': UI_FONTS[profile.uiFont], '--moss-content-font': UI_FONTS[profile.contentFont], '--font-mono': CODE_FONTS[profile.codeFont],
    '--moss-code-size': `${profile.codeFontSize}px`, '--ui-font-scale': String(profile.uiFontSize / 14),
    '--moss-chat-font-size': `${clamp(appearance?.chatFontSize, 14, 12, 18)}px`, '--moss-chat-line-height': String(clamp(appearance?.chatLineHeight, 1.55, 1.3, 2)),
    '--moss-chat-message-spacing': `${clamp(appearance?.chatMessageSpacing, 10, 4, 24)}px`,
    '--moss-diff-markers': appearance?.diffMarkers || 'both', '--moss-tool-display-mode': appearance?.toolDisplayMode || 'expanded',
    '--moss-show-assistant-border': appearance?.showAssistantMessageBorder === true ? '1' : '0', '--moss-show-assistant-avatar': appearance?.showAssistantAvatar === false ? '0' : '1',
  } }
}
function applyAppearance(appearance) {
  const resolved = resolveAppearance(appearance || {}), root = document.documentElement
  if (!root) return
  root.dataset.theme = resolved.theme; root.classList.toggle('dark', resolved.theme === 'dark'); root.dataset.themeMode = resolved.mode; root.dataset.cssTheme = resolved.profile.themeId || 'codex'; root.dataset.backgroundStyle = resolved.backgroundStyle; root.style.colorScheme = resolved.theme
  for (const [name, value] of Object.entries(resolved.vars)) root.style.setProperty(name, value)
  root.style.fontSize = `${16 * resolved.profile.uiFontSize / 14}px`
  root.style.setProperty('--moss-font-smoothing', appearance?.fontSmoothing === false ? 'antialiased' : 'auto')
  root.style.setProperty('--moss-pointer-cursor', appearance?.pointerCursors === false ? 'default' : 'pointer')
  let style = document.getElementById('moss-app-appearance-bridge')
  if (!style) { style = document.createElement('style'); style.id = 'moss-app-appearance-bridge'; (document.head || root).appendChild(style) }
  else if (document.readyState !== 'loading' && document.head) document.head.appendChild(style)
  const reduced = '*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}'
  style.textContent = `html,body,#root,#app,#buddy-app{color:var(--foreground)!important;background-color:var(--background)!important;font-family:var(--font-sans)!important;font-size:calc(16px * var(--ui-font-scale))!important;-webkit-font-smoothing:var(--moss-font-smoothing)}#buddy-app .buddy-product{font-family:var(--font-sans)!important;font-size:calc(14px * var(--ui-font-scale))!important}html.buddy-mini,html.buddy-mini body,html.buddy-mini #buddy-app{background:transparent!important}.prose,[data-chat-content],[data-message-body=user]{font-family:var(--moss-content-font)!important}.prose,[data-chat-content],[data-message-body=user],[data-chat-message]{font-size:var(--moss-chat-font-size)!important;line-height:var(--moss-chat-line-height)!important;margin-bottom:var(--moss-chat-message-spacing)}pre,code,.font-mono,.cm-editor,.cm-scroller{font-family:var(--font-mono)!important;font-size:var(--moss-code-size)!important}.moss-diff-marker{visibility:${appearance?.diffMarkers === 'colors' ? 'hidden' : 'visible'}}button:not(:disabled),[role=button]:not([aria-disabled=true]),[role=radio],[role=menuitem],a[href],select,summary{cursor:var(--moss-pointer-cursor)!important}${appearance?.reduceMotion === 'always' ? reduced : appearance?.reduceMotion === 'system' ? `@media(prefers-reduced-motion:reduce){${reduced}}` : ''}`
}
function syncAppearance(api) {
  if (!api?.app?.getInfo) return () => {}
  const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)'); let appearance = {}, disposed = false, pending = false, again = false, revision = 0
  const refresh = async () => {
    if (disposed || pending) { if (!disposed) again = true; return }
    pending = true; const started = revision
    try { const info = await api.app.getInfo(); if (!disposed && started === revision) { appearance = info?.appearance || {}; applyAppearance(appearance) } } catch {}
    finally { pending = false; if (again && !disposed) { again = false; void refresh() } }
  }
  const onAppearance = value => { if (!disposed && value && typeof value === 'object') { revision++; appearance = value; applyAppearance(appearance) } }
  const off = api.events?.on?.('appearance', onAppearance)
  const onMedia = () => { if (appearance.themeMode === 'system') applyAppearance(appearance) }
  const onVisible = () => { if (!document.hidden) void refresh() }; const onFocus = () => void refresh()
  media?.addEventListener('change', onMedia); document.addEventListener('visibilitychange', onVisible); window.addEventListener('focus', onFocus)
  applyAppearance(appearance)
  document.addEventListener('DOMContentLoaded', () => applyAppearance(appearance), { once: true })
  void refresh()
  return () => { disposed = true; off?.(); media?.removeEventListener('change', onMedia); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onFocus) }
}

function on(channel, callback) {
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const request = (channel, payload) => ipcRenderer.invoke(channel, payload)

const mossApp = {
  view: { setState: state => request('app-ui:view-state', state) },
  app: {
    getInfo: () => ipcRenderer.invoke('app-ui:get-info'),
    getStatus: () => ipcRenderer.invoke('app-ui:get-status'),
    getVersions: () => ipcRenderer.invoke('app-ui:list-versions'),
    getInstallationState: () => ipcRenderer.invoke('app-ui:get-installation-state'),
  },
  composer: {
    prepare: (input) => ipcRenderer.invoke('app-ui:composer:prepare', input),
  },
  instances: {
    list: () => ipcRenderer.invoke('app-ui:instances:list'),
    update: (instanceId, patch) => ipcRenderer.invoke('app-ui:instances:update', { instanceId, ...patch }),
    setEnabled: (instanceId, enabled) => ipcRenderer.invoke('app-ui:instances:set-enabled', { instanceId, enabled }),
    clearCredentials: (instanceId) => ipcRenderer.invoke('app-ui:instances:clear-credentials', { instanceId }),
    getStatus: (instanceId) => ipcRenderer.invoke('app-ui:instances:get-status', { instanceId }),
  },
  actions: {
    invoke: (name, input, options = {}) => request('app-ui:actions:invoke', { name, input, requestId: options.requestId ?? globalThis.crypto.randomUUID(), timeoutMs: options.timeoutMs }),
    cancel: (requestId) => ipcRenderer.invoke('app-ui:actions:cancel', { requestId }),
  },
  storage: {
    getItem: (key) => ipcRenderer.invoke('app-ui:storage:get', { key }),
    setItem: (key, value) => ipcRenderer.invoke('app-ui:storage:set', { key, value }),
    removeItem: (key) => ipcRenderer.invoke('app-ui:storage:remove', { key }),
    list: () => ipcRenderer.invoke('app-ui:storage:list'),
  },
  host: {
    subscribe: (protocol, name, subscriptionId) => request('app-ui:host:subscribe', { protocol, name, subscriptionId }),
    unsubscribe: subscriptionId => request('app-ui:host:unsubscribe', { subscriptionId }),
    onEvent: callback => on('app-ui:host:event', callback),
    request: (protocol, method, input, options = {}) => request('app-ui:host:request', {
      protocol, method, input, requestId: options.requestId ?? globalThis.crypto.randomUUID(), timeoutMs: options.timeoutMs,
    }),
    cancel: (requestId) => ipcRenderer.invoke('app-ui:host:cancel', { requestId }),
  },
  events: { on: (eventName, callback) => on(`app-ui:event:${String(eventName || '')}`, callback) },
}
contextBridge.exposeInMainWorld('mossApp', mossApp)
syncAppearance(mossApp)

contextBridge.exposeInMainWorld('appVersionInfo', { version: '3.0.0', name: 'Moss App Runtime' })
