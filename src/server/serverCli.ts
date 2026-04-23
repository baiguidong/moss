import { startStandaloneDirectConnectServer } from './startStandaloneServer.js'

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: direct-connect-server [options]',
      '',
      'Options:',
      '  --port <number>         HTTP port (default: 0)',
      '  --host <host>           Bind address (default: 0.0.0.0)',
      '  --auth-center-url <url> Validate bearer tokens through auth center (required)',
      '  --runtime <type>        Default runtime: host | docker (default: host)',
      '  --docker-image <image>  Default docker image when runtime=docker',
      '  --docker-mode <mode>    Docker persistence mode: session | user (default: session)',
      '  --workspace <dir>       Default working directory for new sessions',
      '  --idle-timeout <ms>     Detached session idle timeout in ms (default: 600000)',
      '  --max-sessions <n>      Maximum concurrent sessions (default: 32)',
      '  -h, --help              Show this help',
      '',
    ].join('\n'),
  )
}

function parseArgs(argv: string[]): {
  port: number
  host: string
  authCenterUrl?: string
  runtime?: 'host' | 'docker'
  dockerImage?: string
  dockerMode?: 'session' | 'user'
  workspace?: string
  idleTimeoutMs: number
  maxSessions: number
} {
  const result = {
    port: 0,
    host: '0.0.0.0',
    authCenterUrl: undefined as string | undefined,
    runtime: undefined as 'host' | 'docker' | undefined,
    dockerImage: undefined as string | undefined,
    dockerMode: undefined as 'session' | 'user' | undefined,
    workspace: undefined as string | undefined,
    idleTimeoutMs: 600000,
    maxSessions: 32,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      printHelp()
      process.exit(0)
    }

    const value = argv[i + 1]
    if (arg === '--port') {
      result.port = Number.parseInt(value || '', 10)
      i += 1
      continue
    }
    if (arg === '--host') {
      result.host = value || result.host
      i += 1
      continue
    }
    if (arg === '--auth-center-url') {
      result.authCenterUrl = value || ''
      i += 1
      continue
    }
    if (arg === '--runtime') {
      result.runtime =
        value === 'docker' ? 'docker' : value === 'host' ? 'host' : undefined
      i += 1
      continue
    }
    if (arg === '--docker-image') {
      result.dockerImage = value || ''
      i += 1
      continue
    }
    if (arg === '--docker-mode') {
      result.dockerMode =
        value === 'user' ? 'user' : value === 'session' ? 'session' : undefined
      i += 1
      continue
    }
    if (arg === '--workspace') {
      result.workspace = value || ''
      i += 1
      continue
    }
    if (arg === '--idle-timeout') {
      result.idleTimeoutMs = Number.parseInt(value || '', 10)
      i += 1
      continue
    }
    if (arg === '--max-sessions') {
      result.maxSessions = Number.parseInt(value || '', 10)
      i += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!Number.isFinite(result.port) || result.port < 0) {
    throw new Error(`Invalid --port value: ${String(result.port)}`)
  }
  if (!Number.isFinite(result.idleTimeoutMs) || result.idleTimeoutMs < 0) {
    throw new Error(
      `Invalid --idle-timeout value: ${String(result.idleTimeoutMs)}`,
    )
  }
  if (!Number.isFinite(result.maxSessions) || result.maxSessions < 0) {
    throw new Error(
      `Invalid --max-sessions value: ${String(result.maxSessions)}`,
    )
  }
  if (
    result.runtime !== undefined &&
    result.runtime !== 'host' &&
    result.runtime !== 'docker'
  ) {
    throw new Error(`Invalid --runtime value: ${String(result.runtime)}`)
  }
  if (
    result.dockerMode !== undefined &&
    result.dockerMode !== 'session' &&
    result.dockerMode !== 'user'
  ) {
    throw new Error(`Invalid --docker-mode value: ${String(result.dockerMode)}`)
  }
  if (result.runtime === 'docker' && !result.dockerImage) {
    throw new Error('Missing --docker-image when --runtime=docker')
  }
  if (!result.authCenterUrl) {
    throw new Error('Missing --auth-center-url')
  }

  return result
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const running = await startStandaloneDirectConnectServer(options)

  const shutdown = async () => {
    await running.stop()
    process.exit(0)
  }

  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(1)
})
