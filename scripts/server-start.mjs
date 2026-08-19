#!/usr/bin/env bun
import { spawn, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { getMossServerHome, getServerRuntimeEnv } from './server-runtime.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serverHome = getMossServerHome()
const env = getServerRuntimeEnv()

const prepare = spawnSync('bun', ['run', 'server:prepare'], {
  cwd: repoRoot,
  env,
  stdio: 'inherit',
})
if (prepare.status !== 0) {
  process.exit(prepare.status ?? 1)
}

const serverEntry = join(serverHome, 'bin', 'moss-server.mjs')
if (!existsSync(serverEntry)) {
  console.error(`Missing ${serverEntry}.`)
  process.exit(1)
}

const child = spawn('node', [serverEntry], {
  cwd: serverHome,
  env,
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    child.kill(signal)
  })
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(signal === 'SIGINT' ? 130 : 143)
    return
  }
  process.exit(code ?? 0)
})

child.on('error', error => {
  console.error(error.message)
  process.exit(1)
})
