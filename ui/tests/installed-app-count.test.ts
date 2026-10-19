import { describe, expect, test } from 'bun:test';
import { readInstalledAppCount, writeInstalledAppCount } from '../src/renderer-react/lib/installed-app-count';

describe('installed App count cache', () => {
  test('restores a valid count and replaces it after a successful list', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    expect(readInstalledAppCount(storage)).toBeNull();
    writeInstalledAppCount(storage, 142);
    expect(readInstalledAppCount(storage)).toBe(142);
    writeInstalledAppCount(storage, 0);
    expect(readInstalledAppCount(storage)).toBe(0);
  });

  test('ignores corrupt or unavailable storage', () => {
    expect(readInstalledAppCount({ getItem: () => '-1' })).toBeNull();
    expect(readInstalledAppCount({ getItem: () => 'NaN' })).toBeNull();
    expect(readInstalledAppCount({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
    expect(() => writeInstalledAppCount({ setItem: () => { throw new Error('blocked'); } }, 1)).not.toThrow();
  });
});
