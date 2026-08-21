import { readFile } from 'fs/promises'
import { SessionRunnerDaemon } from './sessionRunnerDaemon.js'
import type { RunnerManifest } from './types.js'
import { DirectEmbeddedBackend } from './backends/directEmbeddedBackend.js'
import type { BackendSpawnOptions } from './backendTypes.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBackendSpawnOptions(value: unknown): BackendSpawnOptions {
  if (!isRecord(value)) {
    throw new Error('Invalid stdio runner manifest')
  }
  const sessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
  const cwd = typeof value.cwd === 'string' ? value.cwd : ''
  if (!sessionId) {
    throw new Error('Invalid stdio runner manifest: missing sessionId')
  }
  if (!cwd) {
    throw new Error('Invalid stdio runner manifest: missing cwd')
  }

  const runtime = isRecord(value.runtime) ? value.runtime : {}
  const profileMode =
    runtime.profileMode === 'user' || runtime.profileMode === 'session'
      ? runtime.profileMode
      : 'session'
  const profileDir =
    typeof runtime.profileDir === 'string' ? runtime.profileDir : ''
  const transcriptDir =
    typeof runtime.transcriptDir === 'string' ? runtime.transcriptDir : ''
  if (!profileDir) {
    throw new Error('Invalid stdio runner manifest: missing runtime.profileDir')
  }
  if (!transcriptDir) {
    throw new Error('Invalid stdio runner manifest: missing runtime.transcriptDir')
  }
  return {
    sessionId,
    resumeSessionId:
      typeof value.resumeSessionId === 'string'
        ? value.resumeSessionId
        : undefined,
    transcriptPath:
      typeof value.transcriptPath === 'string'
        ? value.transcriptPath
        : undefined,
    cwd,
    dangerouslySkipPermissions: value.dangerouslySkipPermissions === true,
    userId: typeof value.userId === 'string' ? value.userId : undefined,
    orgId: typeof value.orgId === 'string' ? value.orgId : undefined,
    role: typeof value.role === 'string' ? value.role : undefined,
    scopes: Array.isArray(value.scopes)
      ? value.scopes.filter((scope): scope is string => typeof scope === 'string')
      : undefined,
    assistantName:
      typeof value.assistantName === 'string' ? value.assistantName : undefined,
    runtime: {
      backend: 'host',
      profileMode,
      containerName:
        typeof runtime.containerName === 'string'
          ? runtime.containerName
          : undefined,
      profileDir,
      transcriptDir,
      workspaceDir:
        typeof runtime.workspaceDir === 'string' ? runtime.workspaceDir : undefined,
    },
  }
}

async function runStdioBackend(manifestPath: string | undefined): Promise<void> {
  if (!manifestPath) {
    throw new Error('Missing stdio runner manifest path')
  }
  const raw = await readFile(manifestPath, 'utf8')
  const options = readBackendSpawnOptions(JSON.parse(raw))
  process.env.MOSS_CONFIG_DIR = options.runtime.profileDir

  const backend = new DirectEmbeddedBackend()
  const handle = await backend.spawn(options)
  let exiting = false
  const exitOnce = (code = 0) => {
    if (exiting) return
    exiting = true
    process.exit(code)
  }

  handle.onStdoutLine(line => {
    process.stdout.write(line)
  })
  handle.onStderrLine(line => {
    process.stderr.write(line)
  })
  handle.onExit((code, signal) => {
    exitOnce(code ?? (signal ? 1 : 0))
  })

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    handle.writeStdin(String(chunk))
  })
  process.stdin.once('end', () => {
    handle.destroy(false)
  })
  process.stdin.once('error', error => {
    process.stderr.write(`${error.message}\n`)
    handle.destroy(true)
  })
  process.once('SIGTERM', () => {
    handle.destroy(true)
  })
  process.once('SIGINT', () => {
    handle.interrupt()
  })
  process.stdin.resume()
}

export async function main(argv: string[] = process.argv): Promise<void> {
  if (argv[2] === '--stdio') {
    await runStdioBackend(argv[3])
    return
  }

  const manifestPath = argv[2]
  if (!manifestPath) {
    throw new Error('Missing runner manifest path')
  }

  const raw = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(raw) as RunnerManifest
  process.env.MOSS_CONFIG_DIR = manifest.session.runtime.profileDir

  const daemon = new SessionRunnerDaemon(manifest)
  await daemon.start()
}
