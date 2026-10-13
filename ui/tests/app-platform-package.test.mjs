import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { validateAppManifest } from '../../packages/app-sdk/src/index.mjs'
import { validateAppPackage, writePackageChecksums, AppPackageStore } from '../../packages/app-runtime/src/packages/index.mjs'

test('platform allowlists require the new Host contract and survive normalization', () => {
  const manifest = { schemaVersion: 2, id: 'test.platform', version: '1.0.0', displayName: 'Platform', hostApi: '^3.3.0', platforms: ['win32-x64'], ui: { entry: 'index.html' }, permissions: [] }
  assert.deepEqual(validateAppManifest(manifest).platforms, ['win32-x64'])
  assert.throws(() => validateAppManifest({ ...manifest, hostApi: '^3.2.0' }), /platforms requires/)
  assert.throws(() => validateAppManifest({ ...manifest, platforms: [] }), /platforms/)
  assert.throws(() => validateAppManifest({ ...manifest, platforms: ['win32-x64', 'win32-x64'] }), /platforms/)
})

test('package validation and direct local installation reject the wrong platform', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-platform-package-'))
  try {
    const packageRoot = path.join(root, 'package'); await fs.mkdir(packageRoot)
    const foreign = process.platform === 'win32' ? 'darwin-arm64' : 'win32-x64'
    await fs.writeFile(path.join(packageRoot, 'app.moss.json'), JSON.stringify({ schemaVersion: 2, id: 'test.platform', version: '1.0.0', displayName: 'Platform', hostApi: '^3.3.0', platforms: [foreign], ui: { entry: 'index.html' }, permissions: [] }))
    await fs.writeFile(path.join(packageRoot, 'index.html'), '<p>test</p>'); await writePackageChecksums(packageRoot)
    assert.equal((await validateAppPackage(packageRoot, { platform: foreign })).manifest.platforms[0], foreign)
    await assert.rejects(validateAppPackage(packageRoot), /does not support/)
    const store = new AppPackageStore({ appsDir: path.join(root, 'installed') })
    await assert.rejects(store.installFromDirectory(packageRoot), /does not support/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
