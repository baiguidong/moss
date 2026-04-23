import type { ServerConfig } from './types.js'
import { startServer } from './server.js'
import { SessionManager } from './sessionManager.js'
import { printBanner } from './serverBanner.js'
import { createServerLogger } from './serverLog.js'
import {
  writeServerLock,
  removeServerLock,
  probeRunningServer,
} from './lockfile.js'
import { buildConnectUrl } from './parseConnectUrl.js'
import { RuntimeBackend } from './backends/runtimeBackend.js'
import { writeSessionIndex } from './sessionIndexStore.js'

export type StandaloneServerOptions = {
  port?: number
  host?: string
  authCenterUrl?: string
  runtime?: 'host' | 'docker'
  dockerImage?: string
  dockerMode?: 'session' | 'user'
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

  if (!options.authCenterUrl) {
    throw new Error('Missing --auth-center-url. Session server now requires Auth Center.')
  }

  const config: ServerConfig = {
    port: options.port ?? 0,
    host: options.host ?? '0.0.0.0',
    authMode: 'auth-center',
    authCenterUrl: options.authCenterUrl,
    workspace: options.workspace,
    idleTimeoutMs: options.idleTimeoutMs ?? 10 * 60 * 1000,
    maxSessions: options.maxSessions ?? 32,
    defaultRuntime: options.runtime ?? 'host',
    dockerImage: options.dockerImage,
    dockerMode: options.dockerMode,
  }

  const sessionManager = new SessionManager(
    new RuntimeBackend({
      defaultRuntime: {
        type: config.defaultRuntime,
        dockerImage: config.dockerImage,
        dockerMode: config.dockerMode,
      },
      docker: {
        image: config.dockerImage,
        mode: config.dockerMode,
      },
    }),
    {
      idleTimeoutMs: config.idleTimeoutMs,
      maxSessions: config.maxSessions,
      onSessionsChanged: sessions => {
        void writeSessionIndex(sessions)
      },
    },
  )
  await writeSessionIndex([])
  const logger = createServerLogger()
  const server = startServer(config, sessionManager, logger)
  const actualPort = (await server.ready) ?? config.port
  const connectHost =
    config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host
  const httpUrl = `http://${connectHost}:${actualPort}`
  const connectUrl = buildConnectUrl({
    host: connectHost,
    port: actualPort,
    authMode: config.authMode,
    authCenterUrl: config.authCenterUrl,
  })

  if (options.printStartupBanner !== false) {
    printBanner(config, actualPort)
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
    await writeSessionIndex([])
    await removeServerLock()
  }

  return {
    config,
    port: actualPort,
    httpUrl,
    connectUrl,
    stop,
  }
}
