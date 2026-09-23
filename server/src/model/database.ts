import { AsyncLocalStorage } from 'node:async_hooks'
import { normalizeDatabaseError } from './errors.js'

export type SqlValue = string | number | bigint | null | Uint8Array
export type SqlRow = Record<string, unknown>
export type WriteResult = { changes: number; lastInsertRowid: number | bigint }
export interface Connection {
  all(sql: string, values: SqlValue[]): Promise<SqlRow[]>
  run(sql: string, values: SqlValue[]): Promise<WriteResult>
  exec(sql: string): Promise<void>
  release(): void
}
export interface Driver {
  readonly dialect: 'sqlite' | 'mysql'
  acquire(): Promise<Connection>
  close(): Promise<void>
}

type TransactionContext = {
  connection: Connection
  active: boolean
  depth: number
  transactional: boolean
}

/** All access, including non-transactional queries, goes through this connection owner. */
export class Database {
  private readonly context = new AsyncLocalStorage<TransactionContext>()
  private closing: Promise<void> | undefined
  constructor(private readonly driver: Driver) {}
  get dialect() {
    return this.driver.dialect
  }
  sql(sqlite: string, mysql: string): string {
    return this.dialect === 'mysql' ? mysql : sqlite
  }

  private async using<T>(
    operation: (connection: Connection) => Promise<T>,
  ): Promise<T> {
    const context = this.context.getStore()
    if (context && !context.active)
      throw new Error('Transaction is already closed')
    const connection = context?.connection ?? (await this.driver.acquire())
    try {
      return await operation(connection)
    } catch (error) {
      throw normalizeDatabaseError(error)
    } finally {
      if (!context) connection.release()
    }
  }

  prepare(sql: string) {
    return {
      all: (...values: SqlValue[]) => this.using(c => c.all(sql, values)),
      get: async (...values: SqlValue[]) =>
        (await this.using(c => c.all(sql, values)))[0],
      run: (...values: SqlValue[]) => this.using(c => c.run(sql, values)),
    }
  }
  exec(sql: string): Promise<void> {
    return this.using(c => c.exec(sql))
  }
  async check(): Promise<void> {
    await this.prepare('SELECT 1 AS ok').get()
  }

  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const outer = this.context.getStore()
    if (outer?.transactional) {
      if (!outer.active) throw new Error('Transaction is already closed')
      const savepoint = `moss_sp_${++outer.depth}`
      await outer.connection.exec(`SAVEPOINT ${savepoint}`)
      try {
        const value = await operation()
        await outer.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
        return value
      } catch (error) {
        await outer.connection.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
        await outer.connection.exec(`RELEASE SAVEPOINT ${savepoint}`)
        throw normalizeDatabaseError(error)
      }
    }
    const connection = outer?.connection ?? (await this.driver.acquire())
    const context: TransactionContext = {
      connection,
      active: true,
      depth: 0,
      transactional: true,
    }
    try {
      await connection.exec(
        this.dialect === 'sqlite' ? 'BEGIN IMMEDIATE' : 'START TRANSACTION',
      )
      // Short application write transactions have the same serialization guarantee
      // on both engines. The row lock also coordinates Server, Runner, and CLI.
      if (this.dialect === 'mysql')
        await connection.all(
          'SELECT id FROM model_write_lock WHERE id = 1 FOR UPDATE',
          [],
        )
      const value = await this.context.run(context, operation)
      await connection.exec('COMMIT')
      return value
    } catch (error) {
      await connection.exec('ROLLBACK').catch(() => {})
      throw normalizeDatabaseError(error)
    } finally {
      context.active = false
      if (!outer) connection.release()
    }
  }

  async initializeSchema(operation: () => Promise<void>): Promise<void> {
    const connection = await this.driver.acquire()
    const context: TransactionContext = {
      connection,
      active: true,
      depth: 0,
      transactional: this.dialect === 'sqlite',
    }
    let locked = false
    try {
      if (this.dialect === 'mysql') {
        const [row] = await connection.all(
          "SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':moss-schema'),256),30) AS acquired",
          [],
        )
        if (Number(row?.acquired) !== 1)
          throw new Error('Timed out waiting for database initialization')
      } else await connection.exec('BEGIN EXCLUSIVE')
      locked = true
      await this.context.run(context, operation)
      if (this.dialect === 'sqlite') await connection.exec('COMMIT')
    } catch (error) {
      if (locked && this.dialect === 'sqlite')
        await connection.exec('ROLLBACK').catch(() => {})
      throw error
    } finally {
      context.active = false
      if (locked && this.dialect === 'mysql')
        await connection
          .all(
            "SELECT RELEASE_LOCK(SHA2(CONCAT(DATABASE(), ':moss-schema'),256))",
            [],
          )
          .catch(() => {})
      connection.release()
    }
  }
  close(): Promise<void> {
    return (this.closing ??= this.driver.close())
  }
}
