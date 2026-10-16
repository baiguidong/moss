/**
 * CSS Theme Presets - Simplified migration from sudowork
 */

export interface ICssTheme {
  id: string;
  name: string;
  css: string;
}

export const DEFAULT_THEME_ID = 'default';

/**
 * Default theme - no custom CSS
 */
export const DEFAULT_THEME: ICssTheme = {
  id: 'default',
  name: '默认',
  css: '',
};

/**
 * Grid Theme - Subtle grid background pattern
 */
export const GRID_THEME: ICssTheme = {
  id: 'grid-theme',
  name: '网格',
  css: `
/* Grid Theme */
html, body, .app-shell {
  background-color: var(--background);
}

.app-shell {
  background-image:
    linear-gradient(rgba(var(--foreground-rgb, 0, 0, 0), 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--foreground-rgb, 0, 0, 0), 0.05) 1px, transparent 1px);
  background-size: 40px 40px;
  background-attachment: fixed;
}

[data-theme='dark'] .app-shell {
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
}
  `.trim(),
};

/**
 * Dot Theme - Subtle dot pattern
 */
export const DOT_THEME: ICssTheme = {
  id: 'dot-theme',
  name: '圆点',
  css: `
/* Dot Theme */
html, body, .app-shell {
  background-color: var(--background);
}

.app-shell {
  background-image: radial-gradient(rgba(var(--foreground-rgb, 0, 0, 0), 0.08) 1px, transparent 1px);
  background-size: 20px 20px;
  background-attachment: fixed;
}

[data-theme='dark'] .app-shell {
  background-image: radial-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px);
}
  `.trim(),
};

/**
 * Gradient Theme - Subtle gradient background
 */
export const GRADIENT_THEME: ICssTheme = {
  id: 'gradient-theme',
  name: '渐变',
  css: `
/* Gradient Theme */
html, body, .app-shell {
  background: var(--background);
}

.app-shell {
  background: linear-gradient(135deg, var(--background) 0%, var(--secondary) 100%);
}

[data-theme='dark'] .app-shell {
  background: linear-gradient(135deg, var(--background) 0%, var(--secondary) 100%);
}
  `.trim(),
};

/** TAKT's quiet green surfaces and fine canvas dots, in both color modes. */
export const TAKT_THEME: ICssTheme = {
  id: 'takt-theme',
  name: 'TAKT 苔绿',
  css: `
:root {
  --background: #fbfcfa;
  --foreground: #253f32;
  --card: #ffffff;
  --card-foreground: #253f32;
  --popover: #ffffff;
  --popover-foreground: #253f32;
  --primary: #376b4d;
  --primary-foreground: #ffffff;
  --secondary: #f0f5ef;
  --secondary-foreground: #253f32;
  --muted: #f0f5ef;
  --muted-foreground: #64766a;
  --accent: #e1ecdf;
  --accent-foreground: #253f32;
  --border: #e4eae4;
  --input: #e4eae4;
  --ring: #79a984;
  --sidebar: #ffffff;
  --sidebar-foreground: #253f32;
  --sidebar-primary: #376b4d;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #f0f5ef;
  --sidebar-accent-foreground: #253f32;
  --sidebar-border: #e4eae4;
  --sidebar-ring: #79a984;
  --takt-dot: #dfe6df;
}
[data-theme='dark'] {
  --background: #19201c;
  --foreground: #e0e8de;
  --card: #202a23;
  --card-foreground: #e0e8de;
  --popover: #202a23;
  --popover-foreground: #e0e8de;
  --primary: #8cbe99;
  --primary-foreground: #19201c;
  --secondary: #28372d;
  --secondary-foreground: #e0e8de;
  --muted: #28372d;
  --muted-foreground: #9eada2;
  --accent: #304937;
  --accent-foreground: #e0e8de;
  --border: #344239;
  --input: #344239;
  --ring: #8cbe99;
  --sidebar: #202a23;
  --sidebar-foreground: #e0e8de;
  --sidebar-primary: #8cbe99;
  --sidebar-primary-foreground: #19201c;
  --sidebar-accent: #28372d;
  --sidebar-accent-foreground: #e0e8de;
  --sidebar-border: #344239;
  --sidebar-ring: #8cbe99;
  --takt-dot: #344239;
}
html, body { background: var(--background); }
.app-shell {
  background-color: var(--background);
  background-image: radial-gradient(var(--takt-dot) 1px, transparent 1px);
  background-size: 22px 22px;
  background-attachment: fixed;
}
  `.trim(),
};

export const PRESET_THEMES: ICssTheme[] = [
  DEFAULT_THEME,
  GRID_THEME,
  DOT_THEME,
  GRADIENT_THEME,
  TAKT_THEME,
];
