import path from 'path'

export function buildConnectUrl(options: {
  host: string
  port: number
  authMode?: 'auth-center'
  authCenterUrl?: string
  unix?: string
}): string {
  const searchParams = new URLSearchParams()
  if (options.authMode === 'auth-center') {
    searchParams.set('auth_mode', 'auth-center')
    if (options.authCenterUrl) {
      searchParams.set('auth_center', options.authCenterUrl)
    }
  }

  if (options.unix) {
    const query = searchParams.toString()
    return `cc+unix://${encodeURIComponent(path.resolve(options.unix))}${query ? `?${query}` : ''}`
  }

  const query = searchParams.toString()
  return `cc://${options.host}:${options.port}${query ? `?${query}` : ''}`
}

export function parseConnectUrl(
  ccUrl: string,
  options?: {
    allowMissingAuthInfo?: boolean
  },
): {
  serverUrl: string
  authCenterUrl?: string
  authMode: 'auth-center'
} {
  if (ccUrl.startsWith('cc+unix://')) {
    const url = new URL(ccUrl)
    const socketPath = decodeURIComponent(url.hostname + url.pathname)
    if (!socketPath) {
      throw new Error(`Invalid direct-connect URL: ${ccUrl}`)
    }
    throw new Error(
      `Unix domain socket direct-connect is not supported by this build (${socketPath}). Use the HTTP listener instead.`,
    )
  }

  if (!ccUrl.startsWith('cc://')) {
    throw new Error(`Invalid direct-connect URL: ${ccUrl}`)
  }

  const url = new URL(ccUrl)
  if (url.searchParams.get('token')) {
    throw new Error(
      `Static token URLs are no longer supported: ${ccUrl}. Use Auth Center instead.`,
    )
  }
  const authCenterUrl = url.searchParams.get('auth_center') || ''
  if (!url.hostname || !url.port) {
    throw new Error(`Invalid direct-connect URL: ${ccUrl}`)
  }
  if (!authCenterUrl && !options?.allowMissingAuthInfo) {
    throw new Error(`Missing auth information in direct-connect URL: ${ccUrl}`)
  }

  return {
    serverUrl: `http://${url.hostname}:${url.port}`,
    authCenterUrl: authCenterUrl || undefined,
    authMode: 'auth-center',
  }
}
