import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

/** Smoke test the shipped files without source/ or development node_modules. */
export async function verifyPackageRuntime(packageRoot, { nodeExecutable, signal } = {}) {
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'app.moss.json'), 'utf8'))
  if (!manifest.backend) return { backend: 'absent' }
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'moss-runtime-check-')))
  const runtimeRoot = path.join(temporary, 'package')
  const logs = []
  const supervisor = new AppProcessSupervisor({ onHostRequest: ({ protocol, method }) => {
    if (protocol === 'moss.runtimes/v1' && method === 'python.get') return { available: false, path: null, version: null }
    throw new Error(`Host service is unavailable in package verification: ${protocol}/${method}`)
  }, onLog: entry => { if (entry.level === 'error') logs.push(entry.message) }, nodeExecutable, nodeArgs: ['--permission', `--allow-fs-read=${temporary}`, `--allow-fs-write=${temporary}`, `--allow-fs-read=${fileURLToPath(new URL('../process/bootstrap.mjs', import.meta.url))}`, '--allow-addons'], processesDir: path.join(temporary, 'processes'), handshakeTimeoutMs: 15000, shutdownTimeoutMs: 1000 })
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
