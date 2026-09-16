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
      chatFontSize: 16,
      chatLineHeight: 1.7,
      chatMessageSpacing: 14,
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
      chatFontSize: 14,
      chatLineHeight: 1.55,
      chatMessageSpacing: 10,
    });

    expect(hasPersistedAppearance({
      appearance: { themeMode: 'dark', cssThemeId: 'custom-theme' },
    })).toBe(true);
  });

  it('bounds chat typography and spacing controls', () => {
    expect(normalizeAppearance({
      chatFontSize: 30,
      chatLineHeight: 1.333,
      chatMessageSpacing: 1,
    })).toMatchObject({
      chatFontSize: 18,
      chatLineHeight: 1.33,
      chatMessageSpacing: 4,
    });
  });
});
