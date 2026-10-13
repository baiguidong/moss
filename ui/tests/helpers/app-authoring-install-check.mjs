// Run in a separate process with MOSS_HOME set to a disposable directory.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { writePackageChecksums } from '../../../packages/app-runtime/src/index.mjs'
import { APPS_DIR, publishAppFromBuild, getAppInstallationRevision, rollbackAppToVersion, deleteApp, setAppInstallationActivation, listAppsFromRegistry } from '../../src/app-platform.mjs'
const home = process.env.MOSS_HOME, id = 'test.install-cas'
assert.ok(home?.includes('moss-install-check-'))
async function packageFor(version, body = version) {
  const root = path.join(home, `source-${version}-${body}`)
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(path.join(root, 'index.html'), body)
  await fs.writeFile(path.join(root, 'app.moss.json'), JSON.stringify({ schemaVersion: 2, id, version, displayName: 'CAS fixture', category: version === '1.0.0' ? 'knowledge' : 'automation', keywords: [version], hostApi: '^3.0.0', permissions: [], ui: { entry: 'index.html' } }))
  await writePackageChecksums(root)
  return root
}
const [one, two, three] = await Promise.all(['1.0.0', '2.0.0', '3.0.0'].map(v => packageFor(v)))
const current = async () => JSON.parse(await fs.readFile(path.join(APPS_DIR, id, 'current.json'))).version
await publishAppFromBuild(one, { expectedBaseVersion: null, expectedInstallationRevision: 0 })
assert.equal(getAppInstallationRevision(id), 1)
assert.equal(listAppsFromRegistry()[0].category, 'knowledge')
assert.deepEqual(listAppsFromRegistry()[0].keywords, ['1.0.0'])
const results = await Promise.allSettled([two, three].map(root => publishAppFromBuild(root, { expectedBaseVersion: '1.0.0', expectedInstallationRevision: 1 })))
assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
assert.equal(results.filter(result => result.status === 'rejected').length, 1)
assert.equal(await current(), '2.0.0')
assert.equal(getAppInstallationRevision(id), 2)
assert.equal(listAppsFromRegistry()[0].category, 'automation')
assert.deepEqual(listAppsFromRegistry()[0].keywords, ['2.0.0'])
rollbackAppToVersion(id, '1.0.0')
assert.equal(getAppInstallationRevision(id), 3)
assert.equal(listAppsFromRegistry()[0].category, 'knowledge')
assert.deepEqual(listAppsFromRegistry()[0].keywords, ['1.0.0'])
await assert.rejects(() => publishAppFromBuild(three, { expectedBaseVersion: '1.0.0', expectedInstallationRevision: 1 }), /changed/)
await assert.rejects(() => publishAppFromBuild(three, { validateCommit: () => { throw new Error('grants changed') } }), /grants changed/)
assert.equal(await current(), '1.0.0')
const different = await packageFor('1.0.0', 'different')
await assert.rejects(() => publishAppFromBuild(different), /immutable|different|already|checksum/i)
setAppInstallationActivation(async () => { rollbackAppToVersion(id, '1.0.0'); throw new Error('activation failed') })
await assert.rejects(() => publishAppFromBuild(three, { expectedBaseVersion: '1.0.0', expectedInstallationRevision: 3 }), /activation failed/)
assert.equal(await current(), '1.0.0')
assert.equal(getAppInstallationRevision(id), 5)
setAppInstallationActivation(null)
await deleteApp(id)
assert.equal(getAppInstallationRevision(id), 6)
await publishAppFromBuild(one, { expectedBaseVersion: null, expectedInstallationRevision: 6 })
assert.equal(getAppInstallationRevision(id), 7)
console.log('PASS: serialized publish CAS, same-version immutability, grants guard, activation rollback and uninstall/reinstall ABA')
