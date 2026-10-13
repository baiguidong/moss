import fs from 'node:fs/promises'
import path from 'node:path'
import { zipSync } from 'fflate'
import { generateMcpApp } from '../packages/app-runtime/src/packages/generate-mcp-app.mjs'

const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const definitionFile = option('--definition'), destination = option('--out')
if (!definitionFile || !destination) {
  console.error('Usage: node scripts/generate-mcp-app.mjs --definition app.json --out empty-directory [--resources directory] [--zip output.zip]')
  process.exitCode = 1
} else {
  const result = await generateMcpApp({ definition: JSON.parse(await fs.readFile(definitionFile, 'utf8')),
    resourcesDir: option('--resources'), destination: path.resolve(destination) })
  const archive = option('--zip')
  if (archive) {
    const files = Object.fromEntries(await Promise.all(result.files.map(async file => [file.relativePath, [new Uint8Array(await fs.readFile(file.absolutePath)), { mtime: new Date('2020-01-01T00:00:00Z') }]])))
    await fs.mkdir(path.dirname(path.resolve(archive)), { recursive: true })
    await fs.writeFile(archive, zipSync(files))
  }
  console.log(JSON.stringify({ appId: result.manifest.id, version: result.manifest.version, ui: result.manifest.ui,
    directory: result.root, archive: archive ? path.resolve(archive) : null, files: result.files.map(file => file.relativePath) }, null, 2))
}
