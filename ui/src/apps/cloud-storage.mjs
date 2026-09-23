import { createHash, randomUUID } from 'node:crypto'
import { constants, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { open, stat, lstat, realpath, link, unlink } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { getRemoteDirectSettings } from '../remote-direct-client.mjs'
import { CLOUD_STORAGE_HOST_METHOD_PERMISSIONS } from '../../../packages/app-sdk/src/index.mjs'

class CloudHostError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status }
}
const error = (code, message) => { throw new CloudHostError(code, message) }
const terminal = t => ['completed', 'cancelled'].includes(t.state)
const snapshot = s => ({ size: s.size, mtimeMs: s.mtimeMs, ino: s.ino, dev: s.dev })
const equalSource = (a, b) => ['size', 'mtimeMs', 'ino', 'dev'].every(k => a[k] === b[k])
const sameAccount = (a, b) => ['serverUrl', 'orgId', 'userId'].every(k => a[k] === b[k])
const fileIdentity = s => ({ ino: s.ino, dev: s.dev, birthtimeMs: s.birthtimeMs })
const sameFile = (s, identity) => s?.isFile() && identity && s.ino === identity.ino && s.dev === identity.dev && (identity.birthtimeMs === undefined || s.birthtimeMs === identity.birthtimeMs)
const noHardLinks = e => ['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EPERM', 'EXDEV'].includes(e.code)

// The App sees handles and task IDs only. Bytes never enter the Host JSON channel.
export class CloudStorageHost {
  constructor({ directory, getSettings, resolveConnection, fetchImpl = fetch, pickFiles, pickDestination, authorizeApp, publish = () => {}, linkFile = link }) {
    Object.assign(this, { directory, getSettings, resolveConnection, fetchImpl, pickFiles, pickDestination, authorizeApp, publish, linkFile })
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.statePath = path.join(directory, 'transfers.json')
    this.tasks = new Map(); this.handles = new Map(); this.running = new Map(); this.cancellations = new Map(); this.requests = new Set()
    this.contexts = new Map(); this.lastStatus = null; this.lastStatusProbe = 0
    this.epoch = 0; this.connectionCache = null; this.closed = false; this.slots = 0
    if (existsSync(this.statePath)) {
      const saved = JSON.parse(readFileSync(this.statePath, 'utf8'))
      if (saved.version !== 1 || !Array.isArray(saved.tasks)) throw new Error('Unsupported cloud transfer state')
      for (const t of saved.tasks) {
        if (!terminal(t)) { t.state = 'paused'; t.error = t.cancelRequested ? 'CANCEL_PENDING' : 'HOST_RESTARTED' }
        this.tasks.set(t.id, t)
      }
    }
    this.lastSettings = this.fingerprint()
    this.watchTimer = setInterval(() => { void this.watch().catch(() => {}) }, 2000)
    this.watchTimer.unref?.()
  }
  fingerprint() {
    const { workspace: _, ...connection } = getRemoteDirectSettings(this.getSettings())
    return createHash('sha256').update(JSON.stringify(connection)).digest('hex')
  }
  persist() {
    writeFileSync(`${this.statePath}.new`, JSON.stringify({ version: 1, tasks: [...this.tasks.values()] }), { mode: 0o600 })
    renameSync(`${this.statePath}.new`, this.statePath)
  }
  publicTask(t) {
    return { id: t.id, transferId: t.id, direction: t.direction, name: t.name, fileId: t.fileId || null, state: t.state, totalBytes: t.size, transferredBytes: t.transferred || 0, error: t.error || null, createdAt: t.createdAt, updatedAt: t.updatedAt }
  }
  changed(t, event = 'transfers.changed') {
    t.updatedAt = Date.now()
    if (event !== 'transfers.progress') {
      try { this.persist(); this.persistenceError = null }
      catch (e) {
        this.persistenceError = e
        t.error = e.code || 'TRANSFER_STATE_WRITE_FAILED'
        if (!terminal(t)) t.state = 'paused'
        this.running.get(t.id)?.abort()
        this.cancellations.get(t.id)?.abort()
      }
    }
    if (t.binding.settingsKey === this.fingerprint()) {
      try { this.publish(t.context, event, this.publicTask(t)) } catch { /* App may have closed. Query restores state. */ }
    }
  }
  async allowed(context, permission) {
    if (!await this.authorizeApp(context, permission)) error('PERMISSION_DENIED', 'App permission was revoked or the App is disabled')
  }
  async watch() {
    if (this.closed) return
    const current = this.fingerprint()
    if (current !== this.lastSettings || this.getSettings().remoteEnabled !== true) {
      if (current !== this.lastSettings || this.running.size || this.cancellations.size || this.requests.size) this.invalidate('REMOTE_CONNECTION_CHANGED')
      this.lastSettings = current
    }
    for (const [id, running] of [...this.running, ...this.cancellations]) {
      const t = this.tasks.get(id)
      try { await this.allowed(t.context, t.permission) } catch {
        running.abort()
        if (!terminal(t)) { t.state = 'paused'; t.error = 'PERMISSION_DENIED'; this.changed(t) }
      }
    }
    for (const [key, context] of this.contexts) {
      try { await this.allowed(context, 'cloud-storage:read') } catch { this.contexts.delete(key) }
    }
    if (this.contexts.size && Date.now() - this.lastStatusProbe > 30000) await this.status()
  }
  invalidate(reason = 'REMOTE_CONNECTION_CHANGED') {
    this.epoch++; this.connectionCache = null; this.handles.clear()
    for (const [id, controller] of [...this.running, ...this.cancellations]) {
      const t = this.tasks.get(id); if (!terminal(t)) { t.state = 'paused'; t.error = reason; this.changed(t) }; controller.abort()
    }
    for (const controller of this.requests) controller.abort()
    this.lastSettings = this.fingerprint()
    this.statusChanged({ state: this.getSettings().remoteEnabled === true ? 'unauthenticated' : 'remote_disabled' })
  }
  async connection(binding) {
    if (this.closed || this.getSettings().remoteEnabled !== true) error('REMOTE_DISABLED', 'Remote connection is disabled')
    const settingsKey = this.fingerprint(), epoch = this.epoch
    if (binding && binding.settingsKey !== settingsKey) error('ACCOUNT_CHANGED', 'Transfer belongs to a different connection')
    const config = getRemoteDirectSettings(this.getSettings())
    if (!config.serverUrl) error('UNCONFIGURED', 'Remote server is not configured')
    if (!(config.credentialMode === 'api-key' ? config.apiKey : config.userEmail && config.userPassword)) error('UNAUTHENTICATED', 'Sign in to the remote server')
    let conn = this.connectionCache
    if (!conn || conn.settingsKey !== settingsKey || conn.expiry < Date.now()) {
      const controller = new AbortController()
      this.requests.add(controller)
      const timeout = setTimeout(() => controller.abort(), 30000)
      let resolved
      try { resolved = await this.resolveConnection({ signal: controller.signal, fetchImpl: this.fetchImpl, redirect: 'error' }) }
      finally { clearTimeout(timeout); this.requests.delete(controller) }
      if (epoch !== this.epoch || this.fingerprint() !== settingsKey || this.getSettings().remoteEnabled !== true) error('ACCOUNT_CHANGED', 'Remote connection changed')
      if (!resolved.userId || !resolved.orgId || !resolved.authToken) error('UNAUTHENTICATED', 'Remote authentication did not return an identity')
      let expiry = Date.now() + 60000
      try { expiry = JSON.parse(Buffer.from(resolved.authToken.split('.')[1], 'base64url').toString()).exp * 1000 - 30000 } catch {}
      conn = { ...resolved, settingsKey, expiry }; this.connectionCache = conn
    }
    if (binding && !sameAccount(conn, binding)) error('ACCOUNT_CHANGED', 'Transfer belongs to another user')
    return conn
  }
  binding(conn) { return { settingsKey: conn.settingsKey, serverUrl: conn.serverUrl, orgId: conn.orgId, userId: conn.userId } }
  async request(binding, suffix, init = {}, signal, raw = false) {
    const conn = await this.connection(binding)
    const controller = new AbortController(), abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort()
    const timeout = setTimeout(abort, 15 * 60000)
    this.requests.add(controller)
    try {
      const response = await this.fetchImpl(`${conn.serverUrl}/api/v1/cloud-storage${suffix}`, {
        ...init, redirect: 'error', signal: controller.signal,
        headers: { authorization: `Bearer ${conn.authToken}`, ...init.headers },
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        if (response.status === 401) this.connectionCache = null
        throw new CloudHostError(data.error?.code || (response.status === 401 ? 'UNAUTHENTICATED' : response.status === 404 ? 'NOT_FOUND' : 'REQUEST_FAILED'), data.error?.message || `Cloud request failed (${response.status})`, response.status)
      }
      if (raw) return response
      return await response.json()
    } finally {
      // A streamed response remains covered by its transfer controller and timeout.
      clearTimeout(timeout); signal?.removeEventListener('abort', abort); this.requests.delete(controller)
    }
  }
  json(binding, suffix, method, data, signal) { return this.request(binding, suffix, { method, headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) }, signal) }
  async status() {
    this.lastStatusProbe = Date.now()
    let result
    if (this.getSettings().remoteEnabled !== true) result = { state: 'remote_disabled' }
    else try { result = await this.request(null, '/status') }
    catch (e) {
      result = { state: ({ REMOTE_DISABLED: 'remote_disabled', UNCONFIGURED: 'unconfigured', UNAUTHENTICATED: 'unauthenticated' })[e.code] || (e.status === 401 ? 'unauthenticated' : e.status === 403 ? 'forbidden' : e.status === 404 ? 'unsupported' : 'unavailable') }
    }
    this.statusChanged(result)
    return result
  }
  statusChanged(result) {
    if (this.lastStatus === result.state) return
    this.lastStatus = result.state
    for (const ctx of this.contexts.values()) try { this.publish(ctx, 'storage.status-changed', result) } catch {}
  }
  async transferAccount() {
    // Local history remains available offline for the unchanged connection.
    if (this.getSettings().remoteEnabled !== true) return null
    try { return await this.connection() }
    catch { return null } // A different fingerprint still requires a verified identity.
  }
  visible(t, context, conn) {
    return t.context.appId === context.appId && t.context.instanceId === context.instanceId
      && (conn ? sameAccount(t.binding, conn) : t.binding.settingsKey === this.fingerprint())
  }
  async owned(context, transferId) {
    const t = this.tasks.get(transferId)
    if (!t || !this.visible(t, context, await this.transferAccount())) error('TRANSFER_NOT_FOUND', 'Transfer not found')
    return t
  }
  async rebind(t, cancelling = false) {
    const conn = await this.connection()
    if (!sameAccount(t.binding, conn)) error('ACCOUNT_CHANGED', 'Transfer belongs to another user')
    if (this.running.has(t.id) || (!cancelling && this.cancellations.has(t.id))) error('TRANSFER_BUSY', 'Transfer is stopping; retry shortly')
    // Call only after the old operation has stopped; its binding is never mutated in flight.
    t.binding = this.binding(conn)
  }
  async handle(method, input, context) {
    const permission = CLOUD_STORAGE_HOST_METHOD_PERMISSIONS[method]
    await this.allowed(context, permission)
    this.contexts.set(`${context.appId}/${context.instanceId}`, { appId: context.appId, instanceId: context.instanceId })
    if (method === 'status.get') return this.status()
    if (method === 'transfers.list') {
      const conn = await this.transferAccount(), limit = input.limit ?? 100
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) error('INVALID_INPUT', 'Limit must be 1..200')
      const tasks = [...this.tasks.values()].filter(t => this.visible(t, context, conn) && t.id > (input.cursor || ''))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      return { transfers: tasks.slice(0, limit).map(t => this.publicTask(t)), nextCursor: tasks.length > limit ? tasks[limit - 1].id : null }
    }
    if (method.startsWith('transfers.')) {
      const t = await this.owned(context, input.transferId)
      if (method === 'transfers.get') return this.publicTask(t)
      await this.allowed(context, t.permission)
      if (method === 'transfers.pause' && !terminal(t)) { t.state = 'paused'; this.running.get(t.id)?.abort(); this.cancellations.get(t.id)?.abort(); this.changed(t) }
      if (method === 'transfers.cancel' && !terminal(t)) {
        this.cancel(t)
      }
      if (method === 'transfers.resume' && !terminal(t)) {
        if (this.running.has(t.id) || this.cancellations.has(t.id)) error('TRANSFER_BUSY', 'Transfer is stopping; retry shortly')
        await this.rebind(t)
        if (t.cancelRequested) this.cancel(t)
        else { t.state = 'queued'; t.error = null; this.changed(t); this.launch(t) }
      }
      return this.publicTask(t)
    }
    const conn = await this.connection(), binding = this.binding(conn)
    if (method === 'local-files.pick') {
      const selected = await this.pickFiles()
      const files = []
      for (const filename of selected.slice(0, 100)) {
        const filenameResolved = await realpath(filename), s = await stat(filenameResolved)
        if (!s.isFile()) continue
        const handle = randomUUID()
        this.handles.set(handle, { path: filenameResolved, source: snapshot(s), appId: context.appId, instanceId: context.instanceId, binding, expiresAt: Date.now() + 86400000 })
        files.push({ handle, name: path.basename(filenameResolved), size: s.size })
      }
      return { files }
    }
    if (method === 'uploads.start' || method === 'downloads.start') {
      const t = { id: randomUUID(), binding, context: { appId: context.appId, instanceId: context.instanceId }, permission, state: 'queued', createdAt: Date.now(), updatedAt: Date.now(), transferred: 0 }
      if (method === 'uploads.start') {
        const h = this.handles.get(input.handle)
        if (!h || h.appId !== context.appId || h.instanceId !== context.instanceId || h.expiresAt < Date.now() || JSON.stringify(h.binding) !== JSON.stringify(binding)) error('INVALID_HANDLE', 'File handle is not available to this App and account')
        Object.assign(t, { direction: 'upload', uploadAttempted: false, sourcePath: h.path, source: h.source, size: h.source.size, name: input.name || path.basename(h.path), parentId: input.parentId || null })
      } else {
        const file = await this.request(binding, `/files/${encodeURIComponent(input.fileId)}`)
        if (file.kind !== 'file') error('NOT_A_FILE', 'Cannot download a folder')
        const destination = await this.pickDestination(file.name)
        if (!destination) error('CANCELLED', 'Save dialog was cancelled')
        Object.assign(t, { direction: 'download', fileId: file.id, revision: file.revision, name: file.name, size: file.size, destination, temporary: `${destination}.moss-${t.id}.part` })
      }
      await this.connection(binding); await this.allowed(context, permission)
      this.tasks.set(t.id, t); this.changed(t); this.launch(t)
      return { transferId: t.id }
    }
    const fileId = encodeURIComponent(input.fileId || '')
    if (method === 'quota.get') return this.request(binding, '/quota')
    if (method === 'files.list') return this.request(binding, `/files?${new URLSearchParams(Object.entries(input).filter(([, v]) => v != null))}`)
    if (method === 'files.get') return this.request(binding, `/files/${fileId}`)
    if (method === 'files.delete') return this.json(binding, `/files/${fileId}`, 'DELETE')
    if (method === 'folders.create') return this.json(binding, '/folders', 'POST', input)
    if (method === 'files.update') { const { fileId: _, ...changes } = input; return this.json(binding, `/files/${fileId}`, 'PATCH', changes) }
    error('UNKNOWN_METHOD', 'Unknown cloud storage method')
  }
  launch(t) {
    if (this.closed || this.running.has(t.id) || t.state !== 'queued') return
    const controller = new AbortController(); this.running.set(t.id, controller)
    const work = async () => {
      try {
        await this.allowed(t.context, t.permission); await this.connection(t.binding)
        controller.signal.throwIfAborted()
        t.state = 'running'; this.changed(t)
        const committed = t.direction === 'upload' ? await this.upload(t, controller.signal) : await this.download(t, controller.signal)
        if (committed) this.settle(t, 'completed')
      } catch (e) {
        if (!terminal(t) && t.state !== 'paused') { t.state = 'paused'; t.error = e.code || (controller.signal.aborted ? 'INTERRUPTED' : 'TRANSFER_FAILED'); this.changed(t) }
      } finally {
        this.running.delete(t.id)
      }
    }
    controller.done = work().catch(e => { t.state = 'paused'; t.error = e.code || 'TRANSFER_FAILED'; this.changed(t) })
  }
  async retry(fn, signal) {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted()
      try { return await fn() } catch (e) {
        if (attempt >= 3 || signal.aborted || (e.status && ![408,429,500,502,503,504].includes(e.status) && e.code !== 'UPLOAD_BUSY') || ['ACCOUNT_CHANGED','PERMISSION_DENIED','REMOTE_DISABLED','SOURCE_CHANGED','REVISION_CHANGED','DESTINATION_CHANGED','EEXIST'].includes(e.code)) throw e
        await delay(500 * 2 ** attempt, undefined, { signal })
      }
    }
  }
  async slot(fn, signal) {
    while (this.slots >= 3) await delay(50, undefined, { signal })
    signal.throwIfAborted(); this.slots++
    try { return await fn() } finally { this.slots-- }
  }
  async source(t) {
    const f = await open(t.sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    if (!equalSource(t.source, snapshot(await f.stat()))) { await f.close(); error('SOURCE_CHANGED', 'Selected source file changed') }
    return f
  }
  async upload(t, signal) {
    if (!t.uploadId) {
      const source = await this.source(t); await source.close()
      signal.throwIfAborted(); t.uploadAttempted = true; this.persist()
    }
    let u = t.uploadId ? await this.request(t.binding, `/uploads/${t.uploadId}`, {}, signal) : await this.retry(() => this.json(t.binding, '/uploads', 'POST', { requestKey: t.id, name: t.name, parentId: t.parentId, size: t.size }, signal), signal)
    t.uploadId = u.id; t.fileId = u.fileId; this.persist()
    if (u.state === 'completed') return true
    if (u.state === 'completing') { await this.retry(() => this.json(t.binding, `/uploads/${u.id}/complete`, 'POST', {}, signal), signal); return true }
    if (u.state !== 'uploading') error('UPLOAD_EXPIRED', `Upload is ${u.state}; start a new transfer`)
    const completed = new Set(u.parts.map(p => p.number)), inflight = new Map()
    let confirmed = u.parts.reduce((n, p) => n + p.size, 0), next = 1, lastEvent = 0
    const update = () => { t.transferred = confirmed + [...inflight.values()].reduce((a,b) => a + b, 0); if (Date.now() - lastEvent > 200) { lastEvent = Date.now(); this.changed(t, 'transfers.progress') } }
    const count = Math.ceil(t.size / u.partSize)
    const workers = Array.from({ length: 3 }, async () => {
      while (next <= count) {
        const number = next++; if (completed.has(number)) continue
        const size = Math.min(u.partSize, t.size - (number - 1) * u.partSize)
        await this.slot(() => this.retry(async () => {
          await this.allowed(t.context, t.permission)
          const fd = await this.source(t)
          const src = fd.createReadStream({ start: (number - 1) * u.partSize, end: (number - 1) * u.partSize + size - 1, autoClose: false })
          inflight.set(number, 0)
          const counter = new Transform({ transform(chunk, _encoding, cb) { inflight.set(number, inflight.get(number) + chunk.length); update(); cb(null, chunk) } })
          try {
            await Promise.all([
              pipeline(src, counter, { signal }),
              this.request(t.binding, `/uploads/${u.id}/parts/${number}`, { method: 'PUT', body: Readable.toWeb(counter), duplex: 'half' }, signal).catch(e => { counter.destroy(e); throw e }),
            ])
            if (!equalSource(t.source, snapshot(await fd.stat()))) error('SOURCE_CHANGED', 'Source changed during upload')
          } finally { src.destroy(); counter.destroy(); await fd.close() }
        }, signal), signal)
        inflight.delete(number); confirmed += size; update(); this.persist()
      }
    })
    // A failed worker stops its siblings before any completion can be attempted.
    try { await Promise.all(workers) } catch (e) { this.running.get(t.id)?.abort(); await Promise.allSettled(workers); throw e }
    const finalSource = await this.source(t); await finalSource.close()
    await this.allowed(t.context, t.permission)
    await this.retry(() => this.json(t.binding, `/uploads/${u.id}/complete`, 'POST', {}, signal), signal)
    return true
  }
  async download(t, signal) {
    return this.slot(() => this.retry(async () => {
      const downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(15 * 60000)])
      await this.allowed(t.context, t.permission)
      const file = await this.request(t.binding, `/files/${t.fileId}`, {}, signal)
      if (file.revision !== t.revision || file.size !== t.size) error('REVISION_CHANGED', 'Remote file changed; start a new download')
      if (await this.downloadPublished(t)) {
        await unlink(t.temporary).catch(() => {}); return true
      }
      let fd
      try { fd = await open(t.temporary, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, 0o600) }
      catch (e) { if (e.code !== 'EEXIST') throw e; fd = await open(t.temporary, constants.O_RDWR | (constants.O_NOFOLLOW || 0)) }
      try {
        const s = await fd.stat(), offset = s.size
        if (!s.isFile() || offset > t.size || (t.tempIdentity && (s.ino !== t.tempIdentity.ino || s.dev !== t.tempIdentity.dev))) error('DESTINATION_CHANGED', 'Temporary download file changed')
        t.tempIdentity = fileIdentity(s); t.transferred = offset; this.persist()
        if (offset < t.size) {
          const response = await this.request(t.binding, `/files/${t.fileId}/content`, { headers: { 'if-match': `"${t.revision}"`, ...(offset ? { range: `bytes=${offset}-` } : {}) } }, downloadSignal, true)
          if (response.headers.get('etag') !== `"${t.revision}"` || (offset && (response.status !== 206 || response.headers.get('content-range') !== `bytes ${offset}-${t.size - 1}/${t.size}`)) || Number(response.headers.get('content-length')) !== t.size - offset) { await response.body?.cancel(); error('REVISION_CHANGED', 'Download response does not match the expected content') }
          let received = offset, lastEvent = 0
          const self = this
          const counter = new Transform({ transform(chunk, _encoding, cb) { received += chunk.length; t.transferred = received; if (Date.now() - lastEvent > 200) { lastEvent = Date.now(); self.changed(t, 'transfers.progress') }; cb(received > t.size ? new Error('Download exceeded expected size') : null, chunk) } })
          const output = fd.createWriteStream({ start: offset, autoClose: false })
          try { await pipeline(Readable.fromWeb(response.body), counter, output, { signal: downloadSignal }) }
          finally { output.destroy() }
          if (received !== t.size) error('INCOMPLETE_DOWNLOAD', 'Download was interrupted')
        }
        await fd.sync()
      } finally { await fd.close() }
      signal.throwIfAborted(); await this.allowed(t.context, t.permission); await this.connection(t.binding)
      signal.throwIfAborted()
      t.finalizing = true; this.persist()
      return this.publishDownload(t, signal)
    }, signal), signal)
  }
  async destinationStat(t) {
    try { return await lstat(t.destination) }
    catch (e) { if (e.code === 'ENOENT') return null; throw e }
  }
  async downloadPublished(t) {
    if (!t.finalizing) return false
    const s = await this.destinationStat(t)
    return Boolean(s?.size === t.size && (t.copyDestination
      ? t.copyDestination.complete && sameFile(s, t.copyDestination)
      : sameFile(s, t.tempIdentity)))
  }
  async publishDownload(t, signal) {
    // Hard links publish atomically without replacing another file.
    if (!t.copyDestination) {
      try {
        await this.linkFile(t.temporary, t.destination)
        await unlink(t.temporary).catch(() => {})
        return true
      } catch (e) { if (!noHardLinks(e)) throw e }
    }
    // exFAT/FAT cannot link. Exclusively create the destination and persist its
    // identity before streaming a copy; retries only reopen that owned file.
    const source = await open(t.temporary, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    let destination
    try {
      const s = await source.stat()
      if (!sameFile(s, t.tempIdentity) || s.size !== t.size) error('DESTINATION_CHANGED', 'Temporary download file changed')
      if (t.copyDestination) {
        try { destination = await open(t.destination, constants.O_RDWR | (constants.O_NOFOLLOW || 0)) }
        catch (e) { if (e.code !== 'ENOENT') throw e; t.copyDestination = null }
        if (destination && !sameFile(await destination.stat(), t.copyDestination)) error('DESTINATION_CHANGED', 'Download destination changed')
      }
      if (!destination) {
        destination = await open(t.destination, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, 0o600)
        t.copyDestination = { ...fileIdentity(await destination.stat()), complete: false }
        this.persist()
      }
      signal.throwIfAborted()
      await destination.truncate(0)
      // Keep ownership of both descriptors until fsync. Destroying a stream
      // backed by a FileHandle can close it even with autoClose disabled.
      const buffer = Buffer.allocUnsafe(256 * 1024)
      let position = 0
      while (position < t.size) {
        signal.throwIfAborted()
        const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, t.size - position), position)
        if (!bytesRead) error('INCOMPLETE_DOWNLOAD', 'Temporary download file was truncated')
        let written = 0
        while (written < bytesRead) {
          signal.throwIfAborted()
          const { bytesWritten } = await destination.write(buffer, written, bytesRead - written, position + written)
          if (!bytesWritten) error('INCOMPLETE_DOWNLOAD', 'Destination copy stopped making progress')
          written += bytesWritten
        }
        position += bytesRead
      }
      await destination.sync()
      if ((await destination.stat()).size !== t.size) error('INCOMPLETE_DOWNLOAD', 'Destination copy was interrupted')
      await this.allowed(t.context, t.permission); await this.connection(t.binding); signal.throwIfAborted()
      t.copyDestination.complete = true
      this.persist()
    } finally { try { await destination?.close() } finally { await source.close() } }
    await unlink(t.temporary).catch(() => {})
    return true
  }
  settle(t, state) {
    t.state = state; t.error = null; t.cancelRequested = false
    if (state === 'completed') t.transferred = t.size
    this.changed(t)
  }
  cancel(t) {
    if (this.cancellations.has(t.id)) return
    const previous = this.running.get(t.id), controller = new AbortController()
    this.cancellations.set(t.id, controller)
    t.cancelRequested = true; t.state = 'paused'; t.error = 'CANCEL_PENDING'
    previous?.abort(); this.changed(t)
    controller.done = (async () => {
      try {
        await previous?.done
        controller.signal.throwIfAborted()
        if (terminal(t)) return // Publication may have committed before cancellation.
        await this.allowed(t.context, t.permission)
        if (t.direction === 'upload' && (t.uploadId || t.uploadAttempted !== false)) await this.rebind(t, true)
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])
        this.settle(t, await this.cleanup(t, signal))
      } catch (e) {
        if (!terminal(t)) { t.state = 'paused'; t.error = typeof e.code === 'string' ? e.code : 'CANCEL_NOT_CONFIRMED'; this.changed(t) }
      } finally { this.cancellations.delete(t.id) }
    })()
  }
  async cleanup(t, signal) {
    signal.throwIfAborted()
    if (t.direction === 'download') {
      if (await this.downloadPublished(t)) return 'completed'
      if (t.copyDestination) {
        const s = await this.destinationStat(t)
        if (s) {
          if (!sameFile(s, t.copyDestination)) error('DESTINATION_CHANGED', 'Download destination changed')
          await unlink(t.destination)
        }
      }
      await unlink(t.temporary).catch(e => { if (e.code !== 'ENOENT') throw e })
      return 'cancelled'
    }
    if (!t.uploadId) {
      if (t.uploadAttempted === false) return 'cancelled'
      // Recover a lost initialization response without allocating a new upload.
      let u
      try { u = await this.request(t.binding, `/uploads?requestKey=${encodeURIComponent(t.id)}`, {}, signal) }
      catch (e) {
        if (e.code === 'UPLOAD_NOT_FOUND') error('CANCEL_NOT_CONFIRMED', 'Upload initialization may still be in flight; retry cancellation')
        throw e
      }
      t.uploadId = u.id; t.fileId = u.fileId; this.persist()
    }
    try { await this.retry(() => this.json(t.binding, `/uploads/${t.uploadId}`, 'DELETE', undefined, signal), signal) }
    catch (e) { if (e.code === 'UPLOAD_COMPLETED') return 'completed'; throw e }
    return 'cancelled'
  }
  async close() {
    this.closed = true; clearInterval(this.watchTimer); this.invalidate('HOST_STOPPED')
    await Promise.allSettled([...this.running.values(), ...this.cancellations.values()].map(c => c.done))
    try { this.persist() } catch (e) { this.persistenceError = e }
  }
}
