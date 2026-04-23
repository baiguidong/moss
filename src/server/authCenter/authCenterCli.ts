import { startAuthCenterServer } from './server.js'

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: moss-auth-center [options]',
      '',
      'Options:',
      '  --port <number>         HTTP port (default: 4401)',
      '  --host <host>           Bind address (default: 127.0.0.1)',
      '  --store <path>          Auth center JSON store path',
      '  --token-ttl <sec>       Access token TTL in seconds (default: 3600)',
      '  -h, --help              Show this help',
      '',
    ].join('\n'),
  )
}

function parseArgs(argv: string[]): {
  port?: number
  host?: string
  storePath?: string
  tokenTtlSec?: number
} {
  const result = {
    port: undefined as number | undefined,
    host: undefined as string | undefined,
    storePath: undefined as string | undefined,
    tokenTtlSec: undefined as number | undefined,
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
      result.host = value || undefined
      i += 1
      continue
    }
    if (arg === '--store') {
      result.storePath = value || undefined
      i += 1
      continue
    }
    if (arg === '--token-ttl') {
      result.tokenTtlSec = Number.parseInt(value || '', 10)
      i += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return result
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const running = await startAuthCenterServer(options)
  const port = (await running.ready) ?? options.port ?? 4401

  process.stderr.write(
    [
      '',
      'Moss auth center started.',
      `HTTP: http://${options.host ?? '127.0.0.1'}:${port}`,
      `Store: ${running.storePath}`,
      running.bootstrapAdminEmail
        ? `Bootstrap admin email: ${running.bootstrapAdminEmail}`
        : 'Bootstrap admin email: (existing store, unchanged)',
      running.bootstrapAdminPassword
        ? `Bootstrap admin password: ${running.bootstrapAdminPassword}`
        : 'Bootstrap admin password: (existing store, unchanged)',
      running.bootstrapAdminApiKey
        ? `Bootstrap admin API key: ${running.bootstrapAdminApiKey}`
        : 'Bootstrap admin API key: (existing store, unchanged)',
      '',
    ].join('\n'),
  )

  const shutdown = () => {
    running.stop()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(1)
})
