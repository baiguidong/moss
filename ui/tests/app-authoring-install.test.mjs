import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

test('RE-01/02/04/07: real package publisher serializes competing commits and preserves ABA revisions', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-install-check-'))
  try {
    const result = await promisify(execFile)(Bun.which('node'), [fileURLToPath(new URL('./helpers/app-authoring-install-check.mjs', import.meta.url))], { env: { ...process.env, MOSS_HOME: home }, timeout: 20000 })
    assert.match(result.stdout, /PASS: serialized publish CAS/)
  } finally { await fs.rm(home, { recursive: true, force: true }) }
}, 25000)
