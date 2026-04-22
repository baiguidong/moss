import { randomBytes } from 'crypto'
import type { ServerConfig } from './types.js'
import { startServer } from './server.js'
import { SessionManager } from './sessionManager.js'
import { DangerousBackend } from './backends/dangerousBackend.js'
import { printBanner } from './serverBanner.js'
import { createServerLogger } from './serverLog.js'
import {
  writeServerLock,
  removeServerLock,
  probeRunningServer,
} from './lockfile.js'
import { buildConnectUrl } from './parseConnectUrl.js'

export type StandaloneServerOptions = {
  port?: number
  host?: string
  authToken?: string
  unix?: string
  workspace?: string
  idleTimeoutMs?: number
  maxSessions?: number
  printStartupBanner?: boolean
}

export async function startStandaloneDirectConnectServer(
  options: StandaloneServerOptions = {},
): Promise<{
  config: ServerConfig
  authToken: string
  port: number
  httpUrl: string
  connectUrl: string
  stop: () => Promise<void>
}> {
  if (options.unix) {
    throw new Error(
      'Unix domain socket direct-connect is not supported by this build. Use --host/--port instead.',
    )
  }

  const existing = await probeRunningServer()
  if (existing) {
    throw new Error(
      `A claude server is already running (pid ${existing.pid}) at ${existing.httpUrl}`,
    )
  }

  const authToken =
    options.authToken ??
    `sk-ant-cc-${randomBytes(16).toString('base64url')}`
  const config: ServerConfig = {
    port: options.port ?? 0,
    host: options.host ?? '0.0.0.0',
    authToken,
    workspace: options.workspace,
    idleTimeoutMs: options.idleTimeoutMs ?? 10 * 60 * 1000,
    maxSessions: options.maxSessions ?? 32,
  }

  const sessionManager = new SessionManager(new DangerousBackend(), {
    idleTimeoutMs: config.idleTimeoutMs,
    maxSessions: config.maxSessions,
  })
  const logger = createServerLogger()
  const server = startServer(config, sessionManager, logger)
  const actualPort = (await server.ready) ?? config.port
  const connectHost =
    config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host
  const httpUrl = `http://${connectHost}:${actualPort}`
  const connectUrl = buildConnectUrl({
    host: connectHost,
    port: actualPort,
    authToken,
  })

  if (options.printStartupBanner !== false) {
    printBanner(config, authToken, actualPort)
  }

  await writeServerLock({
    pid: process.pid,
    port: actualPort,
    host: config.host,
    httpUrl,
    startedAt: Date.now(),
  })

  let stopped = false
  const stop = async () => {
    if (stopped) {
      return
    }
    stopped = true
    server.stop(true)
    await sessionManager.destroyAll()
    await removeServerLock()
  }

  return {
    config,
    authToken,
    port: actualPort,
    httpUrl,
    connectUrl,
    stop,
  }
}
