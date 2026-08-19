import { readFile } from 'fs/promises'
import { readServerConfig } from './config.js'
import { startStandaloneDirectConnectServer } from './startStandaloneServer.js'
import { SessionRunnerDaemon } from './sessionRunnerDaemon.js'
import type { RunnerManifest } from './types.js'

async function runSessionRunner(manifestPath: string | undefined): Promise<void> {
  if (!manifestPath) {
    throw new Error('Missing runner manifest path')
  }
  const raw = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(raw) as RunnerManifest
  const daemon = new SessionRunnerDaemon(manifest)
  await daemon.start()
}

async function runServer(): Promise<void> {
  const { configPath, config } = await readServerConfig()
  const running = await startStandaloneDirectConnectServer(config)

  process.stderr.write(`\nConfig: ${configPath}\n`)
  if (running.bootstrapAdminUsername) {
    process.stderr.write(`Bootstrap admin username: ${running.bootstrapAdminUsername}\n`)
  }
  if (running.bootstrapAdminEmail) {
    process.stderr.write(`Bootstrap admin email: ${running.bootstrapAdminEmail}\n`)
  }
  if (running.bootstrapAdminPassword) {
    process.stderr.write(`Bootstrap admin password: ${running.bootstrapAdminPassword}\n`)
  }
  if (running.bootstrapAdminApiKey) {
    process.stderr.write(`Bootstrap admin API key: ${running.bootstrapAdminApiKey}\n`)
  }

  const shutdown = async () => {
    await running.stop()
    process.exit(0)
  }

  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === 'session-runner') {
    await runSessionRunner(process.argv[3])
    return
  }
  if (command) {
    throw new Error(`Unknown moss-server command: ${command}`)
  }
  await runServer()
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(1)
})
