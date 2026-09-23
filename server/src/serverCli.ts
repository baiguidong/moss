import { cloudStorageCommand } from './cloudStorage/adminCli.js'
import { readServerConfig } from './config.js'
import { openDatabase } from './model/index.js'
import { startStandaloneDirectConnectServer } from './startStandaloneServer.js'

async function runServer(): Promise<void> {
  const { configPath, config } = await readServerConfig()
  const running = await startStandaloneDirectConnectServer(config)
  const hideBootstrapSecrets = process.env.MOSS_HIDE_BOOTSTRAP_SECRETS === '1'

  process.stderr.write(`\nConfig: ${configPath}\n`)
  if (running.bootstrapAdminUsername) {
    process.stderr.write(
      `Bootstrap admin username: ${running.bootstrapAdminUsername}\n`,
    )
  }
  if (running.bootstrapAdminEmail) {
    process.stderr.write(
      `Bootstrap admin email: ${running.bootstrapAdminEmail}\n`,
    )
  }
  if (running.bootstrapAdminPassword && !hideBootstrapSecrets) {
    process.stderr.write(
      `Bootstrap admin password: ${running.bootstrapAdminPassword}\n`,
    )
  }
  if (running.bootstrapAdminApiKey && !hideBootstrapSecrets) {
    process.stderr.write(
      `Bootstrap admin API key: ${running.bootstrapAdminApiKey}\n`,
    )
  }

  const shutdown = async () => {
    await running.stop()
    process.exit(0)
  }

  const onSignal = () => {
    void shutdown().catch(error => {
      process.stderr.write(
        `Shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`,
      )
      process.exitCode = 1
    })
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (
    command === 'db' &&
    process.argv[3] === 'check' &&
    process.argv.length === 4
  ) {
    const { config } = await readServerConfig()
    const db = await openDatabase(config.database)
    try {
      await db.check()
      process.stdout.write(`Database connection OK (${db.dialect})\n`)
    } finally {
      await db.close()
    }
    return
  }
  if (command === 'cloud-storage') {
    await cloudStorageCommand(process.argv[3] || '')
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
