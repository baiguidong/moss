import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { attachSourcePackage, validateSourcePackage, copySourceTree, restoreSourceModes } from '../src/packages/source.mjs'

test('source descriptor binds runtime, source, toolchain and executable inputs', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'source-format-'))
  try {
    const project = path.join(temp, 'project'), pkg = path.join(temp, 'package')
    await fs.mkdir(path.join(project, 'src'), { recursive: true }); await fs.mkdir(pkg)
    const manifest = { id: 'test.source', version: '1.0.0' }
    for (const root of [project, pkg]) await fs.writeFile(path.join(root, 'app.moss.json'), JSON.stringify(manifest))
    await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'source-test', packageManager: 'npm@10.9.0', scripts: { build: 'node src/build.mjs' } }))
    await fs.writeFile(path.join(project, 'src/build.mjs'), '#!/usr/bin/env node\nconsole.log("build")', { mode: 0o755 })
    await fs.mkdir(path.join(project, 'schemas')); await fs.writeFile(path.join(project, 'schemas/secrets.json'), '{"type":"object"}')
    await fs.writeFile(path.join(project, '.env'), 'SECRET=excluded')
    const descriptor = await attachSourcePackage(pkg, project)
    await assert.rejects(() => fs.access(path.join(pkg, 'source/.env')))
    await fs.access(path.join(pkg, 'source/schemas/secrets.json'))
    const restored = path.join(temp, 'restored'); await copySourceTree(path.join(pkg, 'source'), restored)
    await restoreSourceModes(restored, descriptor)
    if (process.platform !== 'win32') assert((await fs.stat(path.join(restored, 'src/build.mjs'))).mode & 0o111)
    assert.equal((await validateSourcePackage(pkg)).descriptor.appId, manifest.id)
    await fs.writeFile(path.join(pkg, 'source/src/build.mjs'), 'tampered')
    await assert.rejects(() => validateSourcePackage(pkg), /hash differs/)
    await fs.rm(path.join(pkg, 'source-manifest.json'))
    assert.equal(await validateSourcePackage(pkg), null)
    await assert.rejects(() => validateSourcePackage(pkg, { required: true }), /source is required/)
  } finally { await fs.rm(temp, { recursive: true, force: true }) }
})
