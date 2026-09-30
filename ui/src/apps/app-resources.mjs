import fs from 'node:fs/promises'
import path from 'node:path'
import { isAppResourceUri } from '../shared/app-resource-uri.mjs'
export async function resolveAppResourceFile(runtime, uri) {
  if (!runtime || !isAppResourceUri(uri)) throw new Error('App resource is unavailable')
  const scheme = new URL(uri).protocol.slice(0, -1)
  const { resourceProviders } = await runtime.listContributions({ kinds: ['resourceProviders'] })
  const providers = resourceProviders.filter(provider => provider.schemes.includes(scheme))
  if (providers.length !== 1) throw new Error('App resource requires exactly one enabled provider')
  const provider = providers[0], instance = runtime.resolveContributionInstance(provider.appId)
  const file = await runtime.invokeContribution('resourceProviders', provider.id, { uri })
  if (file?.kind !== 'file' || typeof file.path !== 'string' || !path.isAbsolute(file.path)) throw new Error('App resource did not return a local file')
  const root = await fs.realpath(runtime.appDataPath(runtime.dataDir, provider.appId, 'instances', instance.id))
  const resolved = await fs.realpath(file.path), relative = path.relative(root, resolved)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !(await fs.stat(resolved)).isFile()) throw new Error('App resource file is outside its data directory')
  return { ...file, path: resolved }
}
