/* eslint-disable eslint-plugin-n/no-unsupported-features/node-builtins */

import { errorMessage } from '../utils/errors.js'
import { jsonStringify } from '../utils/slowOperations.js'
import type { DirectConnectConfig } from './directConnectManager.js'
import { connectResponseSchema } from './types.js'
import { resolveDirectConnectAccessToken } from './client/authClient.js'
import type { SessionRuntimeOptions } from './sessionManager.js'

/**
 * Errors thrown by createDirectConnectSession when the connection fails.
 */
export class DirectConnectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DirectConnectError'
  }
}

/**
 * Create a session on a direct-connect server.
 *
 * Posts to `${serverUrl}/sessions`, validates the response, and returns
 * a DirectConnectConfig ready for use by the REPL or headless runner.
 *
 * Throws DirectConnectError on network, HTTP, or response-parsing failures.
 */
export async function createDirectConnectSession({
  serverUrl,
  authToken,
  authCenterUrl,
  apiKey,
  email,
  password,
  cwd,
  dangerouslySkipPermissions,
  runtime,
}: {
  serverUrl: string
  authToken?: string
  authCenterUrl?: string
  apiKey?: string
  email?: string
  password?: string
  cwd: string
  dangerouslySkipPermissions?: boolean
  runtime?: SessionRuntimeOptions
}): Promise<{
  config: DirectConnectConfig
  workDir?: string
}> {
  const resolvedToken = await resolveDirectConnectAccessToken({
    authToken,
    authCenterUrl,
    apiKey,
    email,
    password,
  })
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (resolvedToken) {
    headers['authorization'] = `Bearer ${resolvedToken}`
  }

  let resp: Response
  try {
    resp = await fetch(`${serverUrl}/sessions`, {
      method: 'POST',
      headers,
      body: jsonStringify({
        cwd,
        ...(dangerouslySkipPermissions && {
          dangerously_skip_permissions: true,
        }),
        ...(runtime ? { runtime } : {}),
      }),
    })
  } catch (err) {
    throw new DirectConnectError(
      `Failed to connect to server at ${serverUrl}: ${errorMessage(err)}`,
    )
  }

  if (!resp.ok) {
    throw new DirectConnectError(
      `Failed to create session: ${resp.status} ${resp.statusText}`,
    )
  }

  const result = connectResponseSchema().safeParse(await resp.json())
  if (!result.success) {
    throw new DirectConnectError(
      `Invalid session response: ${result.error.message}`,
    )
  }

  const data = result.data
  return {
    config: {
      serverUrl,
      sessionId: data.session_id,
      wsUrl: data.ws_url,
      authToken: resolvedToken,
    },
    workDir: data.work_dir,
  }
}
