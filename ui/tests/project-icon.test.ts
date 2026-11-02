import { expect, test } from 'bun:test';
import { DEFAULT_PROJECT_ICON, PROJECT_ICON_PRESETS, normalizeProjectIcon } from '../../shared/project-icon.mjs';

test('legacy or damaged icons fall back while explicit invalid writes are rejected', () => {
  for (const value of [undefined, null, '', 'https://example.com/icon.svg', { kind: 'builtin', name: 'unknown' }, { kind: 'generated', paths: [] }]) {
    expect(normalizeProjectIcon(value)).toEqual(DEFAULT_PROJECT_ICON);
    if (value != null) expect(() => normalizeProjectIcon(value, { strict: true })).toThrow('项目图标无效');
  }
});

test('accepts local vector paths and strips unrelated attributes', () => {
  for (const preset of PROJECT_ICON_PRESETS) {
    const icon = { kind: 'generated', paths: preset.paths, color: 'blue' };
    expect(normalizeProjectIcon({ ...icon, onload: 'alert(1)' }, { strict: true })).toEqual(icon);
  }
});

test('rejects markup, URLs, broken commands and excessive vector data', () => {
  for (const paths of [['<svg onload="alert(1)"/>'], ['https://example.com/i.svg'], ['M2 2L'], ['M2 2 E L4 4'], ['M2 2L1e999 2'], ['M0 0A2 2 0 2 0 4 4'], ['M2 2'], Array(9).fill('M2 2L4 4'), ['M2 2L' + '1 1 '.repeat(500)]]) {
    expect(() => normalizeProjectIcon({ kind: 'generated', color: 'blue', paths }, { strict: true })).toThrow('项目图标无效');
  }
  expect(() => normalizeProjectIcon({ kind: 'builtin', name: 'folder', color: 'url(https://example.com)' }, { strict: true })).toThrow();
});
