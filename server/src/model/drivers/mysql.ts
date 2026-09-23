import {
  createPool,
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise'
import type { DatabaseConfig } from '../config.js'
import type { Connection, Driver, SqlRow, SqlValue } from '../database.js'

export class MysqlDriver implements Driver {
  readonly dialect = 'mysql' as const
  private readonly pool: Pool
  constructor(config: Extract<DatabaseConfig, { driver: 'mysql' }>) {
    const user = process.env[config.userEnv]
    const password = process.env[config.passwordEnv]
    if (!user || !password)
      throw new Error(
        `MySQL requires environment variables ${config.userEnv} and ${config.passwordEnv}`,
      )
    this.pool = createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user,
      password,
      connectionLimit: config.connectionLimit,
      connectTimeout: config.connectTimeoutMs,
      waitForConnections: true,
      queueLimit: 200,
      // The protocol handshake only has one byte for the collation ID. The
      // 8.0 binary collation (309) must be selected after the handshake.
      charset: 'utf8mb4',
      supportBigNumbers: true,
      bigNumberStrings: true,
      decimalNumbers: true,
      multipleStatements: false,
      flags: ['-FOUND_ROWS'],
    })
  }
  async acquire(): Promise<Connection> {
    const connection = await this.pool.getConnection()
    try {
      await connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_0900_bin')
      await connection.query(
        "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ONLY_FULL_GROUP_BY,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,NO_BACKSLASH_ESCAPES'",
      )
      await connection.query(
        'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED',
      )
    } catch (error) {
      connection.release()
      throw error
    }
    const params = (input: SqlValue[]) =>
      input.map(value =>
        typeof value === 'bigint'
          ? value.toString()
          : value instanceof Uint8Array
            ? Buffer.from(value)
            : value,
      )
    return {
      all: async (sql, input) => {
        const [rows, fields] = await connection.execute<RowDataPacket[]>(
          { sql, timeout: 10000 },
          params(input),
        )
        return rows.map(row => {
          const result: SqlRow = { ...row }
          for (const field of fields) {
            if (
              [8, 246].includes(field.columnType ?? -1) &&
              result[field.name] != null
            ) {
              const value = Number(result[field.name])
              if (!Number.isSafeInteger(value))
                throw new Error(
                  `Database integer exceeds safe range: ${field.name}`,
                )
              result[field.name] = value
            }
          }
          return result
        })
      },
      run: async (sql, input) => {
        const [result] = await connection.execute<ResultSetHeader>(
          { sql, timeout: 10000 },
          params(input),
        )
        return {
          changes: result.affectedRows,
          lastInsertRowid: result.insertId,
        }
      },
      exec: async sql => {
        await connection.query(sql)
      },
      release: () => connection.release(),
    }
  }
  async close(): Promise<void> {
    await this.pool.end()
  }
}
