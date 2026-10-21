import http from 'node:http'
import fs from 'node:fs/promises'
import { AsyncResource } from 'node:async_hooks'
import path from 'node:path'
import { createWebResources } from '../web/resources.mjs'
import { APP_ERROR_CODES, AppServiceError } from '../../../packages/app-sdk/src/errors.mjs'

const relativeFile = value => typeof value === 'string' && value.length > 0 && value.length <= 4096
  && !value.includes('\\') && !value.includes('\0') && !path.posix.isAbsolute(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..')
const minSignedUrlLifetimeMs = 12 * 3600_000

export function createAppArtifactProtocolDefinition() {
  return { protocol: 'moss.artifacts/v1', methods: { 'url.get': { surfaces: ['backend'],
    validateInput(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'relativePath') || !relativeFile(input.relativePath)) {
        throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid App artifact path')
      }
      return { relativePath: input.relativePath }
    },
    validateOutput(value) {
      if (!value || typeof value.url !== 'string' || !value.url) throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'Invalid App artifact URL')
      return value
    },
  } } }
}

export function createAppArtifactUrls({ web = false, getWebResources = () => null,
  webOwnerId = process.env.MOSS_WEB_OWNER_ID || 'owner', now = Date.now } = {}) {
  const desktopResources = web ? null : createWebResources({ env: {}, maxEntries: 2048, now })
  const cache = new Map()
  const retired = new Set()
  let server = null
  let serverPromise = null
  let closed = false
  const listen = async () => {
    if (closed) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App artifact service is closed')
    if (server) return server
    if (!serverPromise) {
      const next = http.createServer((req, res) => {
        void desktopResources.serve(req, res, new URL(req.url, 'http://localhost')).catch(() => {
          if (!res.headersSent) res.writeHead(404)
          res.end()
        })
      })
      serverPromise = new Promise((resolve, reject) => { next.once('error', reject); next.listen(0, '127.0.0.1', resolve) })
        .then(async () => {
          if (closed) { await new Promise(resolve => next.close(resolve)); throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App artifact service is closed') }
          next.unref()
          server = next
          return next
        }).finally(() => { serverPromise = null })
    }
    return serverPromise
  }
  const pruneCache = () => {
    for (const [key, entry] of cache) {
      if (entry.pending) continue
      let current = false
      try { entry.assertCurrent(); current = true } catch {}
      if (!entry.handle?.active() || !current) { entry.handle?.revoke(); cache.delete(key) }
    }
  }
  const pruneRetired = () => {
    for (const entry of retired) {
      let current = false
      try { entry.assertCurrent(); current = true } catch {}
      if (!entry.handle.active() || !current) { entry.handle.revoke(); retired.delete(entry) }
    }
  }
  const createHandle = (key, resources, root, context, entry) => {
    entry.pending = resources.create({ root, entryPath: root,
      ownerId: web ? webOwnerId : context.owner?.key || 'host', stream: true,
      signedScope: key, allowAppFrames: !web, validate: () => entry.assertCurrent() }).then(handle => {
      if (closed || cache.get(key) !== entry) { handle.revoke(); throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App artifact service is closed') }
      if (entry.handle?.active()) retired.add({ handle: entry.handle, assertCurrent: entry.assertCurrent })
      else entry.handle?.revoke()
      entry.handle = handle
      entry.pending = null
      return handle
    }).catch(error => {
      entry.pending = null
      if (cache.get(key) === entry) {
        // Keep existing URLs usable if rotation cannot reserve another slot.
        if (!closed && entry.handle?.active()) return entry.handle
        entry.handle?.revoke()
        cache.delete(key)
      }
      throw error
    })
    return entry.pending
  }
  const handleFor = (key, resources, root, context) => {
    const cached = cache.get(key)
    if (cached?.pending) return cached.pending
    if (cached?.handle?.active()) {
      if (!Number.isFinite(cached.handle.expiresAt) || cached.handle.expiresAt - now() >= minSignedUrlLifetimeMs) return Promise.resolve(cached.handle)
      pruneRetired()
      return createHandle(key, resources, root, context, cached)
    }
    if (cached) { cached.handle?.revoke(); cache.delete(key) }
    pruneRetired()
    pruneCache()
    // The Host authorization callback reads the App owner's async context.
    // Resource requests arrive later in a separate HTTP async context. This
    // validation must not depend on the lifetime of the issuing Host request.
    const entry = { handle: null, pending: null,
      assertCurrent: AsyncResource.bind(() => (context.assertAppCurrent || context.assertCurrent).call(context)) }
    cache.set(key, entry)
    return createHandle(key, resources, root, context, entry)
  }
  return {
    async url(input, context) {
      if (closed) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App artifact service is closed')
      context.assertCurrent()
      if (!relativeFile(input.relativePath) || !context.dataDir) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid App artifact path')
      const root = await fs.realpath(context.dataDir)
      const target = await fs.realpath(path.join(root, input.relativePath))
      const relative = path.relative(root, target)
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !(await fs.stat(target)).isFile()) {
        throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'Artifact is outside the App data directory')
      }
      const resources = web ? getWebResources() : desktopResources
      if (!resources) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App artifact service is unavailable')
      const key = JSON.stringify([context.owner?.key, context.appId, context.instanceId,
        context.installationIncarnationId, context.instanceIncarnationId, context.generation, context.version, root])
      const handle = await handleFor(key, resources, root, context)
      const signedUrl = await handle.urlFor(target)
      const url = web ? signedUrl : `http://127.0.0.1:${(await listen()).address().port}${signedUrl}`
      context.assertCurrent()
      if (closed) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App artifact service is closed')
      return { url }
    },
    async close() {
      closed = true
      await Promise.allSettled([...cache.values()].map(entry => entry.pending).filter(Boolean))
      for (const entry of cache.values()) entry.handle?.revoke()
      cache.clear()
      for (const entry of retired) entry.handle.revoke()
      retired.clear()
      desktopResources?.close()
      if (serverPromise) await serverPromise.catch(() => {})
      if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); server = null }
    },
  }
}
