import { readServerConfig } from './config.js'
import { startStandaloneDirectConnectServer } from './startStandaloneServer.js'

async function runServer(): Promise<void> {
  const { configPath, config } = await readServerConfig()
  const running = await startStandaloneDirectConnectServer(config)
  const hideBootstrapSecrets = process.env.MOSS_HIDE_BOOTSTRAP_SECRETS === '1'

  process.stderr.write(`\nConfig: ${configPath}\n`)
  if (running.bootstrapAdminUsername) {
    process.stderr.write(`Bootstrap admin username: ${running.bootstrapAdminUsername}\n`)
  }
  if (running.bootstrapAdminEmail) {
    process.stderr.write(`Bootstrap admin email: ${running.bootstrapAdminEmail}\n`)
  }
  if (running.bootstrapAdminPassword && !hideBootstrapSecrets) {
    process.stderr.write(`Bootstrap admin password: ${running.bootstrapAdminPassword}\n`)
  }
  if (running.bootstrapAdminApiKey && !hideBootstrapSecrets) {
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
