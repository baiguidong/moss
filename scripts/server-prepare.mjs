#!/usr/bin/env bun
import { spawnSync } from 'child_process'
import { cp, mkdir, rm } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { getMossServerHome, getServerRuntimeEnv } from './server-runtime.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serverHome = getMossServerHome()
const env = getServerRuntimeEnv()

function run(label, command, args) {
  console.log(`\n${label}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function copyFileIntoServerHome(source, target) {
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { force: true })
}

async function main() {
  run('Building server runtime artifacts', 'bun', ['run', 'build:server'])

  const binDir = join(serverHome, 'bin')
  const adminDir = join(serverHome, 'admin')
  const adminDistDir = join(adminDir, 'dist')

  await Promise.all([
    mkdir(binDir, { recursive: true }),
    mkdir(join(serverHome, 'runtime'), { recursive: true }),
    mkdir(join(serverHome, 'transcripts'), { recursive: true }),
    mkdir(join(serverHome, 'logs'), { recursive: true }),
    mkdir(join(serverHome, 'skills'), { recursive: true }),
    mkdir(join(serverHome, 'assistants'), { recursive: true }),
  ])

  await copyFileIntoServerHome(
    join(repoRoot, 'bin', 'moss-server.mjs'),
    join(binDir, 'moss-server.mjs'),
  )
  await copyFileIntoServerHome(
    join(repoRoot, 'bin', 'moss-session-runner.mjs'),
    join(binDir, 'moss-session-runner.mjs'),
  )
  await copyFileIntoServerHome(
    join(repoRoot, 'bin', 'cli-node.js'),
    join(binDir, 'cli-node.js'),
  )
  await rm(join(binDir, 'agent-runtime.mjs'), {
    force: true,
  })
  await rm(join(binDir, 'direct-connect-session-runner.mjs'), {
    force: true,
  })

  await mkdir(adminDir, { recursive: true })
  await rm(adminDistDir, { recursive: true, force: true })
  await cp(join(repoRoot, 'admin', 'dist'), adminDistDir, {
    recursive: true,
    force: true,
  })

  console.log(`\nPrepared Moss server runtime at ${serverHome}`)
  console.log(`  ${join(binDir, 'moss-server.mjs')}`)
  console.log(`  ${join(binDir, 'moss-session-runner.mjs')}`)
  console.log(`  ${join(binDir, 'cli-node.js')}`)
  console.log(`  ${adminDistDir}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
