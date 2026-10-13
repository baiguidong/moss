import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { copySource, inspectSource, extractSourceArchive, sourceHash } from '../src/apps/app-authoring-source.mjs'
import { writeApp } from './helpers/app-authoring-fixture.mjs'

test('SO-01/02/03/04: snapshots preserve edits, exclude credentials, reject links and artifact-only input', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-source-'))
  try {
    const source = path.join(root, 'src'); await fs.mkdir(source)
    await writeApp({ path: source, appId: 'test.source' })
    await fs.writeFile(path.join(source, '.env'), 'PRIVATE=secret')
    assert.equal((await inspectSource(source)).editable, true)
    const hash = await sourceHash(source), destination = path.join(root, 'copy')
    await copySource(source, destination, hash)
    await assert.rejects(() => fs.stat(path.join(destination, '.env')), /ENOENT/)
    await fs.writeFile(path.join(destination, 'src/index.html'), 'unsaved changes')
    await assert.rejects(() => copySource(source, destination, hash), /EEXIST/)
    assert.equal(await fs.readFile(path.join(destination, 'src/index.html'), 'utf8'), 'unsaved changes')
    await fs.symlink('/tmp', path.join(source, 'outside'))
    await assert.rejects(() => sourceHash(source), /Symbolic/)
    const archive = path.join(root, 'unsafe.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', source, '.'])
    await assert.rejects(() => extractSourceArchive(archive, path.join(root, 'unsafe')), /links/)
    const artifact = path.join(root, 'artifact'); await fs.mkdir(artifact)
    await fs.writeFile(path.join(artifact, 'app.moss.json'), '{}')
    assert.equal((await inspectSource(artifact)).editable, false)
    await fs.rm(path.join(source, 'outside'))
    await fs.rm(path.join(source, 'src'), { recursive: true })
    assert.equal((await inspectSource(source)).editable, false, 'A build script alone is not source')
    await fs.writeFile(path.join(source, 'backend.mjs'), 'export const add=(a,b)=>a+b')
    assert.equal((await inspectSource(source)).editable, true, 'Root Backend source is rebuildable')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
