import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeVersion, syncReleaseVersion } from './sync-ui-version.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('release version sync', () => {
  test('normalizes v-prefixed tag refs', () => {
    expect(normalizeVersion('refs/tags/v2.3.4')).toBe('2.3.4');
    expect(normalizeVersion('v2.3.4-beta.1')).toBe('2.3.4-beta.1');
  });

  test('updates root and desktop package versions together', () => {
    const root = mkdtempSync(join(tmpdir(), 'moss-version-sync-'));
    temporaryDirectories.push(root);
    mkdirSync(join(root, 'ui'));
    writeFileSync(join(root, 'package.json'), '{"name":"moss","version":"1.0.0"}\n');
    writeFileSync(join(root, 'ui', 'package.json'), '{"name":"desktop","version":"0.0.1"}\n');

    expect(syncReleaseVersion('v2.3.4', root)).toBe('2.3.4');
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('2.3.4');
    expect(JSON.parse(readFileSync(join(root, 'ui', 'package.json'), 'utf8')).version).toBe('2.3.4');
  });

  test('rejects branch names', () => {
    expect(() => syncReleaseVersion('main', '/tmp/unused')).toThrow('Expected a semver');
    expect(() => syncReleaseVersion('v01.2.3', '/tmp/unused')).toThrow('Expected a semver');
    expect(() => syncReleaseVersion('v1.2.3-..', '/tmp/unused')).toThrow('Expected a semver');
  });

  test('accepts valid prerelease and build metadata versions', () => {
    expect(() => syncReleaseVersion('v1.2.3-beta.1+ci.7', '/tmp/unused')).not.toThrow();
  });
});
