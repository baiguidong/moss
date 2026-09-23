import { createHash, randomUUID } from 'node:crypto'
import { databaseConfigSchema, type DatabaseConfig } from '../model/config.js'
import { openDatabase } from '../model/index.js'

const configs = new Map<string, DatabaseConfig>()

// Each fixture runs in its own Node process. Drop only the databases this process
// created after its pools have closed, including when an assertion failed.
if (process.env.MOSS_TEST_MYSQL)
  process.once('beforeExit', () => {
    void (async () => {
      const { createConnection } = await import('mysql2/promise')
      const admin = await createConnection(process.env.MOSS_TEST_MYSQL!)
      try {
        for (const config of configs.values()) {
          if (config.driver === 'mysql')
            await admin.query(`DROP DATABASE \`${config.database}\``)
        }
      } finally {
        await admin.end()
      }
    })().catch(() => {
      process.stderr.write(
        'Failed to clean up disposable MySQL test databases\n',
      )
      process.exitCode = 1
    })
  })

/** Optional real MySQL matrix. Use only a disposable MySQL test instance. */
export async function testDatabaseConfig(
  filename = ':memory:',
): Promise<DatabaseConfig> {
  if (!process.env.MOSS_TEST_MYSQL) return { driver: 'sqlite', filename }
  const key = filename === ':memory:' ? randomUUID() : filename
  const existing = configs.get(key)
  if (existing) return existing
  const database = `moss_test_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`
  const { createConnection } = await import('mysql2/promise')
  const admin = await createConnection(process.env.MOSS_TEST_MYSQL)
  try {
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`,
    )
  } finally {
    await admin.end()
  }
  const url = new URL(process.env.MOSS_TEST_MYSQL)
  process.env.MOSS_TEST_DB_USER = decodeURIComponent(url.username)
  process.env.MOSS_TEST_DB_PASSWORD = decodeURIComponent(url.password)
  const config = databaseConfigSchema.parse({
    driver: 'mysql',
    host: url.hostname,
    port: Number(url.port || 3306),
    database,
    userEnv: 'MOSS_TEST_DB_USER',
    passwordEnv: 'MOSS_TEST_DB_PASSWORD',
    connectionLimit: 4,
  })
  configs.set(key, config)
  return config
}

export async function openTestDatabase(filename = ':memory:') {
  return await openDatabase(await testDatabaseConfig(filename), {
    initialize: true,
  })
}
