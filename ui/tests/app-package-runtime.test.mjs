import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { verifyPackageRuntime } from '../../packages/app-runtime/src/packages/verify-runtime.mjs'

const nodeExecutable = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim()

async function fixture({ storage = 'session', method = 'scopes.pending' } = {}, run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-package-runtime-test-'))
  try {
    await fs.writeFile(path.join(root, 'app.moss.json'), JSON.stringify({
      id: 'test.session-runtime', version: '1.0.0',
      backend: { entry: 'main.mjs', storage },
      host: { protocols: ['moss.session-storage/v1'] },
    }))
    const source = path.join(root, 'main.src.mjs')
    await fs.writeFile(source, `
import assert from 'node:assert/strict'
import { AppBackendClient } from ${JSON.stringify(fileURLToPath(new URL('../../packages/app-sdk/src/client/index.mjs', import.meta.url)))}
const backend = new AppBackendClient({
  async onInitialize() {
    const scopes = await backend.host.request('moss.session-storage/v1', ${JSON.stringify(method)}, {})
    assert.deepEqual(scopes, [])
  },
  onFatalError(error) { console.error(error.message); process.exit(1) },
})
backend.start()
`)
    execFileSync('bun', ['build', source, '--target=node', '--format=esm', '--outfile', path.join(root, 'main.mjs')], { stdio: 'pipe' })
    await fs.rm(source)
    await run(root)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('package verification starts a session App with no pending user sessions', async () => {
  await fixture({}, async root => {
    assert.deepEqual(await verifyPackageRuntime(root, { nodeExecutable }), { backend: 'handshake-passed' })
  })
})

test('package verification keeps session storage mutations and non-session Apps unavailable', async () => {
  for (const options of [{ method: 'scopes.create' }, { storage: 'app' }]) {
    await fixture(options, async root => {
      await assert.rejects(verifyPackageRuntime(root, { nodeExecutable }), /Host service is unavailable in package verification/)
    })
  }
})
