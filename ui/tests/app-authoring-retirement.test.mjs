import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { unzipSync } from 'fflate'
import { isRetiredAppAuthoringResource } from '../../shared/retired-app-authoring-resources.mjs'
import fingerprints from '../../shared/retired-app-authoring-resources.json' with { type: 'json' }
import { MossTools } from '../../src/tools/MossTool/MossTool.ts'
import { normalizeMossToolLoading } from '../src/tool-loading-settings.mjs'

test('CL-01/02/03/04/08: old tools are absent; old loading settings are discarded; Core defines no Builder tools', async () => {
  const old = ['app_build','app_preview','app_publish','app_launch','app_update','app_extract_to_workspace','app_get_versions']
  assert.ok(MossTools.every(tool => !old.includes(tool.name) && !tool.name.startsWith('builder_')))
  const settings = normalizeMossToolLoading(Object.fromEntries(old.map(name => [name, 'always'])))
  assert.ok(old.every(name => !(name in settings)))
  for (const file of ['../src/main.mjs', '../src/app-ipc.mjs', '../../src/Tool.ts']) {
    const source = await fs.readFile(new URL(file, import.meta.url), 'utf8')
    assert.ok(old.every(name => !source.includes(name)), file)
  }
  for (const resource of Object.keys(fingerprints)) await assert.rejects(() => fs.access(new URL(`../../${resource}`, import.meta.url)), /ENOENT/)
})
test('CL-05/06/07/09: only unchanged former system resources retire; custom/modified copies and history survive', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-retired-'))
  try {
    const zip = unzipSync(await fs.readFile(new URL('./fixtures/app-authoring/retired-resources.zip', import.meta.url)))
    for (const [name, value] of Object.entries(zip)) {
      if (name.endsWith('/')) continue
      await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true }); await fs.writeFile(path.join(root, name), value)
    }
    for (const resource of Object.keys(fingerprints)) {
      const directory = path.join(root, resource)
      assert.equal(isRetiredAppAuthoringResource(directory, root), true)
      await fs.writeFile(path.join(directory, 'custom.md'), 'user custom content')
      assert.equal(isRetiredAppAuthoringResource(directory, root), false)
      await fs.access(directory)
    }
    const projectCopy = path.join(root, 'project/assistants/app-builder')
    await fs.mkdir(projectCopy, { recursive: true })
    assert.equal(isRetiredAppAuthoringResource(projectCopy, root), false)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
