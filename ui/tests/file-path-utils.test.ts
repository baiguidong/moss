import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { resolveUserPath } from '../src/file-path-utils.mjs';

describe('file Host API paths', () => {
  const home = path.resolve('/tmp/moss-test-home');

  it('expands home-relative paths', () => {
    expect(resolveUserPath('~/.moss/settings.json', home)).toBe(
      path.join(home, '.moss', 'settings.json'),
    );
  });

  it('keeps absolute paths absolute', () => {
    expect(resolveUserPath('/tmp/example.txt', home)).toBe(path.resolve('/tmp/example.txt'));
  });

  it('rejects empty paths', () => {
    expect(() => resolveUserPath('  ', home)).toThrow('File path is required');
  });
});
