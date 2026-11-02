
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
    unix?: string
  },
  actualPort: number,
): void {
  const adminUrl = config.unix
    ? null
    : `http://${displayHost(config.host)}:${actualPort}/admin`

  process.stderr.write(
    [
      '',
      'Moss control plane started.',
      config.unix
        ? `Socket: ${config.unix}`
        : `HTTP: http://${displayHost(config.host)}:${actualPort}`,
      adminUrl ? `Admin: ${adminUrl}` : null,

      '',
    ].filter(Boolean).join('\n'),
  )
}
