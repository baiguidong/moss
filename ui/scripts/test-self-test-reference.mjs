import assert from 'node:assert/strict';
import path from 'node:path';
import { runDirectReference } from '../tests/helpers/direct-self-test-reference.mjs';
const [packageRoot, settingsFile, ...caseIds] = process.argv.slice(2);
assert(packageRoot && settingsFile, 'Usage: node ui/scripts/test-self-test-reference.mjs <package-directory> <settings.json> [case-ids]');
await runDirectReference({ packageRoot: path.resolve(packageRoot), settingsFile: path.resolve(settingsFile), preserveAppearance: caseIds.includes('--source-appearance'), caseIds: caseIds.filter(id => id !== '--source-appearance').length ? caseIds.filter(id => id !== '--source-appearance') : undefined });
