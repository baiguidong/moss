import type { Database, SqlRow, SqlValue, WriteResult } from '../database.js'

export class AgentMailRepository {
  constructor(readonly db: Database) {}
  async claimMessage(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        "UPDATE agent_mail_messages SET status='leased', consumer_id=?, lease_token_hash=?, lease_until=?, attempts=attempts+1 WHERE id=? AND status='queued'",
      )
      .run(...values)
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return await this.db.transaction(fn)
  }
  async searchRecipients<T = SqlRow>(...values: SqlValue[]): Promise<T[]> {
    return (await this.db
      .prepare(
        `
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
    `,
      )
      .all(...values)) as T[]
  }
  async upsertAcl(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        this.db.sql(
          `
      INSERT INTO agent_mail_acl (org_id, owner_user_id, sender_user_id, mode, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (org_id, owner_user_id, sender_user_id) DO UPDATE SET
        mode = excluded.mode, updated_at = excluded.updated_at
    `,
          `
      INSERT INTO agent_mail_acl (org_id, owner_user_id, sender_user_id, mode, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        mode = VALUES(mode), updated_at = VALUES(updated_at)
    `,
        ),
      )
      .run(...values)
  }
  async failBlockedMessages(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        `
        UPDATE agent_mail_messages
        SET status = 'failed', error = 'Recipient blocked this sender', completed_at = ?
        WHERE org_id = ? AND to_user_id = ? AND from_user_id = ? AND status = 'queued'
      `,
      )
      .run(...values)
  }
  async getThreadHopCount<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
        SELECT MAX(hop_count) AS max_hop FROM agent_mail_messages WHERE org_id = ? AND thread_id = ?
      `,
      )
      .get(...values)) as T | undefined
  }
  async insertMessage(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        `
      INSERT INTO agent_mail_messages (
        id, org_id, from_user_id, to_user_id, client_message_id, subject, content,
        thread_id, reply_to, hop_count, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
    `,
      )
      .run(...values)
  }
  async markAccepted(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        `
      UPDATE agent_mail_messages
      SET status = 'accepted', accepted_at = ?, lease_until = ?
      WHERE id = ?
    `,
      )
      .run(...values)
  }
  async renewMessageLease(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        `
      UPDATE agent_mail_messages SET status = 'running', lease_until = ? WHERE id = ?
    `,
      )
      .run(...values)
  }
  async completeMessage(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        `
      UPDATE agent_mail_messages
      SET status = ?, error = ?, completed_at = ?, lease_until = NULL
      WHERE id = ?
    `,
      )
      .run(...values)
  }
  async listMessages<T = SqlRow>(
    column: 'm.to_user_id' | 'm.from_user_id',
    ...values: SqlValue[]
  ): Promise<T[]> {
    return (await this.db
      .prepare(
        `
      ${this.messageSelect()}
      WHERE m.org_id = ? AND ${column} = ?
        AND NOT EXISTS (
          SELECT 1 FROM agent_mail_deletions deletion
          WHERE deletion.message_id = m.id AND deletion.user_id = ?
        )
      ORDER BY m.created_at DESC
      LIMIT ?
    `,
      )
      .all(...values)) as T[]
  }
  async findVisibleMessage<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      SELECT id FROM agent_mail_messages
      WHERE id = ? AND org_id = ? AND (from_user_id = ? OR to_user_id = ?)
    `,
      )
      .get(...values)) as T | undefined
  }
  async insertDeletion(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        this.db.sql(
          `
      INSERT OR IGNORE INTO agent_mail_deletions (message_id, user_id, deleted_at)
      VALUES (?, ?, ?)
    `,
          `
      INSERT INTO agent_mail_deletions (message_id, user_id, deleted_at)
      VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE message_id=message_id`,
        ),
      )
      .run(...values)
  }
  async upsertConsumer(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        this.db.sql(
          `
      INSERT INTO agent_mail_consumers (org_id, user_id, consumer_id, lease_until, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (org_id, user_id) DO UPDATE SET
        consumer_id = excluded.consumer_id,
        lease_until = excluded.lease_until,
        updated_at = excluded.updated_at
    `,
          `
      INSERT INTO agent_mail_consumers (org_id, user_id, consumer_id, lease_until, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        consumer_id = VALUES(consumer_id),
        lease_until = VALUES(lease_until),
        updated_at = VALUES(updated_at)
    `,
        ),
      )
      .run(...values)
  }
  async getConsumer<T = SqlRow>(...values: SqlValue[]): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      SELECT consumer_id, lease_until FROM agent_mail_consumers WHERE org_id = ? AND user_id = ?
    `,
      )
      .get(...values)) as T | undefined
  }
  async listQueuedMessages<T = SqlRow>(...values: SqlValue[]): Promise<T[]> {
    return (await this.db
      .prepare(
        `
        ${this.messageSelect()}
        WHERE m.org_id = ? AND m.to_user_id = ? AND m.status = 'queued'
          AND COALESCE(acl.mode, CASE WHEN m.from_user_id = m.to_user_id THEN 'auto' ELSE 'manual' END) <> 'blocked'
        ORDER BY m.created_at ASC
        LIMIT ?
      `,
      )
      .all(...values)) as T[]
  }
  async expireMessages(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        `
      UPDATE agent_mail_messages
      SET status = 'expired', error = COALESCE(error, 'Message expired before completion'), completed_at = ?, lease_until = NULL
      WHERE org_id = ? AND to_user_id = ? AND status IN ('queued','leased','accepted','running') AND expires_at <= ?
    `,
      )
      .run(...values)
  }
  async failExhaustedMessages(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        `
      UPDATE agent_mail_messages
      SET status = 'failed', error = COALESCE(error, 'Maximum delivery attempts exceeded'), completed_at = ?, lease_until = NULL
      WHERE org_id = ? AND to_user_id = ? AND status IN ('leased','accepted','running')
        AND lease_until <= ? AND attempts >= ?
    `,
      )
      .run(...values)
  }
  async requeueMessages(...values: SqlValue[]): Promise<WriteResult> {
    return await this.db
      .prepare(
        `
      UPDATE agent_mail_messages
      SET status = 'queued', consumer_id = NULL, lease_token_hash = NULL, lease_until = NULL
      WHERE org_id = ? AND to_user_id = ? AND status IN ('leased','accepted','running')
        AND lease_until <= ? AND attempts < ? AND expires_at > ?
    `,
      )
      .run(...values)
  }
  async getRecipientMessage<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      ${this.messageSelect()}
      WHERE m.id = ? AND m.org_id = ? AND m.to_user_id = ?
    `,
      )
      .get(...values)) as T | undefined
  }
  async countRecentSends<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      SELECT COUNT(*) AS count FROM agent_mail_messages WHERE org_id = ? AND from_user_id = ? AND created_at >= ?
    `,
      )
      .get(...values)) as T | undefined
  }
  async countBacklog<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      SELECT COUNT(*) AS count FROM agent_mail_messages
      WHERE org_id = ? AND to_user_id = ? AND status IN ('queued','leased','accepted','running')
    `,
      )
      .get(...values)) as T | undefined
  }
  async getAclMode<T = SqlRow>(...values: SqlValue[]): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      SELECT mode FROM agent_mail_acl WHERE org_id = ? AND owner_user_id = ? AND sender_user_id = ?
    `,
      )
      .get(...values)) as T | undefined
  }
  async getActiveUser<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      SELECT id, name, department_id FROM users WHERE id = ? AND org_id = ? AND status = 'active'
    `,
      )
      .get(...values)) as T | undefined
  }
  async getUserStatus<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      SELECT status FROM users WHERE id = ? AND org_id = ?
    `,
      )
      .get(...values)) as T | undefined
  }
  async findByClientMessageId<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      ${this.messageSelect()}
      WHERE m.from_user_id = ? AND m.client_message_id = ?
    `,
      )
      .get(...values)) as T | undefined
  }
  async getRawMessage<T = SqlRow>(
    ...values: SqlValue[]
  ): Promise<T | undefined> {
    return (await this.db
      .prepare('SELECT * FROM agent_mail_messages WHERE id = ? AND org_id = ?')
      .get(...values)) as T | undefined
  }
  async getMessage<T = SqlRow>(...values: SqlValue[]): Promise<T | undefined> {
    return (await this.db
      .prepare(
        `
      ${this.messageSelect()}
      WHERE m.id = ?
    `,
      )
      .get(...values)) as T | undefined
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
}
