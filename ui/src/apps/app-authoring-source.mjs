import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createReadStream, createWriteStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { APP_ERROR_CODES, AppServiceError } from '../../../packages/app-sdk/src/errors.mjs'
import { copySourceTree, excludeSourceEntry } from '../../../packages/app-runtime/src/packages/source.mjs'

const exec = promisify(execFile)
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
export const fail = (message, code = APP_ERROR_CODES.conflict) => { throw new AppServiceError(code, message) }
export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) }
  catch (error) { if (fallback !== undefined && error.code === 'ENOENT') return fallback; throw error }
}
export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(temporary, file)
}
export function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail('Path is outside the bound project', APP_ERROR_CODES.permissionDenied)
  return path.resolve(candidate)
}
export async function realInside(root, candidate) { return inside(await fs.realpath(root), await fs.realpath(candidate)) }
const ignored = (name, relative) => name === '.moss-sdk' || excludeSourceEntry(name, relative)

export async function sourceFiles(root, { packageFiles = false } = {}) {
  const files = []
  let bytes = 0
  async function visit(relative) {
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name)
      if (!packageFiles && ignored(entry.name, name.replaceAll(path.sep, '/'))) continue
      const file = path.join(root, name)
      const stat = await fs.lstat(file)
      if (stat.isSymbolicLink()) fail(`Symbolic links are not accepted in source snapshots: ${name}`, APP_ERROR_CODES.permissionDenied)
      if (stat.isDirectory()) { await visit(name); continue }
      if (!stat.isFile()) fail(`Unsupported source entry: ${name}`)
      bytes += stat.size
      if (stat.size > 100 * 1024 * 1024 || bytes > 250 * 1024 * 1024 || files.length >= 20000) fail('Source exceeds snapshot limits', APP_ERROR_CODES.resourceExhausted)
      files.push({ name: name.replaceAll(path.sep, '/'), hash: digest(await fs.readFile(file)), mode: stat.mode & 0o777 })
    }
  }
  await visit('')
  return files
}
export async function sourceHash(root, options) { return digest(await sourceFiles(root, options)) }
export async function copySource(root, destination, expectedHash, { includeSdk = false } = {}) {
  if (includeSdk) {
    const before = await sourceHash(root)
    if (expectedHash && before !== expectedHash) fail('Source changed; inspect it before building')
    await fs.mkdir(destination, { recursive: false })
    try {
      await copySourceTree(root, destination, { includeSdk: true })
      if (await sourceHash(root) !== before || await sourceHash(destination) !== before) fail('Source changed during snapshot')
      return before
    } catch (error) { await fs.rm(destination, { recursive: true, force: true }); throw error }
  }
  const before = await sourceFiles(root)
  if (expectedHash && digest(before) !== expectedHash) fail('Source changed; inspect it before building')
  await fs.mkdir(destination, { recursive: false })
  try {
    for (const file of before) {
      const source = path.join(root, file.name), target = path.join(destination, file.name)
      await realInside(root, source)
      if ((await fs.lstat(source)).isSymbolicLink()) fail('Source changed during snapshot')
      const data = await fs.readFile(source)
      if (digest(data) !== file.hash) fail('Source changed during snapshot')
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, data, { flag: 'wx', mode: file.mode })
    }
    if (digest(await sourceFiles(root)) !== digest(before) || await sourceHash(destination) !== digest(before)) fail('Source changed during snapshot')
    return digest(before)
  } catch (error) { await fs.rm(destination, { recursive: true, force: true }); throw error }
}
export async function inspectSource(root, { appRoot = '.' } = {}) {
  const appPath = inside(root, path.resolve(root, appRoot))
  const manifest = await readJson(path.join(appPath, 'app.moss.json'), null)
  const pkg = await readJson(path.join(appPath, 'package.json'), null)
  const missing = []
  if (!manifest) missing.push('app.moss.json')
  if (!pkg?.scripts?.build) missing.push('package.json scripts.build')
  if (pkg && Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length) {
    const entries = await fs.readdir(root)
    if (!entries.some(name => ['bun.lock', 'bun.lockb', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].includes(name))) missing.push('dependency lockfile')
  }
  const files = await sourceFiles(root)
  const appFiles = appRoot === '.' ? files : files.filter(file => file.name.startsWith(appRoot + '/')).map(file => ({ ...file, name: file.name.slice(appRoot.length + 1) }))
  if (!appFiles.some(file => /^(?:src\/|public\/|index\.)/.test(file.name)
    || (!file.name.includes('/') && /\.(?:[cm]?js|tsx?|jsx|html|py)$/.test(file.name) && !/^(?:build|vite\.config|webpack\.config|rollup\.config|eslint\.config|postcss\.config)\./.test(file.name)))) missing.push('editable source files (src/, public/, or root source modules)')
  return { editable: !missing.length, missing, sourceHash: digest(files), appId: manifest?.id || null, version: manifest?.version || null, hostApi: manifest?.hostApi || null }
}
export async function extractSourceArchive(archive, destination) {
  const expanded = `${destination}.${randomUUID()}.tar`
  let bytes = 0
  try {
  // Bound decompression before extraction, including ignored build/cache entries.
  await pipeline(createReadStream(archive), createGunzip(), new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length
    callback(bytes > 260 * 1024 * 1024 ? new Error('Source archive exceeds expanded size limit') : null, chunk)
  } }), createWriteStream(expanded, { flags: 'wx', mode: 0o600 }), { signal: AbortSignal.timeout(30000) })
  // Validate both names and entry types before invoking the platform tar reader.
  const { stdout: names } = await exec('tar', ['-tf', expanded], { maxBuffer: 4 * 1024 * 1024, timeout: 30000 })
  const { stdout: entries } = await exec('tar', ['-tvf', expanded], { maxBuffer: 8 * 1024 * 1024, timeout: 30000 })
  const seen = new Set()
  for (const name of names.split('\n').filter(Boolean)) {
    if (name === '.' || name === './') continue
    const normalized = name.replace(/^\.\//, '').replace(/\/$/, '')
    if (!normalized || name.includes('\\') || /^[A-Za-z]:|^\//.test(normalized) || normalized.split('/').includes('..') || seen.has(normalized)) fail('Unsafe or duplicate source archive path', APP_ERROR_CODES.permissionDenied)
    seen.add(normalized)
    inside(destination, path.join(destination, normalized))
  }
  if (seen.size > 20000 || entries.split('\n').filter(Boolean).some(line => !['-', 'd'].includes(line[0]))) fail('Source archive contains links or unsupported entries', APP_ERROR_CODES.permissionDenied)
  await fs.mkdir(destination, { recursive: false })
  try {
    await exec('tar', ['-xf', expanded, '-C', destination], { maxBuffer: 4 * 1024 * 1024, timeout: 30000 })
    await sourceFiles(destination)
    return destination
  } catch (error) { await fs.rm(destination, { recursive: true, force: true }); throw error }
  } finally { await fs.rm(expanded, { force: true }) }
}
