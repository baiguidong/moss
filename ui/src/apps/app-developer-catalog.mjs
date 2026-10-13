import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { contracts } from '../../../packages/host-contracts/src/index.mjs'
import { APP_HOST_API_VERSION, APP_MANIFEST_SCHEMA } from '../../../packages/app-sdk/src/schemas/index.mjs'
import { APP_SERVICE_PROTOCOL_VERSION } from '../../../packages/app-sdk/src/protocol/index.mjs'
import legacyContracts from '../../../packages/app-sdk/src/host/public-contracts.json' with { type: 'json' }
import { digest, fail, readJson, writeJson } from './app-authoring-source.mjs'

const packageRoot = fileURLToPath(new URL('../../../packages/', import.meta.url))
async function files(root, prefix = '') {
  if ((await fs.lstat(path.join(root, prefix))).isSymbolicLink()) fail('SDK snapshot contains a symbolic link')
  const result = []
  for (const entry of (await fs.readdir(path.join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const relative = path.join(prefix, entry.name)
    if (entry.isSymbolicLink()) fail('SDK snapshot contains a symbolic link')
    if (entry.isDirectory()) result.push(...await files(root, relative))
    else if (entry.isFile()) result.push({ relative, hash: digest(await fs.readFile(path.join(root, relative))) })
  }
  return result
}
async function dependencyRoot(name, from) {
  const resolver = createRequire(path.join(from, 'package.json'))
  let location
  try { location = resolver.resolve(`${name}/package.json`) }
  catch { location = resolver.resolve(name) }
  let directory = path.dirname(location)
  while ((await readJson(path.join(directory, 'package.json'), {})).name !== name) {
    if (directory === path.dirname(directory)) throw new Error(`Missing SDK dependency: ${name}`)
    directory = path.dirname(directory)
  }
  return directory
}

export async function createDeveloperCatalog({ packagesDir = packageRoot } = {}) {
  const sdkRoot = path.join(packagesDir, 'app-sdk'), contractsRoot = path.join(packagesDir, 'host-contracts')
  const sdk = await readJson(path.join(sdkRoot, 'package.json'))
  const entries = [{ kind: 'manifest', member: 'app.moss.json', document: APP_MANIFEST_SCHEMA }]
  for (const [protocol, definition] of Object.entries({ ...legacyContracts, ...contracts })) {
    for (const [name, document] of Object.entries(definition.methods)) entries.push({ kind: 'host', member: `${protocol}/${name}`, document })
    for (const [name, document] of Object.entries(definition.events)) entries.push({ kind: 'event', member: `${protocol}/${name}`, document })
  }
  // Legacy DTO schemas are accompanied by their actual public validators, including
  // bounds and cross-field rules that TypeScript alone cannot express.
  for (const name of ['account', 'agent', 'openim']) entries.push({ kind: 'validation', member: `moss.${name}/v1`, document: {
    format: 'javascript', source: await fs.readFile(path.join(sdkRoot, `src/${name}/index.mjs`), 'utf8'),
  } })
  // These public declaration files include UI signatures, appearance and service lifecycle.
  for (const [member, descriptor] of Object.entries(sdk.exports)) {
    entries.push({ kind: 'sdk', member, document: { format: 'typescript', source: await fs.readFile(path.join(sdkRoot, descriptor.types), 'utf8'), runtime: descriptor.import } })
  }
  const publicTypes = await fs.readFile(path.join(sdkRoot, 'src/index.d.mts'), 'utf8')
  entries.push({ kind: 'ui', member: 'AppUiApi', document: { format: 'typescript', source: publicTypes.slice(publicTypes.indexOf('export interface AppAppearance'), publicTypes.indexOf('export class AppServiceError')) } })
  entries.push({ kind: 'backend', member: 'service', document: { format: 'typescript', source: publicTypes, protocolVersion: APP_SERVICE_PROTOCOL_VERSION } })
  const dependencyRoots = new Map()
  async function visitDependencies(root) {
    for (const name of Object.keys((await readJson(path.join(root, 'package.json'))).dependencies || {}).sort()) {
      if (name.startsWith('@moss/') || dependencyRoots.has(name)) continue
      const resolved = await dependencyRoot(name, root)
      dependencyRoots.set(name, resolved)
      await visitDependencies(resolved)
    }
  }
  await visitDependencies(sdkRoot)
  await visitDependencies(contractsRoot)
  const sdkFiles = { sdk: await files(sdkRoot), contracts: await files(contractsRoot), dependencies: {} }
  for (const [name, root] of dependencyRoots) sdkFiles.dependencies[name] = await files(root)
  const info = { hostApiVersion: APP_HOST_API_VERSION, sdkVersion: sdk.version, manifestSchemaVersion: 2, contractHash: digest(entries), sdkHash: digest(sdkFiles) }
  return {
    info,
    list({ kind, offset = 0, limit = 50 } = {}) {
      const matching = entries.filter(entry => !kind || entry.kind === kind)
      return { contractHash: info.contractHash, items: matching.slice(offset, offset + limit).map(({ kind, member }) => ({ kind, member })), nextOffset: offset + limit < matching.length ? offset + limit : null }
    },
    get({ kind, member, contractHash }) {
      if (contractHash !== info.contractHash) fail('Developer contract snapshot changed')
      const entry = entries.find(item => item.kind === kind && item.member === member)
      if (!entry) fail('Unknown developer contract')
      const result = { ...entry, contractHash }
      if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) fail('Contract exceeds response limit; use SDK export')
      return structuredClone(result)
    },
    async exportTo(projectRoot) {
      const destination = path.join(projectRoot, '.moss-sdk')
      for (const candidate of [destination, path.join(projectRoot, 'node_modules'), path.join(projectRoot, 'node_modules', '@moss')]) {
        const stat = await fs.lstat(candidate).catch(error => { if (error.code === 'ENOENT') return null; throw error })
        if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) fail('SDK export destination must be a real project directory')
      }
      const existing = await readJson(path.join(destination, 'snapshot.json'), null)
      if (existing && (existing.sdkHash !== info.sdkHash || existing.contractHash !== info.contractHash)) fail('SDK snapshot changed; prepare a new project or refresh its SDK explicitly')
      if (existing) {
        // Verify the snapshot before reusing it; never follow modified export links.
        for (const [name, expected] of [['app-sdk', sdkFiles.sdk], ['host-contracts', sdkFiles.contracts]]) {
          if (digest(await files(path.join(destination, 'packages', name))) !== digest(expected)) fail('Exported SDK files changed; restore or remove the SDK snapshot before refreshing')
        }
        for (const [name, expected] of Object.entries(sdkFiles.dependencies)) {
          if (digest(await files(path.join(destination, 'node_modules', name))) !== digest(expected)) fail('Exported SDK dependency changed')
        }
      }
      if (!existing) {
      const entries = await fs.readdir(destination).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      if (entries.length) fail('SDK export destination is not empty')
      await fs.mkdir(destination, { recursive: true })
      for (const [name, root] of [['app-sdk', sdkRoot], ['host-contracts', contractsRoot]]) {
        await fs.cp(root, path.join(destination, 'packages', name), { recursive: true, filter: file => !file.split(path.sep).includes('node_modules') })
      }
      for (const [name, root] of dependencyRoots) await fs.cp(root, path.join(destination, 'node_modules', name), { recursive: true, dereference: true })
      }
      for (const name of ['app-sdk', 'host-contracts']) {
        const link = path.join(projectRoot, 'node_modules', '@moss', name)
        await fs.mkdir(path.dirname(link), { recursive: true })
        try { await fs.symlink(path.join(destination, 'packages', name), link, process.platform === 'win32' ? 'junction' : 'dir') }
        catch (error) { if (error.code !== 'EEXIST') throw error; if (await fs.realpath(link) !== path.join(destination, 'packages', name)) fail(`Existing SDK dependency differs: ${name}`) }
      }
      await writeJson(path.join(destination, 'snapshot.json'), info)
      return { path: destination, sdkHash: info.sdkHash, contractHash: info.contractHash }
    },
  }
}
