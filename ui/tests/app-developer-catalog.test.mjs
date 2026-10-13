import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { developerCatalog } from './helpers/app-authoring-fixture.mjs'
import { contracts } from '../../packages/host-contracts/src/index.mjs'

test('CT-01/02/04/05/07: public catalog covers current protocols, UI signatures, restricted IDs and bounded snapshots', () => {
  const catalog = developerCatalog, contractHash = catalog.info.contractHash
  const all = []; let offset = 0
  do { const page = catalog.list({ offset, limit: 7 }); all.push(...page.items); offset = page.nextOffset } while (offset !== null)
  for (const [protocol, definition] of Object.entries(contracts)) for (const method of Object.keys(definition.methods)) {
    const entry = catalog.get({ kind: 'host', member: `${protocol}/${method}`, contractHash })
    assert.deepEqual(entry.document, definition.methods[method])
  }
  for (const kind of ['manifest', 'ui', 'backend', 'host', 'event', 'sdk']) assert.ok(all.some(entry => entry.kind === kind))
  for (const protocol of ['moss.account/v1', 'moss.agent/v1', 'moss.openim/v1']) assert.ok(all.some(entry => entry.member.startsWith(protocol)))
  const ui = catalog.get({ kind: 'ui', member: 'AppUiApi', contractHash })
  assert.match(ui.document.source, /invoke<Output = unknown>\(name: string, input\??:/)
  assert.throws(() => catalog.get({ kind: 'ui', member: 'AppUiApi', contractHash: 'old' }), /changed/)
  assert.ok(all.some(entry => entry.kind === 'host' && catalog.get({ ...entry, contractHash }).document.apps?.length))
})
test('CT-03/06/08: exported SDK runs offline from an isolated project and rejects modified dependency snapshots', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-sdk-export-'))
  try {
    const exported = await developerCatalog.exportTo(root)
    const script = "import {validateAppManifest} from '@moss/app-sdk'; console.log(validateAppManifest({schemaVersion:2,id:'test.sdk',version:'1.0.0',displayName:'SDK',hostApi:'^3.0.0',permissions:[],ui:{entry:'dist/index.html'}}).id)"
    await fs.writeFile(path.join(root, 'check.mjs'), script)
    assert.equal(execFileSync(Bun.which('node'), ['check.mjs'], { cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8' }).trim(), 'test.sdk')
    await fs.rm(path.join(root, 'node_modules'), { recursive: true })
    await developerCatalog.exportTo(root)
    await fs.appendFile(path.join(exported.path, 'node_modules/ajv/package.json'), ' ')
    await assert.rejects(() => developerCatalog.exportTo(root), /dependency changed/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
