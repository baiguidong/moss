import type { ServerConfig } from './types.js'
import { startServer } from './server.js'
import { printBanner } from './serverBanner.js'
import { createServerLogger } from './serverLog.js'
import { ensureServerDirectories } from './config.js'
import { openDirectConnectStore } from './db.js'
import { RuntimeService } from './runtimeService.js'
import { createAuthService } from './auth/service.js'
import { ServerAppRuntime } from './apps/serverAppRuntime.js'
import { createServerAccountHostHandlers } from './apps/serverAccountHost.js'
import { RagflowIntegrationService } from './ragflow/service.js'
import { OpenIMIntegrationService } from './openim/service.js'
import {
  getSystemSettings,
  toOpenIMServerConfig,
  updateSystemSettings,
} from './systemSettings.js'
import { createAccountProtocolDefinition } from '../../packages/app-runtime/src/index.mjs'
import { MOSS_ACCOUNT_PROTOCOL } from '../../packages/app-sdk/src/index.mjs'

export type StandaloneServerOptions = ServerConfig

export async function startStandaloneDirectConnectServer(
  config: ServerConfig,
): Promise<{
  config: ServerConfig
  port: number
  httpUrl: string
  bootstrapAdminUsername?: string
  bootstrapAdminApiKey?: string
  bootstrapAdminEmail?: string
  bootstrapAdminPassword?: string
  stop: () => Promise<void>
}> {
  await ensureServerDirectories(config)
  const store = openDirectConnectStore(config)
  const { service: authService, bootstrap } = await createAuthService({
    db: store.db,
    dbPath: config.dbPath,
    tokenTtlSec: config.tokenTtlSec,
    bootstrapAdmin: config.bootstrapAdmin,
  })
  const instance = store.registerServerInstance(config.host)
  const runtime = new RuntimeService({
    config,
    store,
    serverInstanceId: instance.instanceId,
  })
  await runtime.reconcileOnStartup()
  const appRuntime = await ServerAppRuntime.create(config, instance.instanceId, {
    hostProtocols: [createAccountProtocolDefinition()],
    hostHandlers: {
      [MOSS_ACCOUNT_PROTOCOL]: createServerAccountHostHandlers(authService),
    },
  })
  const ragflowIntegration = new RagflowIntegrationService({
    db: store.db,
    rootDir: config.rootDir,
    config: config.ragflow,
  })
  let systemSettings = getSystemSettings()
  const legacyOpenIM = config.openim
  if (
    !systemSettings.openIM.configured &&
    legacyOpenIM &&
    Boolean(
      legacyOpenIM.enabled ||
      legacyOpenIM.apiUrl ||
      legacyOpenIM.wsUrl ||
      legacyOpenIM.chatUrl ||
      legacyOpenIM.secret ||
      legacyOpenIM.webhookSecret
    )
  ) {
    systemSettings = updateSystemSettings({
      openIM: {
        enabled: legacyOpenIM.enabled,
        instanceId: legacyOpenIM.instanceId,
        apiUrl: legacyOpenIM.apiUrl || '',
        wsUrl: legacyOpenIM.wsUrl || '',
        chatUrl: legacyOpenIM.chatUrl || '',
        adminUserId: legacyOpenIM.adminUserId,
        secret: legacyOpenIM.secret || '',
        webhookSecret: legacyOpenIM.webhookSecret || '',
        requestTimeoutMs: legacyOpenIM.requestTimeoutMs,
      },
    })
  }
  const openIMIntegration = new OpenIMIntegrationService({
    db: store.db,
    config: toOpenIMServerConfig(systemSettings.openIM),
    authService,
  })

  const logger = createServerLogger()
  const server = startServer(
    config,
    runtime,
    authService,
    logger,
    appRuntime,
    ragflowIntegration,
    openIMIntegration,
  )
  const actualPort = (await server.ready) ?? config.port
  const connectHost =
    config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host
  const httpUrl = `http://${connectHost}:${actualPort}`

  printBanner(
    {
      host: config.host,
      port: actualPort,
    },
    actualPort,
  )

  const heartbeatTimer = setInterval(() => {
    store.heartbeatServerInstance(instance.instanceId)
  }, Math.max(5_000, Math.floor(config.heartbeatTimeoutMs / 2)))
  heartbeatTimer.unref?.()

  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    clearInterval(heartbeatTimer)
    await server.stop()
    await appRuntime.shutdown()
    store.stopServerInstance(instance.instanceId)
    store.close()
  }

  return {
    config,
    port: actualPort,
    httpUrl,
    bootstrapAdminUsername: bootstrap.bootstrapAdminUsername,
    bootstrapAdminApiKey: bootstrap.bootstrapAdminApiKey,
    bootstrapAdminEmail: bootstrap.bootstrapAdminEmail,
    bootstrapAdminPassword: bootstrap.bootstrapAdminPassword,
    stop,
  }
}
