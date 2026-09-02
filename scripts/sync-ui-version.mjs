#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*)))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function normalizeVersion(value) {
  return value.replace(/^refs\/tags\//, '').replace(/^v/, '').trim();
}

export function syncReleaseVersion(rawVersion, rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const version = normalizeVersion(rawVersion);
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`Expected a semver tag or version, got: ${rawVersion || '(empty)'}`);
  }

  const targets = [
    resolve(rootDir, 'package.json'),
    resolve(rootDir, 'ui', 'package.json'),
    resolve(rootDir, 'ui', 'package-lock.json'),
  ];
  for (const target of targets) {
    if (!existsSync(target)) continue;
    const parsed = JSON.parse(readFileSync(target, 'utf8'));
    parsed.version = version;
    if (target.endsWith('package-lock.json') && parsed.packages?.['']) {
      parsed.packages[''].version = version;
    }
    writeFileSync(target, `${JSON.stringify(parsed, null, 2)}\n`);
    console.log(`Synced ${target} -> ${version}`);
  }
  return version;
}

const isMain = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    syncReleaseVersion(process.argv[2] ?? process.env.GITHUB_REF_NAME ?? '');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
