import fs from 'node:fs'
import path from 'node:path'

export function loadAppTrustConfiguration(resourceDir) {
  const root = path.resolve(resourceDir)
  const configPath = path.join(root, 'trusted-publishers.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (config?.schemaVersion !== 1 || !config.publishers || typeof config.publishers !== 'object') {
    throw new Error(`Invalid App publisher trust configuration: ${configPath}`)
  }
  const trustedPublishers = Object.fromEntries(Object.entries(config.publishers).map(([publisherId, publisher]) => [
    publisherId,
    {
      name: String(publisher?.name || publisherId),
      keys: Object.fromEntries(Object.entries(publisher?.keys || {}).map(([keyId, relativePath]) => {
        const keyPath = path.resolve(root, String(relativePath))
        const relative = path.relative(root, keyPath)
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error(`App publisher key escapes trust directory: ${relativePath}`)
        }
        return [keyId, fs.readFileSync(keyPath, 'utf8')]
      })),
    },
  ]))
  return { config, trustedPublishers }
}

export function loadAppMarketConfiguration(resourceDir) {
  const configPath = path.join(path.resolve(resourceDir), 'catalog.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (config?.schemaVersion !== 1 || typeof config.indexUrl !== 'string') {
    throw new Error(`Invalid App marketplace configuration: ${configPath}`)
  }
  const indexUrl = new URL(process.env.MOSS_APP_MARKET_INDEX_URL || config.indexUrl)
  if (indexUrl.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new Error('The App marketplace index must use HTTPS')
  }
  return { ...config, indexUrl: indexUrl.toString() }
}
