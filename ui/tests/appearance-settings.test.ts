import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_APPEARANCE,
  hasPersistedAppearance,
  normalizeAppearance,
} from '../src/appearance-settings.mjs';

describe('desktop appearance settings', () => {
  it('uses the desktop defaults when appearance is absent', () => {
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(hasPersistedAppearance({})).toBe(false);
  });

  it('accepts supported theme and background values', () => {
    const appearance = {
      themeMode: 'system',
      cssThemeId: 'dot-theme',
      autoCollapseToolCalls: true,
    };

    expect(normalizeAppearance(appearance)).toEqual(appearance);
    expect(hasPersistedAppearance({ appearance })).toBe(true);
  });

  it('falls back per field when persisted values are invalid', () => {
    expect(normalizeAppearance(
      { themeMode: 'unknown', cssThemeId: 'gradient-theme' },
      { themeMode: 'dark', cssThemeId: 'grid-theme' },
    )).toEqual({
      themeMode: 'dark',
      cssThemeId: 'gradient-theme',
      autoCollapseToolCalls: false,
    });

    expect(hasPersistedAppearance({
      appearance: { themeMode: 'dark', cssThemeId: 'custom-theme' },
    })).toBe(true);
  });
});
