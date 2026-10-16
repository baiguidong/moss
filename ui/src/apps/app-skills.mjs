import fs from 'node:fs/promises'
import path from 'node:path'

// App-owned skills remain attached to the enabled, selected installation. No
// copying into a global skill directory and no stale paths after an upgrade.
export async function resolveAppSkills(runtime, selectedAppIds = []) {
  const skills = [], directories = []
  const nodeExecutable = runtime?.supervisor?.nodeExecutable || process.execPath
  const nodeArgs = runtime?.supervisor?.nodeArgs || []
  const env = nodeExecutable === process.execPath && process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}
  if (!runtime) return { skills, directories, prompt: '' }
  for (const installation of runtime.installations.list()) {
    if (!installation.enabled) continue
    const pkg = await runtime.getActivePackage(installation.appId).catch(() => null)
    if (!pkg?.manifest.contributes?.skills?.length) continue
    if (!selectedAppIds.includes(installation.appId)
        && runtime.getToolScope(installation.appId, pkg.manifest.toolScope) !== 'global') continue
    const instance = await runtime.ensureDefaultInstance(installation.appId)
    if (!instance.enabled) continue
    const root = await fs.realpath(pkg.root)
    const dataDir = runtime.appDataPath(runtime.dataDir, installation.appId, 'instances', instance.id)
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 })
    for (const item of pkg.manifest.contributes.skills) {
      const resolve = async name => {
        const file = await fs.realpath(path.join(root, name))
        const relative = path.relative(root, file)
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('App skill escapes package')
        return file
      }
      const skillPath = await resolve(item.path), cliPath = await resolve(item.cli)
      skills.push({ appId: installation.appId, name: item.id, description: item.description, skillPath, cliPath, dataDir, nodeExecutable, nodeArgs, env })
    }
    directories.push(root, dataDir)
  }
  const prompt = skills.length ? 'Available App skills (CLI capabilities). Read the relevant SKILL.md before use. Invoke nodeExecutable with nodeArgs, env and its CLI path, using the supplied --data-dir so results appear in the App. These entries do not grant permission for unrelated filesystem operations.\n'
    + skills.map(skill => JSON.stringify(skill)).join('\n') : ''
  return { skills, directories: [...new Set(directories)], prompt }
}
