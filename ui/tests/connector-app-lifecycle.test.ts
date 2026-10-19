import { expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

test('Connector Apps use signed marketplace packages without migrating old data', async () => {
  const { stdout } = await promisify(execFile)('node', [fileURLToPath(new URL('./helpers/connector-app-lifecycle.mjs', import.meta.url))], { timeout: 60_000 })
  const result = JSON.parse(stdout)
  expect(result.ok).toBe(true)
  expect(result.checks).toContain('real-local-cli-execution')
  expect(result.checks).toContain('activation-rollback')
  expect(result.checks).toContain('no-legacy-migration')
  expect(result.checks).toContain('signed-market-install')
  expect(result.checks).toContain('explicit-app-identity')
}, 65_000)
