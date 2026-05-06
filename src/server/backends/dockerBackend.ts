import { spawn } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { mkdir } from 'fs/promises'
import os from 'os'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { MOSS_HOME } from '../../utils/skills/localSkillDirectories.js'
import type {
  BackendHandle,
  BackendSpawnOptions,
  SessionBackend,
  SessionRuntimeInfo,
} from '../sessionManager.js'
import {
  buildSessionEnv,
  createStreamBackendHandle,
  ensureCliExists,
  resolveNodeCliPath,
  resolveScodeCliPath,
} from './backendUtils.js'
import { createAcpBridgeHandle } from './acpBridge.js'

type DockerBackendDefaults = {
  image?: string
  mode?: 'session' | 'user'
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

function buildConfigDir(
  options: BackendSpawnOptions,
  mode: 'session' | 'user',
): string {
  if (mode === 'user' && options.userId) {
    return join(
      getClaudeConfigHomeDir(),
      'direct-connect-runtime',
      'users',
      options.userId,
    )
  }
  return join(
    getClaudeConfigHomeDir(),
    'direct-connect-runtime',
    'sessions',
    options.sessionId,
  )
}

export class DockerBackend implements SessionBackend {
  constructor(private readonly defaults: DockerBackendDefaults = {}) {}

  async spawn(options: BackendSpawnOptions): Promise<BackendHandle> {
    if (process.platform === 'win32') {
      throw new Error('Docker runtime is not supported on Windows by this build')
    }

    const runtime = options.runtime
    const image = runtime?.dockerImage || this.defaults.image
    const mode = runtime?.dockerMode || this.defaults.mode || 'session'
    const isScode = runtime?.engine === 'scode'
    if (!image) {
      throw new Error(
        'Docker runtime requested but no docker image was configured',
      )
    }

    const configDir = runtime?.configDir || buildConfigDir(options, mode)
    await mkdir(configDir, { recursive: true })

    const scodeConfigPath = runtime?.scodePath
    const scodePath = isScode
      ? (scodeConfigPath && scodeConfigPath.startsWith('/')
          ? scodeConfigPath
          : '/usr/local/bin/scode')
      : resolveScodeCliPath(scodeConfigPath)
    const nodeCliPath = resolveNodeCliPath()
    if (!isScode) {
      ensureCliExists(nodeCliPath)
    }

    const safeCwd = options.cwd === '/' ? os.homedir() : options.cwd
    const mounts = uniqueMounts([
      safeCwd,
      configDir,
      MOSS_HOME,
    ]).filter(p => p !== '/')
    if (!isScode) {
      mounts.push(dirname(nodeCliPath))
    }

    const containerName =
      runtime?.containerName || `moss-session-${options.sessionId.slice(0, 12)}`

    const passthroughEnvKeys = [
      'MOSS_SESSION_USER_ID',
      'MOSS_SESSION_ORG_ID',
      'MOSS_SESSION_ROLE',
      'MOSS_SESSION_SCOPES',
      'MOSS_ASSISTANT_NAME',
      'MOSS_DEFAULT_MODEL',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'PROXY_AUTH_TOKEN',
    ]

    const envOverrides: Record<string, string | undefined> = isScode
      ? {}
      : {
          CLAUDE_CONFIG_DIR: configDir,
          CLAUDE_CODE_CLI_PATH: nodeCliPath,
          MOSS_SESSION_RUNTIME_TYPE: 'docker',
        }

    const env = buildSessionEnv(options, envOverrides)

    // scode (Rust version) requires a sudocode.json to be present in the config directory,
    // and it must contain the definition for the model and provider we're using.
    if (isScode) {
      const dotNexusDir = join(configDir, '.nexus', 'sudocode')
      await mkdir(dotNexusDir, { recursive: true })
      const dummySudocodePath = join(dotNexusDir, 'sudocode.json')

      try {
        const baseUrl = env.ANTHROPIC_BASE_URL || 'https://hk.sudorouter.ai/v1'
        const apiKey = env.ANTHROPIC_API_KEY || ''
        const modelName = runtime?.model || env.MOSS_DEFAULT_MODEL || 'gemini-3-flash-preview'
        let scodeModelName = modelName
        if (!scodeModelName.includes('/') && !['opus', 'sonnet', 'haiku', 'claude-opus', 'claude-sonnet', 'claude-haiku'].includes(scodeModelName)) {
          scodeModelName = `proxy/${scodeModelName}`
        }
        const wireModel = modelName.includes('/') ? modelName.split('/')[1] : modelName

        const scodeConfig = {
          auth_modes: {
            proxy: {
              "moss-proxy": {
                baseUrl,
                apiKey
              }
            }
          },
          models: {
            [scodeModelName]: {
              alias: scodeModelName,
              name: `Moss Dynamic: ${scodeModelName}`,
              input: ["text"],
              providers: {
                proxy: {
                  provider: "moss-proxy",
                  model: wireModel,
                  api: "openai-completions"
                }
              }
            }
          }
        }
        writeFileSync(dummySudocodePath, JSON.stringify(scodeConfig, null, 2), 'utf8')
      } catch (e) {
        process.stderr.write(`[DockerBackend] Failed to create dynamic sudocode.json: ${e}\n`)
      }
    }

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

    args.push('-w', safeCwd)
    for (const key of passthroughEnvKeys) {
      if (env[key]) {
        args.push('-e', `${key}=${env[key]}`)
      }
    }
    if (!isScode) {
      args.push('-e', `CLAUDE_CONFIG_DIR=${configDir}`)
      args.push('-e', `CLAUDE_CODE_CLI_PATH=${nodeCliPath}`)
      args.push('-e', `MOSS_SESSION_RUNTIME_TYPE=docker`)
    }
    args.push('-e', `HOME=${configDir}`)
    args.push('-e', `MOSS_HOME=${MOSS_HOME}`)

    if (isScode) {
      const containerScodePath = scodePath
      let model = runtime?.model || env.MOSS_DEFAULT_MODEL || 'gemini-3-flash-preview'

      // Auto-fix model name for scode if it's missing provider prefix and not a known alias
      if (model && !model.includes('/') && !['opus', 'sonnet', 'haiku', 'claude-opus', 'claude-sonnet', 'claude-haiku'].includes(model)) {
        model = `proxy/${model}`
      }

      args.push(
        image,
        containerScodePath,
        'acp',
        '--output-format', 'json',
        '--permission-mode', 'danger-full-access',
        '--auth', 'proxy',
        '--model', model,
      )

      process.stderr.write(`\n[DockerBackend] Spawning scode engine inside Docker:\n`)
      process.stderr.write(`  Image: ${image}\n`)
      process.stderr.write(`  scode: ${containerScodePath}\n`)
      process.stderr.write(`  CWD: ${safeCwd}\n`)
      process.stderr.write(`  Model: ${model}\n\n`)

      const child = spawn('docker', args, {
        cwd: safeCwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })

      const runtimeInfo: SessionRuntimeInfo = {
        type: 'docker',
        engine: 'scode',
        dockerImage: image,
        dockerMode: mode,
        containerName,
        configDir,
      }

      const handle = createAcpBridgeHandle({
        child,
        sessionId: options.sessionId,
        cwd: safeCwd,
        model,
        transcriptPath: (options as any).transcriptPath,
        runtime: runtimeInfo,
      })

      const originalDestroy = handle.destroy.bind(handle)
      handle.destroy = (force = false) => {
        if (force) {
          const cleanup = spawn('docker', ['rm', '-f', containerName], {
            stdio: 'ignore',
            windowsHide: true,
          })
          cleanup.unref()
        }
        originalDestroy(force)
      }

      return handle
    }

    // Legacy CLI mode
    args.push(
      image,
      'node',
      nodeCliPath,
      '--print',
      '--verbose',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--permission-prompt-tool',
      'stdio',
    )

    if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId)
    } else {
      args.push('--session-id', options.sessionId)
    }

    if (options.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions')
    }

    const child = spawn('docker', args, {
      cwd: safeCwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const runtimeInfo: SessionRuntimeInfo = {
      type: 'docker',
      engine: 'legacy',
      dockerImage: image,
      dockerMode: mode,
      containerName,
      configDir,
    }

    const handle = createStreamBackendHandle(child, options, runtimeInfo)
    return {
      ...handle,
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