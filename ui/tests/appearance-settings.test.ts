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
      cssThemeId: 'catppuccin',
      toolDisplayMode: 'merged',
      chatFontSize: 16,
      chatLineHeight: 1.7,
      chatMessageSpacing: 14,
      showAssistantMessageBorder: true,
      showAssistantAvatar: false,
    };

    expect(normalizeAppearance(appearance)).toMatchObject(appearance);
    expect(hasPersistedAppearance({ appearance })).toBe(true);
    const takt = normalizeAppearance({ ...appearance, cssThemeId: 'takt-theme' });
    expect(takt.cssThemeId).toBe('everforest');
    expect(normalizeAppearance({ themeMode: 'dark' }, takt).cssThemeId).toBe('everforest');
  });

  it('falls back per field when persisted values are invalid', () => {
    expect(normalizeAppearance(
      { themeMode: 'unknown', cssThemeId: 'gradient-theme' },
      { themeMode: 'dark', cssThemeId: 'grid-theme' },
    )).toMatchObject({
      themeMode: 'dark',
      cssThemeId: 'codex',
      toolDisplayMode: 'expanded',
      chatFontSize: 14,
      chatLineHeight: 1.55,
      chatMessageSpacing: 10,
      showAssistantMessageBorder: false,
      showAssistantAvatar: true,
    });

    expect(hasPersistedAppearance({
      appearance: { themeMode: 'dark', cssThemeId: 'custom-theme' },
    })).toBe(true);
  });

  it('maps the previous auto-collapse boolean to the new display modes', () => {
    expect(normalizeAppearance({ autoCollapseToolCalls: true }).toolDisplayMode).toBe('collapsed');
    expect(normalizeAppearance({ autoCollapseToolCalls: false }).toolDisplayMode).toBe('expanded');
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

  it('adds reply appearance defaults to old settings and preserves independent choices', () => {
    const legacy = { themeMode: 'dark', chatFontSize: 16 };
    expect(normalizeAppearance(legacy)).toMatchObject({
      ...legacy, showAssistantMessageBorder: false, showAssistantAvatar: true,
    });
    const existing = normalizeAppearance({ showAssistantMessageBorder: true, showAssistantAvatar: false });
    expect(normalizeAppearance({ chatFontSize: 18 }, existing)).toMatchObject({
      chatFontSize: 18, showAssistantMessageBorder: true, showAssistantAvatar: false,
    });
    expect(normalizeAppearance({ showAssistantMessageBorder: false }, existing)).toMatchObject({
      showAssistantMessageBorder: false, showAssistantAvatar: false,
    });
    expect(normalizeAppearance({ showAssistantMessageBorder: 'false', showAssistantAvatar: null }, existing)).toMatchObject({
      showAssistantMessageBorder: true, showAssistantAvatar: false,
    });
  });
});

describe('visual profiles', () => {
  it('migrates decorative backgrounds and retains the old green preference', () => {
    for (const id of ['default', 'grid-theme', 'dot-theme', 'gradient-theme']) expect(normalizeAppearance({ cssThemeId: id }).cssThemeId).toBe('codex');
    const migrated = normalizeAppearance({ cssThemeId: 'takt-theme', uiFontSize: 16 });
    expect(migrated.cssThemeId).toBe('everforest');
    expect(migrated.darkProfile).toMatchObject({ themeId: 'everforest', uiFontSize: 16 });
    expect(normalizeAppearance({ separateLightDark: true }, migrated).lightProfile).toMatchObject({ themeId: 'everforest', uiFontSize: 16 });
  });
  it('keeps independent light/dark settings and rejects CSS injection', () => {
    const initial = normalizeAppearance({ separateLightDark: true, lightProfile: { themeId: 'github', uiFontSize: 16 }, darkProfile: { themeId: 'ayu', accent: '#aabbcc', codeFont: 'menlo' } });
    const next = normalizeAppearance({ darkProfile: { background: '#123456', accent: 'red; color: white', codeFont: 'url(https://invalid)' } }, initial);
    expect(next.lightProfile).toEqual(initial.lightProfile);
    expect(next.darkProfile).toMatchObject({ themeId: 'ayu', accent: '#AABBCC', background: '#123456', codeFont: 'menlo' });
    expect(normalizeAppearance({ darkProfile: { accent: '' } }, next).darkProfile.accent).toBe('');
  });
  it('bounds typography and supports system motion preferences', () => {
    expect(normalizeAppearance({ uiFontSize: 100, codeFontSize: 0, contrast: -10, reduceMotion: 'always' })).toMatchObject({ uiFontSize: 18, codeFontSize: 10, contrast: 0, reduceMotion: 'always' });
    expect(normalizeAppearance({ reduceMotion: 'invalid', dockIcon: '../../other' })).toMatchObject({ reduceMotion: 'system', dockIcon: 'default' });
  });
});
