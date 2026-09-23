import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Connection, Driver, SqlValue } from '../database.js'

export class SqliteDriver implements Driver {
  readonly dialect = 'sqlite' as const
  private readonly db: DatabaseSync
  private tail: Promise<void> = Promise.resolve()
  private closed = false
  constructor(filename: string) {
    if (filename !== ':memory:')
      mkdirSync(dirname(filename), { recursive: true })
    this.db = new DatabaseSync(filename)
    if (filename !== ':memory:') chmodSync(filename, 0o600)
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;',
    )
  }
  async acquire(): Promise<Connection> {
    if (this.closed) throw new Error('Database is closed')
    const previous = this.tail
    let unlock!: () => void
    this.tail = new Promise<void>(resolve => {
      unlock = resolve
    })
    await previous
    const values = (input: SqlValue[]) =>
      input.map(v => (v instanceof Uint8Array ? Buffer.from(v) : v))
    return {
      all: async (sql, input) => this.db.prepare(sql).all(...values(input)),
      run: async (sql, input) => {
        const result = this.db.prepare(sql).run(...values(input))
        return {
          changes: Number(result.changes),
          lastInsertRowid: result.lastInsertRowid,
        }
      },
      exec: async sql => {
        this.db.exec(sql)
      },
      release: unlock,
    }
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.tail
    this.db.close()
  }
}
