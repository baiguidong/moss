import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createBuiltinDownloader, stageBuiltinArchive } from './download-builtin-app.mjs'
const core = fileURLToPath(new URL('../..', import.meta.url))
const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Builtin App build failed (${code})`)))
})
export async function prepareBuiltinApps({ platform = `${process.platform}-${process.arch}`, appsRoot = process.env.MOSS_APPS_ROOT || path.resolve(core, '../moss-apps'), output = path.join(core, 'ui/dist/builtin-apps'), build = true, useMarketplace = true, localArchives = {}, download } = {}) {
  const selection = JSON.parse(await fs.readFile(path.join(core, 'packages/app-sdk/src/builtin-apps.json'), 'utf8'))
  for (const id of Object.keys(localArchives)) if (!selection.apps.includes(id)) throw new Error(`Unknown builtin App override: ${id}`)
  const staged = `${output}.staging`
  await fs.rm(staged, { recursive: true, force: true }); await fs.mkdir(staged, { recursive: true })
  const entries = [], omitted = []
  try {
    const fetchBuiltin = createBuiltinDownloader({ download })
    const directories = await fs.readdir(path.join(appsRoot, 'apps'), { withFileTypes: true })
    const manifests = new Map()
    for (const directory of directories.filter(item => item.isDirectory())) {
      try { const manifest = JSON.parse(await fs.readFile(path.join(appsRoot, 'apps', directory.name, 'app.moss.json'), 'utf8')); manifests.set(manifest.id, manifest) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    for (const id of selection.apps) {
      if (localArchives[id]) {
        const entry = await stageBuiltinArchive({ bytes: await fs.readFile(localArchives[id]), directory: staged, id, platform, requireTrustedPublisher: false })
        entries.push({ ...entry, source: 'local-archive' })
        continue
      }
      if (useMarketplace && selection.downloadLatest?.includes(id)) {
        const entry = await fetchBuiltin(id, staged, platform)
        if (entry) entries.push(entry)
        else omitted.push({ id, reason: `Unsupported platform: ${platform}` })
        continue
      }
      const manifest = manifests.get(id)
      if (!manifest) throw new Error(`Missing builtin App source: ${id} in ${appsRoot}`)
      if (manifest.platforms && !manifest.platforms.includes(platform)) { omitted.push({ id, reason: `Unsupported platform: ${platform}` }); continue }
      if (build) await run(process.execPath, ['scripts/package-app.mjs', '--app', id, ...(manifest.platforms ? ['--platform', platform] : [])], appsRoot)
      const archive = `${id}-${manifest.version}${manifest.platforms ? `-${platform}` : ''}.zip`
      const source = path.join(appsRoot, 'artifacts', id, manifest.version, archive)
      const bytes = await fs.readFile(source)
      await fs.copyFile(source, path.join(staged, archive))
      entries.push({ id, version: manifest.version, displayName: manifest.displayName, description: manifest.description, archive, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
    await fs.writeFile(path.join(staged, 'manifest.json'), JSON.stringify({ schemaVersion: 1, platform, apps: entries, omitted }, null, 2) + '\n')
    await fs.rm(output, { recursive: true, force: true }); await fs.rename(staged, output)
    console.log(`Bundled ${entries.length} Apps for ${platform}${omitted.length ? `; unavailable: ${omitted.map(e => e.id).join(', ')}` : ''}`)
    return entries
  } catch (error) { await fs.rm(staged, { recursive: true, force: true }); throw error }
}
// Electron Builder invokes this before copying extraResources for every target.
export default async function beforePack(context) {
  const arch = typeof context.arch === 'string' ? context.arch : ({ 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' })[context.arch]
  if (!arch) throw new Error(`Unsupported package architecture: ${context.arch}`)
  await prepareBuiltinApps({ platform: `${context.electronPlatformName}-${arch}` })
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const target = process.argv.find(arg => arg.startsWith('--platform='))?.slice(11)
  const localArchives = Object.fromEntries(process.argv.filter(arg => arg.startsWith('--local-archive=')).map(arg => {
    const value = arg.slice('--local-archive='.length), separator = value.indexOf('=')
    if (separator < 1 || !value.slice(separator + 1)) throw new Error('Use --local-archive=app.id=/absolute/path.zip')
    return [value.slice(0, separator), path.resolve(value.slice(separator + 1))]
  }))
  await prepareBuiltinApps({ ...(target ? { platform: target } : {}), build: !process.argv.includes('--reuse-packages'), useMarketplace: !process.argv.includes('--build-local'), localArchives })
}
