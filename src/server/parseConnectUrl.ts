import path from 'path'

export function buildConnectUrl(options: {
  host: string
  port: number
  authToken: string
  unix?: string
}): string {
  if (options.unix) {
    return `cc+unix://${encodeURIComponent(path.resolve(options.unix))}?token=${encodeURIComponent(options.authToken)}`
  }

  return `cc://${options.host}:${options.port}?token=${encodeURIComponent(options.authToken)}`
}

export function parseConnectUrl(ccUrl: string): {
  serverUrl: string
  authToken: string
} {
  if (ccUrl.startsWith('cc+unix://')) {
    const url = new URL(ccUrl)
    const socketPath = decodeURIComponent(url.hostname + url.pathname)
    const authToken = url.searchParams.get('token') || ''
    if (!socketPath) {
      throw new Error(`Invalid direct-connect URL: ${ccUrl}`)
    }
    if (!authToken) {
      throw new Error(`Missing auth token in direct-connect URL: ${ccUrl}`)
    }
    throw new Error(
      `Unix domain socket direct-connect is not supported by this build (${socketPath}). Use the HTTP listener instead.`,
    )
  }

  if (!ccUrl.startsWith('cc://')) {
    throw new Error(`Invalid direct-connect URL: ${ccUrl}`)
  }

  const url = new URL(ccUrl)
  const authToken = url.searchParams.get('token') || ''
  if (!url.hostname || !url.port) {
    throw new Error(`Invalid direct-connect URL: ${ccUrl}`)
  }
  if (!authToken) {
    throw new Error(`Missing auth token in direct-connect URL: ${ccUrl}`)
  }

  return {
    serverUrl: `http://${url.hostname}:${url.port}`,
    authToken,
  }
}
