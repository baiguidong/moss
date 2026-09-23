import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import type { AuthContext } from '../auth/token.js'
import { CloudError, CloudStorageService, fileInfo } from './service.js'

function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  })
  res.end(data)
}
async function body(req: IncomingMessage, allowed: string[]) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 16384)
      throw new CloudError(
        413,
        'REQUEST_TOO_LARGE',
        'Request body is too large',
      )
    chunks.push(Buffer.from(chunk))
  }
  let value: Record<string, unknown>
  try {
    value = JSON.parse(Buffer.concat(chunks).toString() || '{}')
  } catch {
    throw new CloudError(400, 'INVALID_JSON', 'Invalid JSON')
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(key => !allowed.includes(key))
  )
    throw new CloudError(400, 'INVALID_INPUT', 'Unexpected request field')
  return value
}
export function parseRange(
  range: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!range) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(range)
  const invalid = () => {
    throw new CloudError(
      416,
      'INVALID_RANGE',
      'Requested range is not satisfiable',
    )
  }
  if (!m || (!m[1] && !m[2]) || size === 0) return invalid()
  let start: number, end: number
  if (!m[1]) {
    const suffix = Number(m[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return invalid()
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] ? Number(m[2]) : size - 1
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    end < start
  )
    return invalid()
  return { start, end: Math.min(end, size - 1) }
}
export async function handleCloudStorageRoute(input: {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  auth: AuthContext
  service: CloudStorageService
}) {
  const { req, res, url, auth, service } = input
  const prefix = '/api/v1/cloud-storage'
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`))
    return false
  const path = url.pathname.slice(prefix.length),
    method = req.method
  const permission =
    method === 'GET' || method === 'HEAD'
      ? 'read'
      : method === 'DELETE' && !path.startsWith('/uploads/')
        ? 'delete'
        : 'write'
  const controller = new AbortController()
  const abort = () => {
    if (!res.writableFinished) controller.abort()
  }
  req.once('aborted', abort)
  res.once('close', abort)
  try {
    await service.check(auth, permission)
    if (method === 'GET' && path === '/status') {
      json(res, 200, await service.status())
      return true
    }
    const store = await service.ensure()
    // Recheck after asynchronous storage discovery and after reading request bodies.
    await service.check(auth, permission)
    if (method === 'GET' && path === '/quota')
      json(res, 200, await service.quota(auth))
    else if (method === 'GET' && path === '/uploads')
      json(res, 200, await service.uploadByRequest(auth, url.searchParams.get('requestKey')))
    else if (method === 'GET' && path === '/files')
      json(
        res,
        200,
        await service.list(
          auth,
          url.searchParams.get('parentId'),
          url.searchParams.get('cursor') || undefined,
          Number(url.searchParams.get('limit') || 100),
        ),
      )
    else if (method === 'POST' && path === '/folders') {
      const v = await body(req, ['name', 'parentId'])
      await service.check(auth, permission)
      json(res, 201, await service.folder(auth, v))
    } else if (method === 'POST' && path === '/uploads') {
      const v = await body(req, ['name', 'parentId', 'size', 'requestKey'])
      await service.check(auth, permission)
      json(res, 200, await service.start(auth, v))
    } else {
      const file = /^\/files\/([^/]+)$/.exec(path),
        content = /^\/files\/([^/]+)\/content$/.exec(path)
      const upload = /^\/uploads\/([^/]+)$/.exec(path),
        part = /^\/uploads\/([^/]+)\/parts\/(\d+)$/.exec(path),
        complete = /^\/uploads\/([^/]+)\/complete$/.exec(path)
      if (file && method === 'GET')
        json(res, 200, fileInfo(await service.file(auth, file[1]!)))
      else if (file && method === 'PATCH') {
        const v = await body(req, ['name', 'parentId'])
        await service.check(auth, permission)
        json(res, 200, await service.update(auth, file[1]!, v))
      } else if (file && method === 'DELETE')
        json(res, 200, await service.delete(auth, file[1]!))
      else if (upload && method === 'GET')
        json(res, 200, await service.uploadInfo(auth, upload[1]!))
      else if (upload && method === 'DELETE')
        json(res, 200, await service.cancel(auth, upload[1]!))
      else if (complete && method === 'POST')
        json(res, 200, await service.complete(auth, complete[1]!))
      else if (part && method === 'PUT')
        json(
          res,
          200,
          await service.part(
            auth,
            part[1]!,
            Number(part[2]),
            Number(req.headers['content-length'] ?? -1),
            req,
            controller.signal,
          ),
        )
      else if (content && (method === 'GET' || method === 'HEAD')) {
        const f = await service.file(auth, content[1]!)
        if (f.kind !== 'file')
          throw new CloudError(400, 'NOT_A_FILE', 'Cannot download a folder')
        const etag = `"${f.revision}"`
        if (
          (req.headers['if-match'] && req.headers['if-match'] !== etag) ||
          (req.headers['if-range'] && req.headers['if-range'] !== etag)
        )
          throw new CloudError(
            412,
            'REVISION_CHANGED',
            'File content revision changed',
          )
        res.setHeader('accept-ranges', 'bytes')
        res.setHeader('etag', etag)
        res.setHeader('cache-control', 'private, no-store')
        let range: ReturnType<typeof parseRange>
        try {
          range = parseRange(
            method === 'HEAD' ? undefined : req.headers.range,
            f.size,
          )
        } catch (e) {
          res.setHeader('content-range', `bytes */${f.size}`)
          throw e
        }
        const length = range ? range.end - range.start + 1 : f.size
        res.setHeader('content-type', 'application/octet-stream')
        res.setHeader('x-content-type-options', 'nosniff')
        res.setHeader(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(f.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`,
        )
        if (range)
          res.setHeader(
            'content-range',
            `bytes ${range.start}-${range.end}/${f.size}`,
          )
        if (method === 'HEAD') {
          res.writeHead(200, { 'content-length': length })
          res.end()
        } else {
          const lease = service.acquire(
            auth,
            `download:${f.id}:${crypto.randomUUID()}`,
            'read',
            controller.signal,
          )
          try {
            const stream = await store.get(
              f.objectKey,
              range ? `bytes=${range.start}-${range.end}` : undefined,
              lease.signal,
            )
            try {
              await service.check(auth, 'read')
              await service.file(auth, f.id)
            } catch (e) {
              stream.destroy()
              throw e
            }
            res.writeHead(range ? 206 : 200, { 'content-length': length })
            await pipeline(stream, res, { signal: lease.signal })
          } finally {
            lease.release()
          }
        }
      } else
        throw new CloudError(404, 'NOT_FOUND', 'Unknown cloud storage route')
    }
  } catch (e: any) {
    if (res.headersSent || res.destroyed) res.destroy()
    else {
      const storageFull = e.$metadata?.httpStatusCode === 507
      const status = storageFull ? 507 : e.status || e.statusCode || 502
      json(res, status, {
        error: {
          code:
            e instanceof CloudError
              ? e.code
              : storageFull
                ? 'STORAGE_FULL'
                : status === 401
                  ? 'UNAUTHENTICATED'
                  : status === 403
                    ? 'FORBIDDEN'
                    : 'STORAGE_UNAVAILABLE',
          message: storageFull
            ? 'Object storage is out of space'
            : e instanceof CloudError || status === 401 || status === 403
              ? e.message
              : 'Cloud storage request failed',
        },
      })
    }
  } finally {
    req.off('aborted', abort)
    res.off('close', abort)
  }
  return true
}
