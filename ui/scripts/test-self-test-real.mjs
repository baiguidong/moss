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
  'effortLevel', 'maxTurns', 'appearance', 'toolLoading', 'language'].map(key => [key, stored[key]]))
assert.ok(settings.model && settings.url && settings.apiKey, 'Settings must include model, url and apiKey')
await runSelfTestApp({ packageRoot: path.resolve(packageRoot), settings, caseIds: caseIds.length ? caseIds : ['startup', 'apps-list', 'chat-response'] })
