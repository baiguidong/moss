/**
 * CSS Theme Injection - Injects custom CSS into document head
 */

const STYLE_ID = 'moss-custom-css';

/**
 * Apply CSS theme to the document
 */
export const applyCssTheme = (css: string | null): void => {
  const existing = document.getElementById(STYLE_ID);

  if (!css) {
    existing?.remove();
    return;
  }

  if (existing) {
    existing.textContent = css;
  } else {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }
};

/**
 * Read the legacy/startup cache. The persisted source of truth is
 * appearance.cssThemeId in ~/.moss/settings.json.
 */
export const getStoredThemeId = (): string | null => {
  try {
    return localStorage.getItem('ui.cssThemeId');
  } catch {
    return null;
  }
};

/**
 * Keep a synchronous startup cache for the next renderer launch.
 */
export const setStoredThemeId = (themeId: string): void => {
  try {
    localStorage.setItem('ui.cssThemeId', themeId);
  } catch {
    // ignore
  }
};
