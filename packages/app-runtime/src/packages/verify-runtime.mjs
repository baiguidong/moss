import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runtimeFileList, sourcePath } from './source.mjs'
import { AppProcessSupervisor } from '../process/index.mjs'

function placeholder(schema) {
  if (schema.default !== undefined) return schema.default
  if (schema.enum) return schema.enum[0]
  if (schema.type === 'object') return Object.fromEntries((schema.required || []).map(key => [key, placeholder(schema.properties?.[key] || {})]))
  if (schema.type === 'array') return []
  if (schema.type === 'boolean') return false
  if (['number', 'integer'].includes(schema.type)) return schema.minimum || 0
  return 'moss-package-verification'
}

const runFile = promisify(execFile)
const networkPermissionSupport = new Map()
async function networkPermissionArgs(executable) {
  if (!networkPermissionSupport.has(executable)) {
    const check = runFile(executable, ['-p', "process.allowedNodeEnvironmentFlags.has('--allow-net')"], { timeout: 10000 })
      .then(({ stdout }) => stdout.trim() === 'true' ? ['--allow-net=127.0.0.1'] : [])
      .catch(error => { networkPermissionSupport.delete(executable); throw error })
    networkPermissionSupport.set(executable, check)
  }
  return networkPermissionSupport.get(executable)
}

/** Smoke test the shipped files without source/ or development node_modules. */
export async function verifyPackageRuntime(packageRoot, { nodeExecutable, signal } = {}) {
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'app.moss.json'), 'utf8'))
  if (!manifest.backend) return { backend: 'absent' }
  // Node 22 ships with Moss and has filesystem/process permissions but no
  // network permission flag. Use loopback restriction where the runtime offers it.
  // This handshake is not a network sandbox on older Node releases.
  const networkArgs = await networkPermissionArgs(nodeExecutable || process.env.MOSS_NODE_PATH || process.execPath)
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-runtime-check-')))
  const runtimeRoot = path.join(temporary, 'package')
  const logs = []
  const supervisor = new AppProcessSupervisor({ onHostRequest: ({ protocol, method }) => {
    if (protocol === 'moss.runtimes/v1' && method === 'python.get') return { available: false, path: null, version: null }
    // A fresh isolated verification profile has no user sessions to restore.
    if (manifest.backend.storage === 'session' && protocol === 'moss.session-storage/v1' && method === 'scopes.pending') return []
    throw new Error(`Host service is unavailable in package verification: ${protocol}/${method}`)
  }, onLog: entry => { if (entry.level === 'error') logs.push(entry.message) }, nodeExecutable, nodeArgs: ['--permission', `--allow-fs-read=${temporary}`, `--allow-fs-write=${temporary}`, `--allow-fs-read=${fileURLToPath(new URL('../process/bootstrap.mjs', import.meta.url))}`, ...networkArgs, '--allow-addons'], processesDir: path.join(temporary, 'processes'), handshakeTimeoutMs: 15000, shutdownTimeoutMs: 1000 })
  const abort = () => { void supervisor.shutdown() }
  try {
    for (const file of await runtimeFileList(packageRoot)) {
      const destination = sourcePath(runtimeRoot, file.path)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.copyFile(sourcePath(packageRoot, file.path), destination)
    }
    signal?.throwIfAborted()
    signal?.addEventListener('abort', abort, { once: true })
    const configuration = async relative => relative ? placeholder(JSON.parse(await fs.readFile(sourcePath(runtimeRoot, relative), 'utf8'))) : {}
    supervisor.register({ key: 'verification', appId: manifest.id, version: manifest.version, instanceId: 'verification', generation: 1,
      packageRoot: runtimeRoot, entry: manifest.backend.entry, lifecycle: 'on-demand',
      config: await configuration(manifest.backend.configuration?.schema), secrets: await configuration(manifest.backend.configuration?.secrets), protocols: manifest.host?.protocols || [], permissions: [], grants: [],
      dataDir: path.join(temporary, 'data'), runtimeDir: path.join(temporary, 'runtime') })
    try { await supervisor.start('verification') }
    catch (error) { throw new Error(`${error.message}${logs.length ? `\n${logs.join('\n').slice(-8192)}` : ''}`, { cause: error }) }
    signal?.throwIfAborted()
    return { backend: 'handshake-passed' }
  } finally {
    signal?.removeEventListener('abort', abort)
    await supervisor.shutdown()
    await fs.rm(temporary, { recursive: true, force: true })
  }
}
