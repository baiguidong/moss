import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import semver from 'semver'
import { createBuiltinDownloader, stageBuiltinArchive } from './download-builtin-app.mjs'
const core = fileURLToPath(new URL('../..', import.meta.url))
export async function prepareBuiltinApps({ platform = `${process.platform}-${process.arch}`, output = path.join(core, 'ui/dist/builtin-apps'), localArchives = {}, download, selection, trustedPublishers } = {}) {
  selection ||= JSON.parse(await fs.readFile(path.join(core, 'packages/app-sdk/src/builtin-apps.json'), 'utf8'))
  for (const id of Object.keys(localArchives)) if (!selection.apps.includes(id)) throw new Error(`Unknown builtin App override: ${id}`)
  for (const id of selection.apps) if (!semver.valid(selection.versions?.[id])) throw new Error(`An exact builtin App version is required: ${id}`)
  const staged = `${output}.staging`
  await fs.rm(staged, { recursive: true, force: true }); await fs.mkdir(staged, { recursive: true })
  const entries = [], omitted = []
  try {
    const fetchBuiltin = createBuiltinDownloader({ download, trustedPublishers })
    for (const id of selection.apps) {
      const version = selection.versions[id]
      if (localArchives[id]) {
        const entry = await stageBuiltinArchive({ bytes: await fs.readFile(localArchives[id]), directory: staged, id, version, platform, requireTrustedPublisher: false })
        entries.push({ ...entry, source: 'local-archive' })
        continue
      }
      const entry = await fetchBuiltin(id, staged, platform, version)
      if (entry) entries.push(entry)
      else omitted.push({ id, version, reason: `Unsupported platform: ${platform}` })
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
  if (process.argv.includes('--build-local') || process.argv.includes('--reuse-packages')) throw new Error('Build App releases in moss-apps; Moss bundles pinned published archives only')
  await prepareBuiltinApps({ ...(target ? { platform: target } : {}), localArchives })
}
