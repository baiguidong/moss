import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const retired = ['app_build', 'app_preview', 'app_publish', 'app_launch', 'app_update', 'app_extract_to_workspace', 'app_get_versions']
const pattern = new RegExp(`\\b(?:${retired.join('|')})\\b`)
const failures = []
async function scan(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '__tests__'].includes(entry.name)) continue
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) { await scan(file); continue }
    if (!/\.(?:mjs|ts|tsx)$/.test(entry.name) || /\.(?:test|spec)\./.test(entry.name)) continue
    if (pattern.test(await fs.readFile(file, 'utf8'))) failures.push(path.relative(root, file))
  }
}
for (const directory of ['src', 'ui/src']) await scan(path.join(root, directory))
for (const directory of ['assistants/app-builder', 'skills/convert-skill-to-app']) if (existsSync(path.join(root, directory))) failures.push(directory)
if (failures.length) throw new Error(`Retired authoring entry remains: ${failures.join(', ')}`)
console.log('Retired Core authoring tools and bundled resources are absent.')
