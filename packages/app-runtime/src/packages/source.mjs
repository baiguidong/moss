import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import Ajv from 'ajv'
import { APP_ERROR_CODES, AppServiceError } from '../../../app-sdk/src/errors.mjs'

export const SOURCE_MANIFEST = 'source-manifest.json'
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex')
const invalid = message => { throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `App source: ${message}`) }
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'))
const exists = async file => fs.access(file).then(() => true, () => false)
const relativePath = { type: 'string', minLength: 1, maxLength: 4096 }
const command = { type: 'object', additionalProperties: false, required: ['cwd', 'argv'], properties: {
  cwd: relativePath, argv: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'string', maxLength: 4096 } },
} }
export const APP_SOURCE_MANIFEST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'appId', 'version', 'sourceRoot', 'appRoot', 'origin', 'toolchain', 'lockfile', 'commands', 'sdk', 'files', 'sourceHash', 'runtimeHash'],
  properties: {
    schemaVersion: { const: 1 }, appId: { type: 'string', minLength: 1 }, version: { type: 'string', minLength: 1 },
    sourceRoot: { const: 'source' }, appRoot: relativePath,
    origin: { type: 'object', required: ['kind'], properties: { kind: { enum: ['repository', 'builder'] } } },
    toolchain: { type: 'object', required: ['node', 'packageManager'], properties: {
      node: { type: 'string', minLength: 1 }, packageManager: { type: 'object', required: ['name', 'version'], properties: {
        name: { enum: ['npm', 'bun'] }, version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:[-+].*)?$' },
      }, additionalProperties: false },
    }, additionalProperties: false },
    lockfile: { anyOf: [relativePath, { type: 'null' }] },
    commands: { type: 'object', required: ['build'], additionalProperties: false, properties: { install: command, check: command, test: command, build: command } },
    sdk: { type: 'object' },
    files: { type: 'array', minItems: 1, maxItems: 10000, items: {
      type: 'object', additionalProperties: false, required: ['path', 'size', 'sha256'], properties: {
        path: relativePath, executable: { type: 'boolean' }, size: { type: 'integer', minimum: 0 }, sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
    } },
    sourceHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, runtimeHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  },
}
const validateDescriptor = new Ajv({ allErrors: true, strict: false }).compile(APP_SOURCE_MANIFEST_SCHEMA)

export function sourcePath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || /^(?:\/|[a-z]:)/i.test(relative)
    || relative.split('/').includes('..')) invalid(`unsafe path: ${relative}`)
  const target = path.resolve(root, relative)
  if (target !== path.resolve(root) && !target.startsWith(path.resolve(root) + path.sep)) invalid(`path escapes source: ${relative}`)
  return target
}

export function excludeSourceEntry(name, relative = name) {
  if (/(?:^|\/)schemas\/(?:.*\/)?(?:secrets|credentials)(?:\.[^/]*)?\.json$/.test(relative) || /(?:^|\/)schemas\/(?:secrets|credentials)\.json$/.test(relative)) return false
  return ['node_modules', '.git', 'dist', 'build', 'coverage', '.cache', '.tmp', '.DS_Store', '.npmrc', '.pypirc', '.secrets', 'artifacts', 'test-results', 'playwright-report'].includes(name)
    || name.startsWith('._') || (/^\.env(?:\.|$)/i.test(name) && !/^\.env\.(?:example|sample|template)$/i.test(name))
    || /^(?:credentials|secrets)(?:\.|$)/i.test(name) || /\.(?:pem|key|log)$/i.test(name)
}

/** No links, external paths or undeclared files; hashes are platform independent. */
export async function sourceFileList(root, { filter = () => true } = {}) {
  if ((await fs.lstat(root)).isSymbolicLink()) invalid('source root must not be a symbolic link')
  const result = []; let bytes = 0
  async function visit(relative) {
    for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = relative ? `${relative}/${entry.name}` : entry.name
      if (!filter(name, entry)) continue
      const file = sourcePath(root, name), stat = await fs.lstat(file)
      if (stat.isSymbolicLink()) invalid(`symbolic link: ${name}`)
      if (stat.isDirectory()) { await visit(name); continue }
      if (!stat.isFile()) invalid(`unsupported file: ${name}`)
      bytes += stat.size
      if (stat.size > 50 * 1024 * 1024 || bytes > 250 * 1024 * 1024 || result.length >= 10000) invalid('source exceeds package limits')
      result.push({ path: name, size: stat.size, sha256: hash(await fs.readFile(file)) })
    }
  }
  await visit('')
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

export async function copySourceTree(root, destination, { includeSdk = false } = {}) {
  // The generated SDK contains only its pinned dependency closure. Never copy the
  // project's node_modules or follow its SDK/workspace links into another tree.
  const filter = (name, entry) => includeSdk && (name === '.moss-sdk' || name.startsWith('.moss-sdk/'))
    ? !['.git', '.DS_Store'].includes(entry.name) : entry.name !== '.moss-sdk' && !excludeSourceEntry(entry.name, name)
  const files = await sourceFileList(root, { filter })
  await fs.mkdir(destination, { recursive: true })
  for (const file of files) {
    const from = sourcePath(root, file.path), to = sourcePath(destination, file.path)
    const data = await fs.readFile(from)
    if (hash(data) !== file.sha256 || (await fs.lstat(from)).isSymbolicLink()) invalid('source changed during copy')
    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.writeFile(to, data, { flag: 'wx', mode: (await fs.stat(from)).mode & 0o777 })
  }
  if (hash(await sourceFileList(root, { filter })) !== hash(files)) invalid('source changed during copy')
  return files
}

export async function inspectSourceProject(root, { appRoot = '.', packageManagerVersion } = {}) {
  const appPath = sourcePath(root, appRoot)
  const manifest = await json(path.join(appPath, 'app.moss.json'))
  const pkg = await json(path.join(appPath, 'package.json'))
  const workspace = await json(path.join(root, 'package.json'))
  if (!pkg.scripts?.build) invalid('missing package.json scripts.build')
  const declared = workspace.packageManager || pkg.packageManager || ''
  const manager = declared.split('@')[0] || (await exists(path.join(root, 'bun.lock')) ? 'bun' : 'npm')
  if (!['bun', 'npm'].includes(manager)) invalid(`unsupported package manager: ${manager}`)
  const lockfile = manager === 'bun' ? 'bun.lock' : 'package-lock.json'
  const hasLock = await exists(path.join(root, lockfile))
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies, ...workspace.dependencies, ...workspace.devDependencies }
  if (Object.keys(dependencies).length && !hasLock) invalid(`missing ${lockfile}`)
  const files = await sourceFileList(appPath, { filter: (name, entry) => entry.name !== '.moss-sdk' && !excludeSourceEntry(entry.name, name) })
  if (!files.some(file => /^(src\/|public\/|index\.)/.test(file.path) || (!file.path.includes('/') && /\.(?:[cm]?js|tsx?|jsx|html|py)$/.test(file.path) && !/^(?:build|vite\.config|webpack\.config|rollup\.config|eslint\.config|postcss\.config)\./.test(file.path)))) invalid('missing editable source files')
  const workspaces = Array.isArray(workspace.workspaces) ? workspace.workspaces : workspace.workspaces?.packages || []
  // Exported workspaces must be explicit, so validation never guesses which
  // sibling projects an original monorepo glob happened to include.
  const packageRoots = [root, ...await Promise.all(workspaces.map(async relative => {
    if (relative.includes('*')) invalid('exported workspace paths must be explicit')
    const directory = sourcePath(root, relative)
    await json(path.join(directory, 'package.json'))
    return directory
  }))]
  const names = new Set(await Promise.all(packageRoots.map(async dir => (await json(path.join(dir, 'package.json'))).name)))
  for (const directory of new Set([...packageRoots, appPath])) {
    const data = await json(path.join(directory, 'package.json'))
    for (const [name, version] of Object.entries({ ...data.dependencies, ...data.devDependencies, ...data.optionalDependencies })) {
      if (version.startsWith('workspace:') && !names.has(name)) invalid(`missing workspace dependency: ${name}`)
      if (/^(?:file|link):/.test(version)) {
        const target = path.resolve(directory, version.slice(version.indexOf(':') + 1))
        sourcePath(root, path.relative(root, target).split(path.sep).join('/'))
        if (!await exists(path.join(target, 'package.json'))) invalid(`missing local dependency: ${name}`)
      }
    }
  }
  const commands = { ...(hasLock ? { install: { cwd: '.', argv: [manager, ...(manager === 'bun' ? ['install', '--frozen-lockfile'] : ['ci'])] } } : {}) }
  for (const script of ['check', 'test', 'build']) if (pkg.scripts?.[script]) commands[script] = { cwd: appRoot, argv: [manager, 'run', script] }
  const version = declared.slice(manager.length + 1) || packageManagerVersion
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version || '')) invalid('a precise package manager version is required')
  return { manifest, appPath, appRoot, lockfile: hasLock ? lockfile : null, toolchain: { node: process.versions.node, packageManager: { name: manager, version } }, commands }
}

export async function runtimeFileList(root) {
  return sourceFileList(root, { filter: name => !['source', SOURCE_MANIFEST, 'checksums.json', 'app-signature.json'].includes(name) })
}

export async function attachSourcePackage(packageRoot, sourceRoot, options = {}) {
  const appRoot = options.appRoot || '.'
  const project = await inspectSourceProject(sourceRoot, { appRoot, packageManagerVersion: options.packageManagerVersion })
  const manifest = await json(path.join(packageRoot, 'app.moss.json'))
  if (manifest.id !== project.manifest.id || manifest.version !== project.manifest.version) invalid('source identity does not match runtime')
  const destination = path.join(packageRoot, 'source')
  if (await exists(destination)) invalid('source package already exists')
  await copySourceTree(sourceRoot, destination, { includeSdk: true })
  const files = await sourceFileList(destination)
  for (const file of files) if ((await fs.stat(sourcePath(destination, file.path))).mode & 0o111) file.executable = true
  const descriptor = {
    schemaVersion: 1, appId: manifest.id, version: manifest.version, sourceRoot: 'source', appRoot,
    origin: options.origin || { kind: 'builder' }, toolchain: options.toolchain || project.toolchain,
    lockfile: project.lockfile, commands: project.commands, sdk: options.sdk || {}, files,
    sourceHash: hash(files), runtimeHash: hash(await runtimeFileList(packageRoot)),
  }
  await fs.writeFile(path.join(packageRoot, SOURCE_MANIFEST), JSON.stringify(descriptor, null, 2) + '\n')
  await validateSourcePackage(packageRoot, { required: true })
  return descriptor
}

export async function validateSourcePackage(packageRoot, { required = false } = {}) {
  const file = path.join(packageRoot, SOURCE_MANIFEST)
  if (!await exists(file)) { if (required) invalid('complete rebuildable source is required'); return null }
  if ((await fs.lstat(file)).isSymbolicLink()) invalid('source descriptor must not be a link')
  const descriptor = await json(file)
  if (!validateDescriptor(descriptor)) invalid(`invalid source-manifest.json: ${JSON.stringify(validateDescriptor.errors)}`)
  const root = sourcePath(packageRoot, descriptor.sourceRoot)
  const appPath = sourcePath(root, descriptor.appRoot)
  for (const cmd of Object.values(descriptor.commands)) {
    sourcePath(root, cmd.cwd)
    if (!['bun', 'npm', 'node'].includes(cmd.argv[0])) invalid('unsupported command executable')
  }
  if (descriptor.lockfile) sourcePath(root, descriptor.lockfile)
  const files = await sourceFileList(root)
  if (JSON.stringify(files) !== JSON.stringify(descriptor.files.map(({ executable, ...file }) => file)) || hash(descriptor.files) !== descriptor.sourceHash) invalid('source file list or hash differs')
  if (hash(await runtimeFileList(packageRoot)) !== descriptor.runtimeHash) invalid('runtime hash differs')
  const project = await inspectSourceProject(root, { appRoot: descriptor.appRoot, packageManagerVersion: descriptor.toolchain.packageManager.version })
  const manifest = await json(path.join(packageRoot, 'app.moss.json'))
  if (manifest.id !== descriptor.appId || manifest.version !== descriptor.version || project.manifest.id !== descriptor.appId || project.manifest.version !== descriptor.version) invalid('source and installed version differ')
  if (project.lockfile !== descriptor.lockfile || JSON.stringify(project.commands) !== JSON.stringify(descriptor.commands)
    || JSON.stringify(project.toolchain.packageManager) !== JSON.stringify(descriptor.toolchain.packageManager)) invalid('build metadata differs from the source project')
  return { descriptor, root, appPath }
}

/** Restore declared executable bits only in a writable developer copy. */
export async function restoreSourceModes(root, descriptor) {
  if (process.platform === 'win32') return
  for (const file of descriptor.files) if (file.executable) {
    const target = sourcePath(root, file.path)
    if ((await fs.lstat(target)).isSymbolicLink()) invalid('source contains a link')
    await fs.chmod(target, 0o755)
  }
}
