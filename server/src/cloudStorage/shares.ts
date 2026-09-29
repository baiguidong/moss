import { createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { AuthContext } from '../auth/token.js'
import { CloudSharesRepository, type ShareRow } from '../model/repositories/cloudShares.js'
import { CloudStorageRepository } from '../model/repositories/cloudStorage.js'
import { CloudError, CloudStorageService, type FileRow } from './service.js'
import { ShareSecrets } from './shareSecrets.js'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const derive = promisify(scrypt)
const fail = (status: number, code: string, message: string): never => { throw new CloudError(status, code, message) }
const validId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v)

export class CloudSharesService {
  private secrets: ShareSecrets
  private attempts = new Map<string, { count: number; until: number }>()
  private sessions = new Map<string, { tokenHash: string; until: number }>()
  private verifying = 0
  constructor(
    readonly repository: CloudSharesRepository,
    readonly storage: CloudStorageService,
    readonly authorizeOwner: (orgId: string, userId: string) => Promise<void>,
  ) { this.secrets = new ShareSecrets(storage.config.rootDir) }

  private async file(row: ShareRow) {
    return new CloudStorageRepository(this.repository.db).getOwnedFile<FileRow>(row.fileId, row.orgId, row.ownerUserId)
  }
  private state(row: ShareRow, file: FileRow | undefined) {
    if (row.revokedAt !== null) return 'revoked'
    if (!file || file.state !== 'ready' || file.revision !== row.revision) return 'unavailable'
    if (row.expiresAt !== null && row.expiresAt <= Date.now()) return 'expired'
    return 'active'
  }
  private async info(row: ShareRow) {
    const file = await this.file(row), secret = this.secrets.decrypt(row.id, row.secret)
    const path = `/s/${secret.token}`
    const base = this.storage.config.publicUrl
    let url = path
    if (base) {
      const parsed = new URL(base)
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
        fail(503, 'SHARE_URL_UNAVAILABLE', 'Server publicUrl must be HTTP(S) without credentials')
      url = new URL(path, parsed).href
    }
    return { id: row.id, fileId: row.fileId, name: file?.name ?? row.name, size: row.size,
      url, accessCode: secret.accessCode, createdAt: row.createdAt, expiresAt: row.expiresAt,
      revokedAt: row.revokedAt, state: this.state(row, file) }
  }
  async create(auth: AuthContext, input: Record<string, unknown>) {
    await this.storage.check(auth, 'share')
    await this.storage.check(auth, 'read')
    if (!validId(input.fileId) || !validId(input.requestKey) ||
        !(input.expiresAt === null || (Number.isSafeInteger(input.expiresAt) && Number(input.expiresAt) > 0)) ||
        !(input.accessCode === undefined || input.accessCode === null || (typeof input.accessCode === 'string' && /^[a-zA-Z0-9]{4,12}$/.test(input.accessCode))))
      fail(400, 'INVALID_INPUT', 'Invalid share settings')
    const fileId = input.fileId as string, requestKey = input.requestKey as string
    const expiresAt = input.expiresAt as number | null
    const signature = hash(JSON.stringify([fileId, expiresAt, input.accessCode === undefined ? 'auto' : input.accessCode]))
    const existing = await this.repository.byRequest(auth.orgId, auth.userId, requestKey)
    if (existing) {
      if (existing.signature !== signature) fail(409, 'IDEMPOTENCY_CONFLICT', 'Request key has different settings')
      return this.info(existing)
    }
    if (expiresAt !== null && (expiresAt <= Date.now() || expiresAt > Date.now() + 366 * 86400000))
      fail(400, 'INVALID_EXPIRY', 'Expiry must be in the future and within one year')
    await this.storage.ensure()
    const file = await this.storage.file(auth, fileId)
    if (file.kind !== 'file') fail(400, 'NOT_A_FILE', 'Only files can be shared')
    const token = randomBytes(32).toString('base64url'), id = randomUUID()
    const accessCode = input.accessCode === undefined ? String(randomInt(100000, 1000000)) : input.accessCode as string | null
    const tokenHash = hash(token)
    const codeHash = accessCode === null ? null : (await derive(accessCode, tokenHash, 32) as Buffer).toString('hex')
    const row: ShareRow = { id, orgId: auth.orgId, ownerUserId: auth.userId, fileId, revision: file.revision,
      name: file.name, size: file.size, tokenHash, codeHash, secret: this.secrets.encrypt(id, { token, accessCode }),
      signature, requestKey, createdAt: Date.now(), expiresAt, revokedAt: null }
    const saved = await this.repository.db.transaction(async () => {
      const found = await this.repository.byRequest(auth.orgId, auth.userId, requestKey)
      if (found) {
        if (found.signature !== signature) fail(409, 'IDEMPOTENCY_CONFLICT', 'Request key has different settings')
        return found
      }
      await this.storage.check(auth, 'share')
      const current = await this.storage.file(auth, fileId)
      if (current.revision !== row.revision) fail(409, 'REVISION_CHANGED', 'File content changed')
      await this.repository.insert(row)
      return row
    })
    return this.info(saved)
  }
  async list(auth: AuthContext, input: Record<string, unknown>) {
    await this.storage.check(auth, 'share')
    const limit = input.limit ?? 100
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 200 ||
        (input.fileId !== undefined && !validId(input.fileId)) || (input.cursor !== undefined && !validId(input.cursor)))
      fail(400, 'INVALID_INPUT', 'Invalid share pagination')
    const cursor = input.cursor ? await this.repository.owned(auth.orgId, auth.userId, String(input.cursor)) : undefined
    if (input.cursor && !cursor) fail(400, 'INVALID_INPUT', 'Invalid share cursor')
    const rows = await this.repository.list(auth.orgId, auth.userId, Number(limit) + 1, input.fileId as string | undefined, cursor)
    return { shares: await Promise.all(rows.slice(0, Number(limit)).map(row => this.info(row))),
      nextCursor: rows.length > Number(limit) ? rows[Number(limit) - 1]!.id : null }
  }
  async revoke(auth: AuthContext, id: string) {
    await this.storage.check(auth, 'share')
    const row = await this.repository.owned(auth.orgId, auth.userId, id)
    if (!row) return fail(404, 'SHARE_NOT_FOUND', 'Share not found')
    await this.repository.revoke(row.id, Date.now())
    return this.info((await this.repository.owned(auth.orgId, auth.userId, id))!)
  }
  async resolve(token: string) {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) return fail(404, 'SHARE_NOT_FOUND', '分享不存在')
    const row = await this.repository.byToken(hash(token))
    if (!row) return fail(404, 'SHARE_NOT_FOUND', '分享不存在')
    const file = await this.file(row), state = this.state(row, file)
    if (state !== 'active') return fail(410, `SHARE_${state.toUpperCase()}`, { revoked: '分享已取消', expired: '分享已过期', unavailable: '分享文件已失效' }[state])
    try { await this.authorizeOwner(row.orgId, row.ownerUserId) }
    catch { return fail(410, 'SHARE_UNAVAILABLE', '分享文件已失效') }
    await this.storage.ensure()
    return { row, file: file! }
  }
  private attempt(key: string, maximum: number) {
    const now = Date.now()
    for (const [id, item] of this.attempts) if (item.until <= now) this.attempts.delete(id)
    let item = this.attempts.get(key)
    if (!item) {
      if (this.attempts.size >= 10000) fail(429, 'SHARE_RATE_LIMIT', '验证繁忙，请稍后重试')
      item = { count: 0, until: now + 10 * 60000 }; this.attempts.set(key, item)
    }
    if (++item.count > maximum) fail(429, 'SHARE_RATE_LIMIT', '尝试次数过多，请 10 分钟后重试')
  }
  async verify(token: string, code: unknown, remote: string) {
    // Use the actual peer, never untrusted forwarded headers. Per-share limiting
    // remains effective when a reverse proxy multiplexes peer addresses.
    this.attempt(`peer:${remote}`, 100)
    this.attempt(`share:${hash(token)}`, 10)
    const { row } = await this.resolve(token)
    if (row.codeHash) {
      if (typeof code !== 'string' || !/^[a-zA-Z0-9]{4,12}$/.test(code)) fail(403, 'SHARE_CODE_INVALID', '分享码不正确')
      if (this.verifying >= 4) fail(429, 'SHARE_RATE_LIMIT', '验证繁忙，请稍后重试')
      this.verifying++
      try {
        const actual = await derive(code as string, row.tokenHash, 32) as Buffer
        if (!timingSafeEqual(actual, Buffer.from(row.codeHash, 'hex'))) fail(403, 'SHARE_CODE_INVALID', '分享码不正确')
      } finally { this.verifying-- }
    }
    await this.resolve(token)
    const now = Date.now()
    for (const [key, value] of this.sessions) if (value.until <= now) this.sessions.delete(key)
    if (this.sessions.size >= 10000) fail(429, 'SHARE_RATE_LIMIT', '验证繁忙，请稍后重试')
    const session = randomBytes(32).toString('base64url')
    this.sessions.set(hash(session), { tokenHash: row.tokenHash, until: Math.min(now + 30 * 60000, row.expiresAt ?? Infinity) })
    return session
  }
  sessionValid(row: ShareRow, session: string) {
    const value = this.sessions.get(hash(session))
    return Boolean(value && value.until > Date.now() && value.tokenHash === row.tokenHash)
  }
}
