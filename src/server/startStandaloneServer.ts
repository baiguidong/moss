import type { ServerConfig } from './types.js'
import { startServer } from './server.js'
import { printBanner } from './serverBanner.js'
import { createServerLogger } from './serverLog.js'
import { ensureServerDirectories } from './config.js'
import { openDirectConnectStore } from './db.js'
import { RuntimeService } from './runtimeService.js'
import { createAuthService } from './auth/service.js'
import { enableConfigs } from '../utils/config.js'
import { initHubConfig } from './hubConfig.js'
import { NexusManager } from './nexus/nexusManager.js'
import { NexusClient } from './nexus/nexusClient.js'
import { AuthProxyServer } from './authProxy/authProxyServer.js'

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
  enableConfigs()
  initHubConfig({
    hubApiBaseUrl: config.hubApiBaseUrl,
    hubAuthorization: config.hubAuthorization,
    cosBaseUrl: config.cosBaseUrl,
  })
  await ensureServerDirectories(config)

  // Start Nexus subprocess for secrets storage
  const nexusManager = new NexusManager()
  let nexusClient: NexusClient | undefined
  try {
    await nexusManager.start()
    nexusClient = new NexusClient(nexusManager.baseUrl)
  } catch (error) {
    console.error('[Startup] Failed to start Nexus:', error instanceof Error ? error.message : error)
    console.error('[Startup] Moss Server requires Nexus for secrets management. Exiting.')
    process.exit(1)
  }

  // Start Auth Proxy (create instance, will load rules after DB is ready)
  const authProxy = new AuthProxyServer()
  authProxy.setNexusClient(nexusClient)
  try {
    await authProxy.start()
  } catch (error) {
    console.error('[Startup] Failed to start Auth Proxy:', error instanceof Error ? error.message : error)
    await nexusManager.stop()
    process.exit(1)
  }

  const store = openDirectConnectStore(config)
  const { service: authService, bootstrap } = await createAuthService({
    db: store.db,
    dbPath: config.dbPath,
    tokenTtlSec: config.tokenTtlSec,
    bootstrapAdmin: config.bootstrapAdmin,
  })
  const instance = store.registerServerInstance(config.host)

  // Load config item rules into Auth Proxy now that DB is available
  const activeItems = store.getAllActiveConfigItems()
  authProxy.updateRules(activeItems.map(item => ({
    configItemId: item.id as number,
    name: item.name as string,
    urlPattern: (item.url_pattern as string) || '',
    scheme: (item.scheme as string) || '',
    bearerPrefix: (item.bearer_prefix as string) || '',
    secretNamespace: `${item.scope}:${item.pinyin}`,
    entries: store.getConfigEntries(item.id as number).map(e => ({
      configKey: e.config_key as string,
      name: e.name as string,
      required: !!e.required,
    })),
  })))
  authProxy.setPolicyProvider({
    getAuthorizedConfigItemIds(departmentId: string): number[] {
      return store.getDepartmentPolicies(departmentId).map(r => r.config_item_id as number)
    },
  })
  const runtime = new RuntimeService({
    config,
    store,
    authService,
    serverInstanceId: instance.instanceId,
  })
  runtime.authProxy = authProxy
  await runtime.reconcileOnStartup()

  const logger = createServerLogger()
  const server = startServer(config, runtime, authService, logger, nexusClient)
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
    authService.destroy()
    await server.stop()
    await authProxy.stop()
    await nexusManager.stop()
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
