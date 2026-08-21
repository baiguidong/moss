import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { MOSS_HOME, MOSS_SERVER_HOME } from '../lib/env.js'
import type {
  BackendHandle,
  BackendSpawnOptions,
  SessionBackend,
  SessionRuntimeInfo,
} from '../backendTypes.js'
import {
  buildSessionEnv,
  createStreamBackendHandle,
} from './backendUtils.js'

type DockerBackendDefaults = {
  network?: string
  labels?: Record<string, string>
}

function uniqueMounts(paths: string[]): string[] {
  return [...new Set(paths)]
}

function resolveDockerUser(): string | null {
  if (typeof process.getuid !== 'function' || typeof process.getgid !== 'function') {
    return null
  }
  return `${process.getuid()}:${process.getgid()}`
}

function resolveSessionRunnerPath(): string {
  return join(MOSS_SERVER_HOME, 'bin', 'moss-session-runner.mjs')
}

function ensureSessionRunnerExists(runnerPath: string): void {
  if (!existsSync(runnerPath)) {
    throw new Error(
      `Missing ${runnerPath}. Build or install moss-session-runner.mjs to ${join(MOSS_SERVER_HOME, 'bin')}.`,
    )
  }
}

export class DockerBackend implements SessionBackend {
  constructor(private readonly defaults: DockerBackendDefaults = {}) {}

  async spawn(options: BackendSpawnOptions): Promise<BackendHandle> {
    if (process.platform === 'win32') {
      throw new Error('Docker runtime is not supported on Windows by this build')
    }

    const runtime = options.runtime
    const image = runtime.dockerImage
    if (!image) {
      throw new Error(
        'Docker runtime requested but no docker image was configured',
      )
    }
    if (!options.backendManifestPath) {
      throw new Error('Docker runtime requested without backend manifest path')
    }

    const sessionRunnerPath = resolveSessionRunnerPath()
    ensureSessionRunnerExists(sessionRunnerPath)

    const profileDir = runtime.profileDir
    await mkdir(profileDir, { recursive: true })
    const backendManifestPath = options.backendManifestPath
    await mkdir(dirname(backendManifestPath), { recursive: true })

    const mounts = uniqueMounts([
      options.cwd,
      dirname(sessionRunnerPath),
      dirname(backendManifestPath),
      profileDir,
      runtime.transcriptDir,
      MOSS_HOME,
    ])

    const containerName =
      runtime.containerName || `moss-session-${options.sessionId.slice(0, 12)}`
    const env = buildSessionEnv(options, {
      MOSS_CONFIG_DIR: profileDir,
      MOSS_SESSION_RUNTIME_TYPE: 'docker',
    })

    const backendOptions: BackendSpawnOptions = {
      ...options,
      runtime: {
        ...runtime,
        backend: 'host',
        containerName,
      },
    }
    await writeFile(
      backendManifestPath,
      `${JSON.stringify(backendOptions, null, 2)}\n`,
      'utf8',
    )

    const args = ['run', '--rm', '-i', '--name', containerName]
    const dockerUser = resolveDockerUser()
    if (dockerUser) {
      args.push('--user', dockerUser)
    }
    if (this.defaults.network) {
      args.push('--network', this.defaults.network)
    }
    for (const [key, value] of Object.entries(this.defaults.labels || {})) {
      args.push('--label', `${key}=${value}`)
    }
    for (const mount of mounts) {
      args.push('-v', `${mount}:${mount}`)
    }

    args.push('-w', options.cwd)
    const passthroughEnvKeys = [
      'MOSS_CONFIG_DIR',
      'MOSS_SESSION_USER_ID',
      'MOSS_SESSION_ORG_ID',
      'MOSS_SESSION_ROLE',
      'MOSS_SESSION_SCOPES',
      'MOSS_SESSION_RUNTIME_TYPE',
      'MOSS_ASSISTANT_NAME',
    ]
    for (const key of passthroughEnvKeys) {
      if (env[key]) {
        args.push('-e', `${key}=${env[key]}`)
      }
    }
    args.push('-e', `HOME=${profileDir}`)
    args.push('-e', `MOSS_SERVER_HOME=${MOSS_SERVER_HOME}`)
    args.push('-e', `MOSS_HOME=${MOSS_HOME}`)

    args.push(
      image,
      'node',
      sessionRunnerPath,
      '--stdio',
      backendManifestPath,
    )

    const child = spawn('docker', args, {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const runtimeInfo: SessionRuntimeInfo = {
      backend: 'docker',
      profileMode: runtime.profileMode,
      dockerImage: image,
      containerName,
      profileDir,
      transcriptDir: runtime.transcriptDir,
      workspaceDir: runtime.workspaceDir,
    }

    const handle = createStreamBackendHandle(child, options, runtimeInfo)
    return {
      ...handle,
      interrupt() {
        const signal = spawn(
          'docker',
          ['kill', '--signal=SIGINT', containerName],
          {
            stdio: 'ignore',
            windowsHide: true,
          },
        )
        signal.unref()
      },
      destroy(force = false) {
        if (child.killed) {
          return
        }
        if (force) {
          const cleanup = spawn('docker', ['rm', '-f', containerName], {
            stdio: 'ignore',
            windowsHide: true,
          })
          cleanup.unref()
        }
        handle.destroy(force)
      },
    }
  }
}
