import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import lockfile from 'proper-lockfile'
import { normalizeMcpLocalOptions } from './local-options.mjs'

const execute = promisify(execFile)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const pythonAt = root => path.join(root, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')

/** Install fixed Python requirements in a private reusable venv, never into the user's Python. */
export async function prepareMcpPython(config, { env = process.env, signal, cacheRoot } = {}) {
  if (!config.python) return config.command
  const { python } = normalizeMcpLocalOptions(config)
  const interpreter = ['python', 'python3'].includes(config.command) ? env.MOSS_PYTHON_PATH || config.command : config.command
  const cleanEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !['PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV'].includes(key)))
  const run = (command, args, timeout = 120_000) => execute(command, args, { env: cleanEnv, signal, timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true, encoding: 'utf8' })
  const identity = (await run(interpreter, ['-I', '-c', 'import os, sys; print(os.path.realpath(sys.executable)); print(sys.version)'])).stdout
  const hash = createHash('sha256').update(JSON.stringify([identity, python.requirements])).digest('hex').slice(0, 32)
  const home = cacheRoot || env.MOSS_MCP_PYTHON_HOME || path.join(env.MOSS_HOME || env.MOSS_CONFIG_DIR || path.join(homedir(), '.moss'), 'mcp', 'python')
  const root = path.join(home, hash), marker = path.join(root, '.ready')
  const ready = async () => {
    try { await fs.access(marker); await fs.access(pythonAt(root)); return true } catch { return false }
  }
  if (await ready()) return pythonAt(root)
  await fs.mkdir(home, { recursive: true })
  let release
  const deadline = Date.now() + 270_000
  while (!release) {
    signal?.throwIfAborted()
    try { release = await lockfile.lock(root, { realpath: false, stale: 270_000, update: 10_000 }) }
    catch (error) {
      if (error.code !== 'ELOCKED') throw error
      if (await ready()) return pythonAt(root)
      if (Date.now() >= deadline) throw new Error('等待 Python 依赖安装超时，请重试。')
      await pause(200)
    }
  }
  try {
    if (await ready()) return pythonAt(root)
    await fs.rm(root, { recursive: true, force: true })
    await run(interpreter, ['-I', '-m', 'venv', root])
    // Document converters pull native wheels and a local format-detection model.
    // Keep this below the 300 s Host inspection deadline, including the handshake.
    await run(pythonAt(root), ['-I', '-m', 'pip', '--isolated', 'install', '--require-virtualenv', '--no-user', '--disable-pip-version-check', '--no-input', '--no-cache-dir', ...python.requirements], 240_000)
    await fs.writeFile(marker, JSON.stringify(python), { mode: 0o600 })
    return pythonAt(root)
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {})
    throw new Error(`Python 服务环境准备失败：${error.stderr?.trim() || error.message}`)
  } finally { await release() }
}
