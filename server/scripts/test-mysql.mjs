#!/usr/bin/env node
// A disposable MySQL instance for the same suite used by SQLite.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { createConnection } from 'mysql2/promise'

const image = process.env.MOSS_TEST_MYSQL_IMAGE || 'mysql:8.4.8'
const suffix = randomBytes(6).toString('hex')
const container = `moss-mysql-test-${suffix}`
const volume = `${container}-data`
const password = randomBytes(24).toString('hex')
const database = `moss_test_restart_${suffix}`
let containerCreated = false
let volumeCreated = false

function docker(args, input) {
  const result = spawnSync('docker', args, { encoding: 'utf8', input })
  if (result.status !== 0)
    throw new Error(result.stderr || 'Docker command failed')
  return result.stdout.trim()
}

function rootSql(sql) {
  return docker(
    [
      'exec',
      '-i',
      container,
      'sh',
      '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=TCP --host=127.0.0.1 --user=root --batch --skip-column-names',
    ],
    sql,
  )
}

async function ready() {
  for (let i = 0; i < 90; i++) {
    try {
      rootSql('SELECT 1;')
      return
    } catch {}
    await delay(1000)
  }
  throw new Error('MySQL did not become ready within 90 seconds')
}

async function run() {
  const present = spawnSync('docker', ['image', 'inspect', image], {
    stdio: 'ignore',
  })
  if (present.status !== 0) {
    const pull = spawn('docker', ['pull', image], { stdio: 'inherit' })
    const code = await new Promise((resolve, reject) => {
      pull.once('error', reject)
      pull.once('exit', resolve)
    })
    if (code !== 0) throw new Error('MySQL image pull failed')
  }
  docker(['volume', 'create', volume])
  volumeCreated = true
  docker([
    'run',
    '-d',
    '--name',
    container,
    '-p',
    '127.0.0.1::3306',
    '-v',
    `${volume}:/var/lib/mysql`,
    '-e',
    `MYSQL_ROOT_PASSWORD=${password}`,
    image,
  ])
  containerCreated = true
  console.log(`Waiting for ${image}`)
  await ready()
  rootSql(`CREATE USER 'moss_test'@'%' IDENTIFIED BY '${password}';
GRANT ALL PRIVILEGES ON \`moss_test_%\`.* TO 'moss_test'@'%';`)
  const connectionUri = () =>
    `mysql://moss_test:${password}@127.0.0.1:${docker(['port', container, '3306/tcp']).split(':').at(-1)}`
  let uri = connectionUri()
  let connection = await createConnection(uri)
  try {
    const [identity] = await connection.query(
      'SELECT CURRENT_USER() AS account, VERSION() AS version',
    )
    assert.equal(identity[0].account, 'moss_test@%')
    console.log(`Connected as application user; MySQL ${identity[0].version}`)
    await assert.rejects(connection.query('CREATE DATABASE forbidden_database'))
    await connection.query(`CREATE DATABASE \`${database}\``)
    await connection.query(
      `CREATE TABLE \`${database}\`.restart_marker (id INTEGER PRIMARY KEY)`,
    )
    await connection.query(
      `INSERT INTO \`${database}\`.restart_marker VALUES (42)`,
    )
  } finally {
    await connection.end()
  }
  docker(['restart', container])
  await ready()
  uri = connectionUri()
  connection = await createConnection(uri)
  try {
    const [rows] = await connection.query(
      `SELECT id FROM \`${database}\`.restart_marker`,
    )
    assert.equal(rows[0].id, 42)
    await connection.query(`DROP DATABASE \`${database}\``)
  } finally {
    await connection.end()
  }
  console.log('Application-account permissions and restart persistence passed')
  const suite = spawn('bun', ['test', 'src'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, MOSS_TEST_MYSQL: uri },
    stdio: 'inherit',
  })
  const code = await new Promise((resolve, reject) => {
    suite.once('error', reject)
    suite.once('exit', resolve)
  })
  if (code !== 0) throw new Error(`MySQL test suite failed (${code})`)
  const [databases] = await (async () => {
    const admin = await createConnection(uri)
    try {
      return await admin.query("SHOW DATABASES LIKE 'moss_test_%'")
    } finally {
      await admin.end()
    }
  })()
  assert.equal(databases.length, 0, 'All fixture databases must be cleaned up')
}

try {
  await run()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  if (containerCreated) docker(['rm', '-f', container])
  if (volumeCreated) docker(['volume', 'rm', volume])
}
