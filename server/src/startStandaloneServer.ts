import { createAuthService } from './auth/service.js'
import { ensureServerDirectories } from './config.js'
import { createModels } from './model/index.js'
import { acquireDatabaseOwner } from './model/maintenance.js'
import { OpenIMIntegrationService } from './openim/service.js'
import { RagflowIntegrationService } from './ragflow/service.js'
import { startServer } from './server.js'
import { printBanner } from './serverBanner.js'
import { createServerLogger } from './serverLog.js'
import { getSystemSettings } from './systemSettings.js'
import type { ServerConfig } from './types.js'

export type StandaloneServerOptions = ServerConfig

export async function startStandaloneDirectConnectServer(
  config: ServerConfig,
): Promise<{
  config: ServerConfig
  port: number
  httpUrl: string
  bootstrapAdminUsername?: string
  bootstrapAdminEmail?: string
  bootstrapAdminPassword?: string
  stop: () => Promise<void>
}> {
  await ensureServerDirectories(config)
  const releaseOwner = await acquireDatabaseOwner(config.rootDir)
  let models: Awaited<ReturnType<typeof createModels>> | undefined
  let activeServer: Awaited<ReturnType<typeof startServer>> | undefined
  try {
    models = await createModels(config.database)
    const { service: authService, bootstrap } = await createAuthService({
      db: models.db,
      tokenTtlSec: config.tokenTtlSec,
      bootstrapAdmin: config.bootstrapAdmin,
    })
    const logger = createServerLogger()
    const ragflowIntegration = new RagflowIntegrationService({
      repository: models.ragflow,
      rootDir: config.rootDir,
      config: config.ragflow,
    })
    const openIMIntegration = new OpenIMIntegrationService({
      repository: models.openIM,
      config: getSystemSettings().openIM,
      authService,
    })
    const server = await startServer(
      config,
      models,
      authService,
      logger,
      ragflowIntegration,
      openIMIntegration,
    )
    activeServer = server
    const actualPort = (await server.ready) ?? config.port
    const connectHost =
      config.host === '0.0.0.0' || config.host === '::'
        ? '127.0.0.1'
        : config.host
    const httpUrl = `http://${connectHost}:${actualPort}`

    printBanner(
      {
        host: config.host,
        port: actualPort,
      },
      actualPort,
    )

    let stopped = false
    const stop = async () => {
      if (stopped) return
      stopped = true
      try {
        await server.stop()
      } finally {
        await models!.close().finally(releaseOwner)
      }
    }

    return {
      config,
      port: actualPort,
      httpUrl,
      bootstrapAdminUsername: bootstrap.bootstrapAdminUsername,
      bootstrapAdminEmail: bootstrap.bootstrapAdminEmail,
      bootstrapAdminPassword: bootstrap.bootstrapAdminPassword,
      stop,
    }
  } catch (error) {
    await activeServer?.stop().catch(() => {})
    await models?.close().catch(() => {})
    await releaseOwner()
    throw error
  }
}
