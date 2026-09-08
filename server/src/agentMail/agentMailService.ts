import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AuthContext } from '../auth/token.js'

export type AgentMailAclMode = 'blocked' | 'manual' | 'auto'
export type AgentMailStatus =
  | 'queued'
  | 'leased'
  | 'accepted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'expired'

export type AgentMailRecipient = {
  userId: string
  name: string
  departmentId: string | null
  mode: AgentMailAclMode
}

export type AgentMailMessage = {
  messageId: string
  orgId: string
  fromUserId: string
  fromName: string
  toUserId: string
  toName: string
  subject: string
  content: string
  threadId: string
  replyTo: string | null
  hopCount: number
  status: AgentMailStatus
  deliveryMode: AgentMailAclMode
  attempts: number
  error: string | null
  createdAt: number
  expiresAt: number
  acceptedAt: number | null
  completedAt: number | null
}

type SqlRow = Record<string, unknown>

const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CONSUMER_LEASE_MS = 45_000
const DELIVERY_LEASE_MS = 60_000
const EXECUTION_LEASE_MS = 10 * 60_000
const MAX_ATTEMPTS = 5
const MAX_CONTENT_BYTES = 64 * 1024
const MAX_SUBJECT_CHARS = 200
const MAX_CLIENT_MESSAGE_ID_CHARS = 128
const MAX_HOPS = 8
const MAX_BACKLOG = 1_000
const MAX_SENDS_PER_HOUR = 60
const MAX_SENDS_PER_DAY = 500
const MAX_PULL_WAIT_MS = 25_000
const MAX_PULL_LIMIT = 10

function now(): number {
  return Date.now()
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function mapMessage(row: SqlRow): AgentMailMessage {
  return {
    messageId: String(row.id),
    orgId: String(row.org_id),
    fromUserId: String(row.from_user_id),
    fromName: String(row.from_name || ''),
    toUserId: String(row.to_user_id),
    toName: String(row.to_name || ''),
    subject: String(row.subject || ''),
    content: String(row.content || ''),
    threadId: String(row.thread_id),
    replyTo: row.reply_to == null ? null : String(row.reply_to),
    hopCount: Number(row.hop_count || 0),
    status: String(row.status) as AgentMailStatus,
    deliveryMode: String(row.delivery_mode || 'manual') as AgentMailAclMode,
    attempts: Number(row.attempts || 0),
    error: row.error == null ? null : String(row.error),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    acceptedAt: row.accepted_at == null ? null : Number(row.accepted_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
  }
}

export class AgentMailError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AgentMailError'
  }
}

export class AgentMailService {
  private readonly waiters = new Map<string, Set<() => void>>()
  private disposed = false

  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_mail_messages (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        from_user_id TEXT NOT NULL REFERENCES users(id),
        to_user_id TEXT NOT NULL REFERENCES users(id),
        client_message_id TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        reply_to TEXT REFERENCES agent_mail_messages(id),
        hop_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('queued','leased','accepted','running','completed','failed','expired')),
        consumer_id TEXT,
        lease_token_hash TEXT,
        lease_until INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        accepted_at INTEGER,
        completed_at INTEGER,
        UNIQUE(from_user_id, client_message_id)
      );
      CREATE INDEX IF NOT EXISTS agent_mail_messages_recipient_idx
        ON agent_mail_messages (org_id, to_user_id, status, created_at);
      CREATE INDEX IF NOT EXISTS agent_mail_messages_sender_idx
        ON agent_mail_messages (org_id, from_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS agent_mail_messages_thread_idx
        ON agent_mail_messages (org_id, thread_id, created_at);

      CREATE TABLE IF NOT EXISTS agent_mail_consumers (
        org_id TEXT NOT NULL REFERENCES organizations(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        consumer_id TEXT NOT NULL,
        lease_until INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (org_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS agent_mail_acl (
        org_id TEXT NOT NULL REFERENCES organizations(id),
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        sender_user_id TEXT NOT NULL REFERENCES users(id),
        mode TEXT NOT NULL CHECK (mode IN ('blocked','manual','auto')),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (org_id, owner_user_id, sender_user_id)
      );
    `)
  }

  dispose(): void {
    this.disposed = true
    for (const entries of this.waiters.values()) {
      for (const wake of entries) wake()
    }
    this.waiters.clear()
  }

  searchRecipients(auth: AuthContext, query: string, limit = 20): AgentMailRecipient[] {
    this.requireActiveCaller(auth)
    const normalized = text(query).toLowerCase()
    const boundedLimit = Math.min(50, Math.max(1, Math.floor(limit) || 20))
    const pattern = `%${normalized.replace(/[\\%_]/g, value => `\\${value}`)}%`
    const rows = this.db.prepare(`
      SELECT u.id, u.name, u.department_id,
             COALESCE(a.mode, CASE WHEN u.id = ? THEN 'auto' ELSE 'manual' END) AS mode
      FROM users u
      LEFT JOIN agent_mail_acl a
        ON a.org_id = u.org_id AND a.owner_user_id = ? AND a.sender_user_id = u.id
      WHERE u.org_id = ? AND u.status = 'active'
        AND (? = '' OR lower(u.name) LIKE ? ESCAPE '\\' OR lower(u.email) LIKE ? ESCAPE '\\' OR lower(u.id) = ?)
      ORDER BY CASE WHEN lower(u.id) = ? THEN 0 WHEN lower(u.name) = ? THEN 1 ELSE 2 END,
               lower(u.name), u.created_at
      LIMIT ?
    `).all(
      auth.userId,
      auth.userId,
      auth.orgId,
      normalized,
      pattern,
      pattern,
      normalized,
      normalized,
      normalized,
      boundedLimit,
    ) as SqlRow[]
    return rows.map(row => ({
      userId: String(row.id),
      name: String(row.name),
      departmentId: row.department_id == null ? null : String(row.department_id),
      mode: String(row.mode) as AgentMailAclMode,
    }))
  }

  listAcl(auth: AuthContext): AgentMailRecipient[] {
    return this.searchRecipients(auth, '', 50)
  }

  setAcl(auth: AuthContext, senderUserId: string, mode: AgentMailAclMode): AgentMailRecipient {
    this.requireActiveCaller(auth)
    const sender = this.requireActiveUser(auth.orgId, senderUserId)
    if (!['blocked', 'manual', 'auto'].includes(mode)) {
      throw new AgentMailError(400, 'AGENT_MAIL_INVALID_ACL', 'ACL mode must be blocked, manual, or auto')
    }
    if (sender.id === auth.userId && mode !== 'auto') {
      throw new AgentMailError(400, 'AGENT_MAIL_INVALID_ACL', 'Messages from the current user are always trusted')
    }
    this.db.prepare(`
      INSERT INTO agent_mail_acl (org_id, owner_user_id, sender_user_id, mode, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (org_id, owner_user_id, sender_user_id) DO UPDATE SET
        mode = excluded.mode, updated_at = excluded.updated_at
    `).run(auth.orgId, auth.userId, sender.id, mode, now())
    if (mode === 'blocked') {
      this.db.prepare(`
        UPDATE agent_mail_messages
        SET status = 'failed', error = 'Recipient blocked this sender', completed_at = ?
        WHERE org_id = ? AND to_user_id = ? AND from_user_id = ? AND status = 'queued'
      `).run(now(), auth.orgId, auth.userId, sender.id)
    }
    return {
      userId: sender.id,
      name: sender.name,
      departmentId: sender.departmentId,
      mode,
    }
  }

  send(auth: AuthContext, input: {
    toUserId?: unknown
    subject?: unknown
    content?: unknown
    clientMessageId?: unknown
    replyTo?: unknown
  }): { duplicate: boolean; message: AgentMailMessage } {
    this.requireActiveCaller(auth)
    const content = typeof input.content === 'string' ? input.content.trim() : ''
    const subject = typeof input.subject === 'string' ? input.subject.trim() : ''
    const clientMessageId = text(input.clientMessageId)
    const replyTo = text(input.replyTo)
    if (!content) throw new AgentMailError(400, 'AGENT_MAIL_INVALID_MESSAGE', 'Message content is required')
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
      throw new AgentMailError(413, 'AGENT_MAIL_CONTENT_TOO_LARGE', `Message content exceeds ${MAX_CONTENT_BYTES} bytes`)
    }
    if (subject.length > MAX_SUBJECT_CHARS) {
      throw new AgentMailError(400, 'AGENT_MAIL_SUBJECT_TOO_LONG', `Message subject exceeds ${MAX_SUBJECT_CHARS} characters`)
    }
    if (!clientMessageId || clientMessageId.length > MAX_CLIENT_MESSAGE_ID_CHARS) {
      throw new AgentMailError(400, 'AGENT_MAIL_INVALID_IDEMPOTENCY_KEY', 'clientMessageId is required and must not exceed 128 characters')
    }

    const duplicate = this.findByClientMessageId(auth.userId, clientMessageId)
    if (duplicate) return { duplicate: true, message: duplicate }

    let toUserId = text(input.toUserId)
    let threadId: string = randomUUID()
    let hopCount = 0
    let resolvedSubject = subject
    let resolvedReplyTo: string | null = null
    if (replyTo) {
      const parent = this.getRawMessage(auth.orgId, replyTo)
      if (!parent || (String(parent.from_user_id) !== auth.userId && String(parent.to_user_id) !== auth.userId)) {
        throw new AgentMailError(404, 'AGENT_MAIL_REPLY_NOT_FOUND', 'Reply target was not found')
      }
      const counterpart = String(parent.from_user_id) === auth.userId
        ? String(parent.to_user_id)
        : String(parent.from_user_id)
      if (toUserId && toUserId !== counterpart) {
        throw new AgentMailError(400, 'AGENT_MAIL_REPLY_RECIPIENT_MISMATCH', 'Reply recipient does not match the original thread')
      }
      toUserId = counterpart
      threadId = String(parent.thread_id)
      const threadState = this.db.prepare(`
        SELECT MAX(hop_count) AS max_hop FROM agent_mail_messages WHERE org_id = ? AND thread_id = ?
      `).get(auth.orgId, threadId) as SqlRow
      hopCount = Number(threadState.max_hop || 0) + 1
      resolvedReplyTo = String(parent.id)
      if (!resolvedSubject) {
        const parentSubject = String(parent.subject || '')
        resolvedSubject = parentSubject && !/^re:/i.test(parentSubject) ? `Re: ${parentSubject}` : parentSubject
      }
    }
    if (resolvedSubject.length > MAX_SUBJECT_CHARS) {
      throw new AgentMailError(400, 'AGENT_MAIL_SUBJECT_TOO_LONG', `Message subject exceeds ${MAX_SUBJECT_CHARS} characters`)
    }
    if (hopCount > MAX_HOPS) {
      throw new AgentMailError(409, 'AGENT_MAIL_HOP_LIMIT', `Agent Mail thread exceeded ${MAX_HOPS} hops`)
    }
    const recipient = this.requireActiveUser(auth.orgId, toUserId)
    if (this.getAclMode(auth.orgId, recipient.id, auth.userId) === 'blocked') {
      throw new AgentMailError(403, 'AGENT_MAIL_SENDER_BLOCKED', 'Recipient does not accept Agent Mail from this user')
    }
    this.enforceQuota(auth)
    this.enforceBacklog(auth.orgId, recipient.id)

    const createdAt = now()
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO agent_mail_messages (
        id, org_id, from_user_id, to_user_id, client_message_id, subject, content,
        thread_id, reply_to, hop_count, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
    `).run(
      id,
      auth.orgId,
      auth.userId,
      recipient.id,
      clientMessageId,
      resolvedSubject,
      content,
      threadId,
      resolvedReplyTo,
      hopCount,
      createdAt,
      createdAt + MESSAGE_TTL_MS,
    )
    this.notify(auth.orgId, recipient.id)
    return {
      duplicate: false,
      message: this.requireMessage(id),
    }
  }

  async pull(auth: AuthContext, input: {
    consumerId?: unknown
    waitMs?: unknown
    limit?: unknown
  }, signal?: AbortSignal): Promise<{
    consumerId: string
    consumerLeaseUntil: number
    leaseToken: string | null
    leaseUntil: number | null
    messages: AgentMailMessage[]
  }> {
    this.requireActiveCaller(auth)
    const consumerId = text(input.consumerId)
    if (!consumerId || consumerId.length > 128) {
      throw new AgentMailError(400, 'AGENT_MAIL_INVALID_CONSUMER', 'consumerId is required and must not exceed 128 characters')
    }
    const waitMs = Math.min(MAX_PULL_WAIT_MS, Math.max(0, Math.floor(Number(input.waitMs) || 0)))
    const limit = Math.min(MAX_PULL_LIMIT, Math.max(1, Math.floor(Number(input.limit) || 1)))
    const deadline = now() + waitMs
    while (!this.disposed) {
      if (signal?.aborted) throw new AgentMailError(499, 'AGENT_MAIL_PULL_ABORTED', 'Mailbox pull was aborted')
      const consumerLeaseUntil = this.acquireConsumer(auth, consumerId)
      const leased = this.leaseMessages(auth, consumerId, limit)
      if (leased.messages.length > 0 || now() >= deadline) {
        return { consumerId, consumerLeaseUntil, ...leased }
      }
      await this.waitForNotification(auth.orgId, auth.userId, Math.min(1_000, deadline - now()), signal)
    }
    throw new AgentMailError(503, 'AGENT_MAIL_STOPPED', 'Agent Mail service is stopping')
  }

  accept(auth: AuthContext, messageId: string, consumerId: string, leaseToken: string): AgentMailMessage {
    this.requireActiveCaller(auth)
    const row = this.requireLeasedMessage(auth, messageId, consumerId, leaseToken, ['leased'])
    const acceptedAt = now()
    const leaseUntil = String(row.delivery_mode) === 'manual'
      ? Number(row.expires_at)
      : acceptedAt + EXECUTION_LEASE_MS
    this.db.prepare(`
      UPDATE agent_mail_messages
      SET status = 'accepted', accepted_at = ?, lease_until = ?
      WHERE id = ?
    `).run(acceptedAt, leaseUntil, messageId)
    return this.requireMessage(messageId)
  }

  heartbeat(auth: AuthContext, messageId: string, consumerId: string, leaseToken: string): AgentMailMessage {
    this.requireActiveCaller(auth)
    const row = this.requireLeasedMessage(auth, messageId, consumerId, leaseToken, ['accepted', 'running'])
    this.db.prepare(`
      UPDATE agent_mail_messages SET status = 'running', lease_until = ? WHERE id = ?
    `).run(now() + EXECUTION_LEASE_MS, messageId)
    return this.requireMessage(messageId)
  }

  finish(auth: AuthContext, messageId: string, consumerId: string, leaseToken: string, input: {
    status: 'completed' | 'failed'
    error?: unknown
  }): AgentMailMessage {
    this.requireActiveCaller(auth)
    const row = this.requireLeasedMessage(auth, messageId, consumerId, leaseToken, ['accepted', 'running'])
    const error = input.status === 'failed' ? text(input.error).slice(0, 2_000) || 'Agent Mail execution failed' : null
    this.db.prepare(`
      UPDATE agent_mail_messages
      SET status = ?, error = ?, completed_at = ?, lease_until = NULL
      WHERE id = ?
    `).run(input.status, error, now(), messageId)
    return this.requireMessage(messageId)
  }

  list(auth: AuthContext, direction: 'inbox' | 'outbox', limit = 50): AgentMailMessage[] {
    this.requireActiveCaller(auth)
    const boundedLimit = Math.min(100, Math.max(1, Math.floor(limit) || 50))
    const column = direction === 'inbox' ? 'm.to_user_id' : 'm.from_user_id'
    const rows = this.db.prepare(`
      ${this.messageSelect()}
      WHERE m.org_id = ? AND ${column} = ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(auth.orgId, auth.userId, boundedLimit) as SqlRow[]
    return rows.map(mapMessage)
  }

  private acquireConsumer(auth: AuthContext, consumerId: string): number {
    const currentTime = now()
    const leaseUntil = currentTime + CONSUMER_LEASE_MS
    this.db.prepare(`
      INSERT INTO agent_mail_consumers (org_id, user_id, consumer_id, lease_until, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (org_id, user_id) DO UPDATE SET
        consumer_id = excluded.consumer_id,
        lease_until = excluded.lease_until,
        updated_at = excluded.updated_at
      WHERE agent_mail_consumers.consumer_id = excluded.consumer_id
         OR agent_mail_consumers.lease_until <= excluded.updated_at
    `).run(auth.orgId, auth.userId, consumerId, leaseUntil, currentTime)
    const row = this.db.prepare(`
      SELECT consumer_id, lease_until FROM agent_mail_consumers WHERE org_id = ? AND user_id = ?
    `).get(auth.orgId, auth.userId) as SqlRow | undefined
    if (!row || String(row.consumer_id) !== consumerId) {
      throw new AgentMailError(409, 'AGENT_MAIL_CONSUMER_ACTIVE', 'Another Moss client currently owns this mailbox')
    }
    return Number(row.lease_until)
  }

  private leaseMessages(auth: AuthContext, consumerId: string, limit: number): {
    leaseToken: string | null
    leaseUntil: number | null
    messages: AgentMailMessage[]
  } {
    const currentTime = now()
    const leaseToken = randomUUID()
    const leaseUntil = currentTime + DELIVERY_LEASE_MS
    const tokenHash = hashToken(leaseToken)
    const update = this.db.prepare(`
      UPDATE agent_mail_messages
      SET status = 'leased', consumer_id = ?, lease_token_hash = ?, lease_until = ?, attempts = attempts + 1
      WHERE id = ? AND status = 'queued'
    `)
    let rows: SqlRow[] = []
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.requeueExpired(currentTime, auth.orgId, auth.userId)
      rows = this.db.prepare(`
        ${this.messageSelect()}
        WHERE m.org_id = ? AND m.to_user_id = ? AND m.status = 'queued'
          AND COALESCE(acl.mode, CASE WHEN m.from_user_id = m.to_user_id THEN 'auto' ELSE 'manual' END) <> 'blocked'
        ORDER BY m.created_at ASC
        LIMIT ?
      `).all(auth.orgId, auth.userId, limit) as SqlRow[]
      for (const row of rows) update.run(consumerId, tokenHash, leaseUntil, String(row.id))
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    if (rows.length === 0) return { leaseToken: null, leaseUntil: null, messages: [] }
    return {
      leaseToken,
      leaseUntil,
      messages: rows.map(row => mapMessage({
        ...row,
        status: 'leased',
        attempts: Number(row.attempts || 0) + 1,
      })),
    }
  }

  private requeueExpired(currentTime: number, orgId: string, userId: string): void {
    this.db.prepare(`
      UPDATE agent_mail_messages
      SET status = 'expired', error = COALESCE(error, 'Message expired before completion'), completed_at = ?, lease_until = NULL
      WHERE org_id = ? AND to_user_id = ? AND status IN ('queued','leased','accepted','running') AND expires_at <= ?
    `).run(currentTime, orgId, userId, currentTime)
    this.db.prepare(`
      UPDATE agent_mail_messages
      SET status = 'failed', error = COALESCE(error, 'Maximum delivery attempts exceeded'), completed_at = ?, lease_until = NULL
      WHERE org_id = ? AND to_user_id = ? AND status IN ('leased','accepted','running')
        AND lease_until <= ? AND attempts >= ?
    `).run(currentTime, orgId, userId, currentTime, MAX_ATTEMPTS)
    this.db.prepare(`
      UPDATE agent_mail_messages
      SET status = 'queued', consumer_id = NULL, lease_token_hash = NULL, lease_until = NULL
      WHERE org_id = ? AND to_user_id = ? AND status IN ('leased','accepted','running')
        AND lease_until <= ? AND attempts < ? AND expires_at > ?
    `).run(orgId, userId, currentTime, MAX_ATTEMPTS, currentTime)
  }

  private requireLeasedMessage(
    auth: AuthContext,
    messageId: string,
    consumerId: string,
    leaseToken: string,
    statuses: AgentMailStatus[],
  ): SqlRow {
    const row = this.db.prepare(`
      ${this.messageSelect()}
      WHERE m.id = ? AND m.org_id = ? AND m.to_user_id = ?
    `).get(messageId, auth.orgId, auth.userId) as SqlRow | undefined
    if (!row) throw new AgentMailError(404, 'AGENT_MAIL_NOT_FOUND', 'Agent Mail message was not found')
    if (!statuses.includes(String(row.status) as AgentMailStatus)) {
      throw new AgentMailError(409, 'AGENT_MAIL_INVALID_STATE', `Message cannot be updated from state ${String(row.status)}`)
    }
    if (String(row.consumer_id || '') !== consumerId || String(row.lease_token_hash || '') !== hashToken(leaseToken)) {
      throw new AgentMailError(409, 'AGENT_MAIL_LEASE_MISMATCH', 'Agent Mail lease is no longer valid')
    }
    if (Number(row.lease_until || 0) <= now()) {
      throw new AgentMailError(409, 'AGENT_MAIL_LEASE_EXPIRED', 'Agent Mail lease has expired')
    }
    return row
  }

  private enforceQuota(auth: AuthContext): void {
    const currentTime = now()
    const hourCount = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM agent_mail_messages WHERE org_id = ? AND from_user_id = ? AND created_at >= ?
    `).get(auth.orgId, auth.userId, currentTime - 60 * 60_000) as SqlRow).count)
    const dayCount = Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM agent_mail_messages WHERE org_id = ? AND from_user_id = ? AND created_at >= ?
    `).get(auth.orgId, auth.userId, currentTime - 24 * 60 * 60_000) as SqlRow).count)
    if (hourCount >= MAX_SENDS_PER_HOUR || dayCount >= MAX_SENDS_PER_DAY) {
      throw new AgentMailError(429, 'AGENT_MAIL_RATE_LIMITED', 'Agent Mail sending quota exceeded')
    }
  }

  private enforceBacklog(orgId: string, userId: string): void {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM agent_mail_messages
      WHERE org_id = ? AND to_user_id = ? AND status IN ('queued','leased','accepted','running')
    `).get(orgId, userId) as SqlRow
    if (Number(row.count) >= MAX_BACKLOG) {
      throw new AgentMailError(429, 'AGENT_MAIL_BACKLOG_FULL', 'Recipient Agent Mail backlog is full')
    }
  }

  private getAclMode(orgId: string, ownerUserId: string, senderUserId: string): AgentMailAclMode {
    if (ownerUserId === senderUserId) return 'auto'
    const row = this.db.prepare(`
      SELECT mode FROM agent_mail_acl WHERE org_id = ? AND owner_user_id = ? AND sender_user_id = ?
    `).get(orgId, ownerUserId, senderUserId) as SqlRow | undefined
    return row ? String(row.mode) as AgentMailAclMode : 'manual'
  }

  private requireActiveUser(orgId: string, userId: string): { id: string; name: string; departmentId: string | null } {
    if (!userId) throw new AgentMailError(400, 'AGENT_MAIL_RECIPIENT_REQUIRED', 'Recipient user ID is required')
    const row = this.db.prepare(`
      SELECT id, name, department_id FROM users WHERE id = ? AND org_id = ? AND status = 'active'
    `).get(userId, orgId) as SqlRow | undefined
    if (!row) throw new AgentMailError(404, 'AGENT_MAIL_RECIPIENT_NOT_FOUND', 'Recipient is not an active user in this organization')
    return {
      id: String(row.id),
      name: String(row.name),
      departmentId: row.department_id == null ? null : String(row.department_id),
    }
  }

  private requireActiveCaller(auth: AuthContext): void {
    const row = this.db.prepare(`
      SELECT status FROM users WHERE id = ? AND org_id = ?
    `).get(auth.userId, auth.orgId) as SqlRow | undefined
    if (!row || String(row.status) !== 'active') {
      throw new AgentMailError(403, 'AGENT_MAIL_ACCOUNT_DISABLED', 'The authenticated Moss Server user is not active')
    }
  }

  private findByClientMessageId(userId: string, clientMessageId: string): AgentMailMessage | null {
    const row = this.db.prepare(`
      ${this.messageSelect()}
      WHERE m.from_user_id = ? AND m.client_message_id = ?
    `).get(userId, clientMessageId) as SqlRow | undefined
    return row ? mapMessage(row) : null
  }

  private getRawMessage(orgId: string, messageId: string): SqlRow | null {
    return (this.db.prepare(`SELECT * FROM agent_mail_messages WHERE id = ? AND org_id = ?`).get(messageId, orgId) as SqlRow | undefined) ?? null
  }

  private requireMessage(messageId: string): AgentMailMessage {
    const row = this.db.prepare(`
      ${this.messageSelect()}
      WHERE m.id = ?
    `).get(messageId) as SqlRow | undefined
    if (!row) throw new AgentMailError(404, 'AGENT_MAIL_NOT_FOUND', 'Agent Mail message was not found')
    return mapMessage(row)
  }

  private messageSelect(): string {
    return `
      SELECT m.*, sender.name AS from_name, recipient.name AS to_name,
             COALESCE(acl.mode, CASE WHEN m.from_user_id = m.to_user_id THEN 'auto' ELSE 'manual' END) AS delivery_mode
      FROM agent_mail_messages m
      JOIN users sender ON sender.id = m.from_user_id
      JOIN users recipient ON recipient.id = m.to_user_id
      LEFT JOIN agent_mail_acl acl
        ON acl.org_id = m.org_id AND acl.owner_user_id = m.to_user_id AND acl.sender_user_id = m.from_user_id
    `
  }

  private notify(orgId: string, userId: string): void {
    for (const wake of this.waiters.get(`${orgId}:${userId}`) ?? []) wake()
  }

  private waitForNotification(orgId: string, userId: string, waitMs: number, signal?: AbortSignal): Promise<void> {
    if (waitMs <= 0 || signal?.aborted) return Promise.resolve()
    const key = `${orgId}:${userId}`
    return new Promise(resolve => {
      let done = false
      const entries = this.waiters.get(key) ?? new Set<() => void>()
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', finish)
        entries.delete(finish)
        if (entries.size === 0) this.waiters.delete(key)
        resolve()
      }
      const timer = setTimeout(finish, waitMs)
      timer.unref?.()
      entries.add(finish)
      this.waiters.set(key, entries)
      signal?.addEventListener('abort', finish, { once: true })
    })
  }
}
