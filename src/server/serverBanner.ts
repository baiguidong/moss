import { buildConnectUrl } from './parseConnectUrl.js'

function displayHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') {
    return '127.0.0.1'
  }
  return host
}

export function printBanner(
  config: {
    host: string
    port: number
    authMode?: 'auth-center'
    authCenterUrl?: string
    unix?: string
  },
  actualPort: number,
): void {
  const connectUrl = buildConnectUrl({
    host: displayHost(config.host),
    port: actualPort,
    authMode: config.authMode,
    authCenterUrl: config.authCenterUrl,
    unix: config.unix,
  })

  process.stderr.write(
    [
      '',
      'Claude Code session server started.',
      config.unix
        ? `Socket: ${config.unix}`
        : `HTTP: http://${config.host}:${actualPort}`,
      `Connect: ${connectUrl}`,
      '',
    ].join('\n'),
  )
}
