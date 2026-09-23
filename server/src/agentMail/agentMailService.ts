import { createHash, randomUUID } from 'node:crypto'
import type { AuthContext } from '../auth/token.js'
import { AgentMailRepository } from '../model/repositories/agentMail.js'

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

  constructor(private readonly repository: AgentMailRepository) {}

  dispose(): void {
    this.disposed = true
    for (const entries of this.waiters.values()) {
      for (const wake of entries) wake()
    }
    this.waiters.clear()
  }

  async searchRecipients(
    auth: AuthContext,
    query: string,
    limit = 20,
  ): Promise<AgentMailRecipient[]> {
    await this.requireActiveCaller(auth)
    const normalized = text(query).toLowerCase()
    const boundedLimit = Math.min(50, Math.max(1, Math.floor(limit) || 20))
    const pattern = `%${normalized.replace(/[\\%_]/g, value => `\\${value}`)}%`
    const rows = (await this.repository.searchRecipients(
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
    )) as SqlRow[]
    return rows.map(row => ({
      userId: String(row.id),
      name: String(row.name),
      departmentId:
        row.department_id == null ? null : String(row.department_id),
      mode: String(row.mode) as AgentMailAclMode,
    }))
  }

  async listAcl(auth: AuthContext): Promise<AgentMailRecipient[]> {
    return await this.searchRecipients(auth, '', 50)
  }

  async setAcl(
    auth: AuthContext,
    senderUserId: string,
    mode: AgentMailAclMode,
  ): Promise<AgentMailRecipient> {
    return await this.repository.transaction(async () => {
      await this.requireActiveCaller(auth)
      const sender = await this.requireActiveUser(auth.orgId, senderUserId)
      if (!['blocked', 'manual', 'auto'].includes(mode)) {
        throw new AgentMailError(
          400,
          'AGENT_MAIL_INVALID_ACL',
          'ACL mode must be blocked, manual, or auto',
        )
      }
      if (sender.id === auth.userId && mode !== 'auto') {
        throw new AgentMailError(
          400,
          'AGENT_MAIL_INVALID_ACL',
          'Messages from the current user are always trusted',
        )
      }
      await this.repository.upsertAcl(
        auth.orgId,
        auth.userId,
        sender.id,
        mode,
        now(),
      )
      if (mode === 'blocked') {
        await this.repository.failBlockedMessages(
          now(),
          auth.orgId,
          auth.userId,
          sender.id,
        )
      }
      return {
        userId: sender.id,
        name: sender.name,
        departmentId: sender.departmentId,
        mode,
      }
    })
  }

  async send(
    auth: AuthContext,
    input: {
      toUserId?: unknown
      subject?: unknown
      content?: unknown
      clientMessageId?: unknown
      replyTo?: unknown
    },
  ): Promise<{ duplicate: boolean; message: AgentMailMessage }> {
    return await this.repository.transaction(async () => {
      await this.requireActiveCaller(auth)
      const content =
        typeof input.content === 'string' ? input.content.trim() : ''
      const subject =
        typeof input.subject === 'string' ? input.subject.trim() : ''
      const clientMessageId = text(input.clientMessageId)
      const replyTo = text(input.replyTo)
      if (!content)
        throw new AgentMailError(
          400,
          'AGENT_MAIL_INVALID_MESSAGE',
          'Message content is required',
        )
      if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
        throw new AgentMailError(
          413,
          'AGENT_MAIL_CONTENT_TOO_LARGE',
          `Message content exceeds ${MAX_CONTENT_BYTES} bytes`,
        )
      }
      if (subject.length > MAX_SUBJECT_CHARS) {
        throw new AgentMailError(
          400,
          'AGENT_MAIL_SUBJECT_TOO_LONG',
          `Message subject exceeds ${MAX_SUBJECT_CHARS} characters`,
        )
      }
      if (
        !clientMessageId ||
        clientMessageId.length > MAX_CLIENT_MESSAGE_ID_CHARS
      ) {
        throw new AgentMailError(
          400,
          'AGENT_MAIL_INVALID_IDEMPOTENCY_KEY',
          'clientMessageId is required and must not exceed 128 characters',
        )
      }

      const duplicate = await this.findByClientMessageId(
        auth.userId,
        clientMessageId,
      )
      if (duplicate) return { duplicate: true, message: duplicate }

      let toUserId = text(input.toUserId)
      let threadId: string = randomUUID()
      let hopCount = 0
      let resolvedSubject = subject
      let resolvedReplyTo: string | null = null
      if (replyTo) {
        const parent = await this.getRawMessage(auth.orgId, replyTo)
        if (
          !parent ||
          (String(parent.from_user_id) !== auth.userId &&
            String(parent.to_user_id) !== auth.userId)
        ) {
          throw new AgentMailError(
            404,
            'AGENT_MAIL_REPLY_NOT_FOUND',
            'Reply target was not found',
          )
        }
        const counterpart =
          String(parent.from_user_id) === auth.userId
            ? String(parent.to_user_id)
            : String(parent.from_user_id)
        if (toUserId && toUserId !== counterpart) {
          throw new AgentMailError(
            400,
            'AGENT_MAIL_REPLY_RECIPIENT_MISMATCH',
            'Reply recipient does not match the original thread',
          )
        }
        toUserId = counterpart
        threadId = String(parent.thread_id)
        const threadState = (await this.repository.getThreadHopCount(
          auth.orgId,
          threadId,
        )) as SqlRow
        hopCount = Number(threadState.max_hop || 0) + 1
        resolvedReplyTo = String(parent.id)
        if (!resolvedSubject) {
          const parentSubject = String(parent.subject || '')
          resolvedSubject =
            parentSubject && !/^re:/i.test(parentSubject)
              ? `Re: ${parentSubject}`
              : parentSubject
        }
      }
      if (resolvedSubject.length > MAX_SUBJECT_CHARS) {
        throw new AgentMailError(
          400,
          'AGENT_MAIL_SUBJECT_TOO_LONG',
          `Message subject exceeds ${MAX_SUBJECT_CHARS} characters`,
        )
      }
      if (hopCount > MAX_HOPS) {
        throw new AgentMailError(
          409,
          'AGENT_MAIL_HOP_LIMIT',
          `Agent Mail thread exceeded ${MAX_HOPS} hops`,
        )
      }
      const recipient = await this.requireActiveUser(auth.orgId, toUserId)
      if (
        (await this.getAclMode(auth.orgId, recipient.id, auth.userId)) ===
        'blocked'
      ) {
        throw new AgentMailError(
          403,
          'AGENT_MAIL_SENDER_BLOCKED',
          'Recipient does not accept Agent Mail from this user',
        )
      }
      await this.enforceQuota(auth)
      await this.enforceBacklog(auth.orgId, recipient.id)

      const createdAt = now()
      const id = randomUUID()
      await this.repository.insertMessage(
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
        message: await this.requireMessage(id),
      }
    })
  }

  async pull(
    auth: AuthContext,
    input: {
      consumerId?: unknown
      waitMs?: unknown
      limit?: unknown
    },
    signal?: AbortSignal,
  ): Promise<{
    consumerId: string
    consumerLeaseUntil: number
    leaseToken: string | null
    leaseUntil: number | null
    messages: AgentMailMessage[]
  }> {
    await this.requireActiveCaller(auth)
    const consumerId = text(input.consumerId)
    if (!consumerId || consumerId.length > 128) {
      throw new AgentMailError(
        400,
        'AGENT_MAIL_INVALID_CONSUMER',
        'consumerId is required and must not exceed 128 characters',
      )
    }
    const waitMs = Math.min(
      MAX_PULL_WAIT_MS,
      Math.max(0, Math.floor(Number(input.waitMs) || 0)),
    )
    const limit = Math.min(
      MAX_PULL_LIMIT,
      Math.max(1, Math.floor(Number(input.limit) || 1)),
    )
    const deadline = now() + waitMs
    while (!this.disposed) {
      if (signal?.aborted)
        throw new AgentMailError(
          499,
          'AGENT_MAIL_PULL_ABORTED',
          'Mailbox pull was aborted',
        )
      const consumerLeaseUntil = await this.acquireConsumer(auth, consumerId)
      const leased = await this.leaseMessages(auth, consumerId, limit)
      if (leased.messages.length > 0 || now() >= deadline) {
        return { consumerId, consumerLeaseUntil, ...leased }
      }
      await this.waitForNotification(
        auth.orgId,
        auth.userId,
        Math.min(1_000, deadline - now()),
        signal,
      )
    }
    throw new AgentMailError(
      503,
      'AGENT_MAIL_STOPPED',
      'Agent Mail service is stopping',
    )
  }

  async accept(
    auth: AuthContext,
    messageId: string,
    consumerId: string,
    leaseToken: string,
  ): Promise<AgentMailMessage> {
    return await this.repository.transaction(async () => {
      await this.requireActiveCaller(auth)
      const row = await this.requireLeasedMessage(
        auth,
        messageId,
        consumerId,
        leaseToken,
        ['leased'],
      )
      const acceptedAt = now()
      const leaseUntil =
        String(row.delivery_mode) === 'manual'
          ? Number(row.expires_at)
          : acceptedAt + EXECUTION_LEASE_MS
      await this.repository.markAccepted(acceptedAt, leaseUntil, messageId)
      return await this.requireMessage(messageId)
    })
  }

  async heartbeat(
    auth: AuthContext,
    messageId: string,
    consumerId: string,
    leaseToken: string,
  ): Promise<AgentMailMessage> {
    return await this.repository.transaction(async () => {
      await this.requireActiveCaller(auth)
      const row = await this.requireLeasedMessage(
        auth,
        messageId,
        consumerId,
        leaseToken,
        ['accepted', 'running'],
      )
      await this.repository.renewMessageLease(
        now() + EXECUTION_LEASE_MS,
        messageId,
      )
      return await this.requireMessage(messageId)
    })
  }

  async finish(
    auth: AuthContext,
    messageId: string,
    consumerId: string,
    leaseToken: string,
    input: {
      status: 'completed' | 'failed'
      error?: unknown
    },
  ): Promise<AgentMailMessage> {
    return await this.repository.transaction(async () => {
      await this.requireActiveCaller(auth)
      const row = await this.requireLeasedMessage(
        auth,
        messageId,
        consumerId,
        leaseToken,
        ['accepted', 'running'],
      )
      const error =
        input.status === 'failed'
          ? text(input.error).slice(0, 2_000) || 'Agent Mail execution failed'
          : null
      await this.repository.completeMessage(
        input.status,
        error,
        now(),
        messageId,
      )
      return await this.requireMessage(messageId)
    })
  }

  async list(
    auth: AuthContext,
    direction: 'inbox' | 'outbox',
    limit = 50,
  ): Promise<AgentMailMessage[]> {
    await this.requireActiveCaller(auth)
    const boundedLimit = Math.min(100, Math.max(1, Math.floor(limit) || 50))
    const column = direction === 'inbox' ? 'm.to_user_id' : 'm.from_user_id'
    const rows = (await this.repository.listMessages(
      column,
      auth.orgId,
      auth.userId,
      auth.userId,
      boundedLimit,
    )) as SqlRow[]
    return rows.map(mapMessage)
  }

  async deleteForUser(
    auth: AuthContext,
    messageId: string,
  ): Promise<{ messageId: string; deleted: boolean }> {
    return await this.repository.transaction(async () => {
      await this.requireActiveCaller(auth)
      const normalizedMessageId = text(messageId)
      const row = (await this.repository.findVisibleMessage(
        normalizedMessageId,
        auth.orgId,
        auth.userId,
        auth.userId,
      )) as SqlRow | undefined
      if (!row)
        throw new AgentMailError(
          404,
          'AGENT_MAIL_NOT_FOUND',
          'Agent Mail message was not found',
        )
      const result = await this.repository.insertDeletion(
        normalizedMessageId,
        auth.userId,
        now(),
      )
      return {
        messageId: normalizedMessageId,
        deleted: Number(result.changes) > 0,
      }
    })
  }

  private async acquireConsumer(
    auth: AuthContext,
    consumerId: string,
  ): Promise<number> {
    return await this.repository.transaction(async () => {
      const currentTime = now()
      const existing = await this.repository.getConsumer(
        auth.orgId,
        auth.userId,
      )
      if (
        existing &&
        existing.consumer_id !== consumerId &&
        Number(existing.lease_until) > currentTime
      ) {
        throw new AgentMailError(
          409,
          'AGENT_MAIL_CONSUMER_ACTIVE',
          'Another consumer holds the mailbox lease',
        )
      }
      const leaseUntil = currentTime + CONSUMER_LEASE_MS
      await this.repository.upsertConsumer(
        auth.orgId,
        auth.userId,
        consumerId,
        leaseUntil,
        currentTime,
      )
      const row = (await this.repository.getConsumer(
        auth.orgId,
        auth.userId,
      )) as SqlRow | undefined
      if (!row || String(row.consumer_id) !== consumerId) {
        throw new AgentMailError(
          409,
          'AGENT_MAIL_CONSUMER_ACTIVE',
          'Another Moss client currently owns this mailbox',
        )
      }
      return Number(row.lease_until)
    })
  }

  private async leaseMessages(
    auth: AuthContext,
    consumerId: string,
    limit: number,
  ): Promise<{
    leaseToken: string | null
    leaseUntil: number | null
    messages: AgentMailMessage[]
  }> {
    const currentTime = now()
    const leaseToken = randomUUID()
    const leaseUntil = currentTime + DELIVERY_LEASE_MS
    const tokenHash = hashToken(leaseToken)
    let rows: SqlRow[] = []
    await this.repository.transaction(async () => {
      await this.requeueExpired(currentTime, auth.orgId, auth.userId)
      rows = (await this.repository.listQueuedMessages(
        auth.orgId,
        auth.userId,
        limit,
      )) as SqlRow[]
      for (const row of rows)
        await this.repository.claimMessage(
          consumerId,
          tokenHash,
          leaseUntil,
          String(row.id),
        )
    })
    if (rows.length === 0)
      return { leaseToken: null, leaseUntil: null, messages: [] }
    return {
      leaseToken,
      leaseUntil,
      messages: rows.map(row =>
        mapMessage({
          ...row,
          status: 'leased',
          attempts: Number(row.attempts || 0) + 1,
        }),
      ),
    }
  }

  private async requeueExpired(
    currentTime: number,
    orgId: string,
    userId: string,
  ): Promise<void> {
    await this.repository.expireMessages(
      currentTime,
      orgId,
      userId,
      currentTime,
    )
    await this.repository.failExhaustedMessages(
      currentTime,
      orgId,
      userId,
      currentTime,
      MAX_ATTEMPTS,
    )
    await this.repository.requeueMessages(
      orgId,
      userId,
      currentTime,
      MAX_ATTEMPTS,
      currentTime,
    )
  }

  private async requireLeasedMessage(
    auth: AuthContext,
    messageId: string,
    consumerId: string,
    leaseToken: string,
    statuses: AgentMailStatus[],
  ): Promise<SqlRow> {
    const row = (await this.repository.getRecipientMessage(
      messageId,
      auth.orgId,
      auth.userId,
    )) as SqlRow | undefined
    if (!row)
      throw new AgentMailError(
        404,
        'AGENT_MAIL_NOT_FOUND',
        'Agent Mail message was not found',
      )
    if (!statuses.includes(String(row.status) as AgentMailStatus)) {
      throw new AgentMailError(
        409,
        'AGENT_MAIL_INVALID_STATE',
        `Message cannot be updated from state ${String(row.status)}`,
      )
    }
    if (
      String(row.consumer_id || '') !== consumerId ||
      String(row.lease_token_hash || '') !== hashToken(leaseToken)
    ) {
      throw new AgentMailError(
        409,
        'AGENT_MAIL_LEASE_MISMATCH',
        'Agent Mail lease is no longer valid',
      )
    }
    if (Number(row.lease_until || 0) <= now()) {
      throw new AgentMailError(
        409,
        'AGENT_MAIL_LEASE_EXPIRED',
        'Agent Mail lease has expired',
      )
    }
    return row
  }

  private async enforceQuota(auth: AuthContext): Promise<void> {
    const currentTime = now()
    const hourCount = Number(
      (
        (await this.repository.countRecentSends(
          auth.orgId,
          auth.userId,
          currentTime - 60 * 60_000,
        )) as SqlRow
      ).count,
    )
    const dayCount = Number(
      (
        (await this.repository.countRecentSends(
          auth.orgId,
          auth.userId,
          currentTime - 24 * 60 * 60_000,
        )) as SqlRow
      ).count,
    )
    if (hourCount >= MAX_SENDS_PER_HOUR || dayCount >= MAX_SENDS_PER_DAY) {
      throw new AgentMailError(
        429,
        'AGENT_MAIL_RATE_LIMITED',
        'Agent Mail sending quota exceeded',
      )
    }
  }

  private async enforceBacklog(orgId: string, userId: string): Promise<void> {
    const row = (await this.repository.countBacklog(orgId, userId)) as SqlRow
    if (Number(row.count) >= MAX_BACKLOG) {
      throw new AgentMailError(
        429,
        'AGENT_MAIL_BACKLOG_FULL',
        'Recipient Agent Mail backlog is full',
      )
    }
  }

  private async getAclMode(
    orgId: string,
    ownerUserId: string,
    senderUserId: string,
  ): Promise<AgentMailAclMode> {
    if (ownerUserId === senderUserId) return 'auto'
    const row = (await this.repository.getAclMode(
      orgId,
      ownerUserId,
      senderUserId,
    )) as SqlRow | undefined
    return row ? (String(row.mode) as AgentMailAclMode) : 'manual'
  }

  private async requireActiveUser(
    orgId: string,
    userId: string,
  ): Promise<{ id: string; name: string; departmentId: string | null }> {
    if (!userId)
      throw new AgentMailError(
        400,
        'AGENT_MAIL_RECIPIENT_REQUIRED',
        'Recipient user ID is required',
      )
    const row = (await this.repository.getActiveUser(userId, orgId)) as
      SqlRow | undefined
    if (!row)
      throw new AgentMailError(
        404,
        'AGENT_MAIL_RECIPIENT_NOT_FOUND',
        'Recipient is not an active user in this organization',
      )
    return {
      id: String(row.id),
      name: String(row.name),
      departmentId:
        row.department_id == null ? null : String(row.department_id),
    }
  }

  private async requireActiveCaller(auth: AuthContext): Promise<void> {
    const row = (await this.repository.getUserStatus(
      auth.userId,
      auth.orgId,
    )) as SqlRow | undefined
    if (!row || String(row.status) !== 'active') {
      throw new AgentMailError(
        403,
        'AGENT_MAIL_ACCOUNT_DISABLED',
        'The authenticated Moss Server user is not active',
      )
    }
  }

  private async findByClientMessageId(
    userId: string,
    clientMessageId: string,
  ): Promise<AgentMailMessage | null> {
    const row = (await this.repository.findByClientMessageId(
      userId,
      clientMessageId,
    )) as SqlRow | undefined
    return row ? mapMessage(row) : null
  }

  private async getRawMessage(
    orgId: string,
    messageId: string,
  ): Promise<SqlRow | null> {
    return (
      ((await this.repository.getRawMessage(messageId, orgId)) as
        SqlRow | undefined) ?? null
    )
  }

  private async requireMessage(messageId: string): Promise<AgentMailMessage> {
    const row = (await this.repository.getMessage(messageId)) as
      SqlRow | undefined
    if (!row)
      throw new AgentMailError(
        404,
        'AGENT_MAIL_NOT_FOUND',
        'Agent Mail message was not found',
      )
    return mapMessage(row)
  }

  private notify(orgId: string, userId: string): void {
    for (const wake of this.waiters.get(`${orgId}:${userId}`) ?? []) wake()
  }

  private waitForNotification(
    orgId: string,
    userId: string,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
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
