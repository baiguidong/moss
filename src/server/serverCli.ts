import { startStandaloneDirectConnectServer } from './startStandaloneServer.js'

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: direct-connect-server [options]',
      '',
      'Options:',
      '  --port <number>         HTTP port (default: 0)',
      '  --host <host>           Bind address (default: 0.0.0.0)',
      '  --auth-token <token>    Bearer token for auth',
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
  authToken?: string
  workspace?: string
  idleTimeoutMs: number
  maxSessions: number
} {
  const result = {
    port: 0,
    host: '0.0.0.0',
    authToken: undefined as string | undefined,
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
    if (arg === '--auth-token') {
      result.authToken = value || ''
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
