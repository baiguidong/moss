import fs from 'node:fs/promises'
import path from 'node:path'
import { isAppResourceUri } from '../shared/app-resource-uri.mjs'
export async function resolveAppResourceFile(runtime, uri, session = null) {
  if (!runtime || !isAppResourceUri(uri)) throw new Error('App resource is unavailable')
  const scheme = new URL(uri).protocol.slice(0, -1)
  const { resourceProviders } = await runtime.listContributions({ kinds: ['resourceProviders'] })
  const providers = resourceProviders.filter(provider => provider.schemes.includes(scheme))
  if (providers.length !== 1) throw new Error('App resource requires exactly one enabled provider')
  const provider = providers[0]
  // Contributions already carry the effective user scope, including overrides.
  // Global Apps can produce resources without being selected in the composer.
  if (session && provider.toolScope !== 'global' && !session.appIds?.includes(provider.appId)) {
    throw new Error('The resource App is not enabled in this session')
  }
  const instance = runtime.resolveContributionInstance(provider.appId)
  const file = await runtime.invokeContribution('resourceProviders', provider.id, { uri }, { invocation: { surface: 'app', origin: 'resource', ...(session ? { sessionId: session.id, workspace: session.workspace } : {}) } })
  if (file?.kind !== 'file' || typeof file.path !== 'string' || !path.isAbsolute(file.path)) throw new Error('App resource did not return a local file')
  const pkg = await runtime.getActivePackage(provider.appId)
  const sessionId = new URL(uri).searchParams.get('session') || session?.id
  const root = pkg.manifest.backend?.storage === 'session'
    ? (await runtime.sessionStorage.scope(provider.appId, instance.id, sessionId)).directory
    : await fs.realpath(runtime.appDataPath(runtime.dataDir, provider.appId, 'instances', instance.id))
  const resolved = await fs.realpath(file.path), relative = path.relative(root, resolved)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !(await fs.stat(resolved)).isFile()) throw new Error('App resource file is outside its data directory')
  return { ...file, path: resolved, appId: provider.appId }
}

// Interactive documents must be complete: truncating a script produces a broken
// surface. Only call this with a resource already resolved by its enabled App.
export async function readInteractiveAppResource(file) {
  if (file?.presentation?.type !== 'interactive-html' || path.extname(file.path).toLowerCase() !== '.html') return null
  const handle = await fs.open(file.path, 'r')
  try {
    const limit = 2 * 1024 * 1024, stat = await handle.stat()
    if (!stat.isFile() || stat.size > limit) throw new Error('交互作品超过 2 MiB，无法完整展示')
    const bytes = Buffer.alloc(stat.size), { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    if (bytesRead !== stat.size) throw new Error('交互作品读取不完整，请重试')
    return { path: file.path, relativePath: file.name || path.basename(file.path), size: bytesRead,
      content: bytes.toString('utf8'), contentType: 'html', language: 'html', mimeType: 'text/html', truncated: false,
      metadata: { modifiedAt: stat.mtimeMs, previewEditable: false, previewSaveable: false,
        interactiveVisualization: true, resourceUri: file.resourceUri } }
  } finally { await handle.close() }
}
