import assert from 'node:assert/strict'
import path from 'node:path'
import { runSelfTestApp } from '../tests/helpers/run-self-test-app.mjs'
import { createDesktopSettingsStore } from '../src/desktop-settings.mjs'
const [packageRoot, settingsFile, ...caseIds] = process.argv.slice(2)
assert.ok(packageRoot && settingsFile, 'Usage: node scripts/test-self-test-real.mjs <package-directory> <settings.json> [case-id ...]')
const stored = createDesktopSettingsStore({ settingsPath: path.resolve(settingsFile) }).value
// Exercise the configured local model in an isolated Desktop, without starting
// unrelated remote channels or carrying their credentials into the test profile.
const settings = Object.fromEntries(['model', 'url', 'apiKey', 'fastModel', 'thinkingMode', 'thinkingBudgetTokens',
  'effortLevel', 'maxTurns', 'appearance', 'toolLoading', 'language', 'models', 'image', 'webSearch'].map(key => [key, stored[key]]))
assert.ok(settings.model && settings.url && settings.apiKey, 'Settings must include model, url and apiKey')
const selected = caseIds.includes('--all') || caseIds.includes('--default')
  ? JSON.parse(await (await import('node:fs/promises')).readFile(path.join(packageRoot, 'resources/self-tests/catalog.json'), 'utf8')).cases.filter(test => caseIds.includes('--all') || test.default).map(test => test.id)
  : caseIds.length ? caseIds : ['startup', 'apps-list', 'chat-response']
await runSelfTestApp({ packageRoot: path.resolve(packageRoot), settings, sourceHome: path.dirname(path.resolve(settingsFile)), caseIds: selected })
