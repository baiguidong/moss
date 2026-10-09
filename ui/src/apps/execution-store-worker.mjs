import { randomUUID } from 'node:crypto'
import { executionLimits } from '../../../packages/host-contracts/src/index.mjs'
import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import path from 'node:path'

fs.mkdirSync(path.dirname(workerData.file), { recursive: true, mode: 0o700 })
const sqlite = await import(process.versions.bun ? 'bun:sqlite' : 'node:sqlite')
const db = new (sqlite.DatabaseSync || sqlite.Database)(workerData.file)
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS tasks (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, updated INTEGER NOT NULL, state TEXT NOT NULL, summary TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS tasks_owner_updated ON tasks(owner, sequence DESC);
  CREATE TABLE IF NOT EXISTS executions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, state TEXT NOT NULL, input TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS tasks_key ON tasks(json_extract(state,'$.key'));
  CREATE INDEX IF NOT EXISTS tasks_session ON tasks(json_extract(state,'$.source.sessionId'), updated DESC);
  CREATE INDEX IF NOT EXISTS tasks_scope ON tasks(json_extract(state,'$.scopeRef'));
  CREATE TABLE IF NOT EXISTS changes (cursor INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, task_id TEXT NOT NULL, timestamp INTEGER NOT NULL, state TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS changes_owner_cursor ON changes(owner,cursor);
  CREATE TABLE IF NOT EXISTS change_floors (owner TEXT PRIMARY KEY, cursor INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS executions_task ON executions(task_id);
  CREATE TABLE IF NOT EXISTS events (execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, state TEXT NOT NULL, PRIMARY KEY(execution_id, sequence));
`)
const saveTask = db.prepare('INSERT INTO tasks(id,owner,updated,state,summary) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated, state=excluded.state, summary=excluded.summary')
const saveExecution = db.prepare('INSERT INTO executions VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state')
const saveEvent = db.prepare('INSERT INTO events VALUES (?, ?, ?)')
const prune = db.prepare('DELETE FROM events WHERE execution_id=? AND sequence<=?')

db.prepare("INSERT OR IGNORE INTO metadata VALUES ('epoch', ?)").run(randomUUID())
const epoch = db.prepare("SELECT value FROM metadata WHERE key='epoch'").get().value
function cursor(owner, sequence, kind = 'changes') { return Buffer.from(JSON.stringify({ epoch, owner, sequence, kind })).toString('base64url') }
function decode(value, owner, kind = 'changes') {
  try { const data = JSON.parse(Buffer.from(value, 'base64url').toString()); if (data.kind !== kind || data.epoch !== epoch || data.owner !== owner || !Number.isSafeInteger(data.sequence) || data.sequence < 0) return null; return data.sequence } catch { return null }
}
function loadRows(rows) {
  const tasks = Object.fromEntries(rows.map(row => [row.id, { ...JSON.parse(row.state), executions: {} }]))
  for (const task of Object.values(tasks)) {
    for (const row of db.prepare('SELECT id,state,input FROM executions WHERE task_id=?').all(task.id)) {
      task.executions[row.id] = { ...JSON.parse(row.state), input: JSON.parse(row.input), events: db.prepare('SELECT state FROM events WHERE execution_id=? ORDER BY sequence').all(row.id).map(e => JSON.parse(e.state)) }
    }
  }
  return tasks
}
function pruneHistory(now) {
  const expired = db.prepare("SELECT id FROM tasks WHERE json_extract(state,'$.status')!='running' AND updated<=?").all(now - executionLimits.retentionMs)
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const { id } of expired) db.prepare('DELETE FROM tasks WHERE id=?').run(id)
    for (const { owner } of db.prepare('SELECT DISTINCT owner FROM changes').all()) {
      const cutoff = db.prepare('SELECT cursor FROM changes WHERE owner=? ORDER BY cursor DESC LIMIT 1 OFFSET ?').get(owner, executionLimits.changeHistory)?.cursor || 0
      const age = db.prepare('SELECT MAX(cursor) AS cursor FROM changes WHERE owner=? AND timestamp<?').get(owner, now - executionLimits.changeRetentionMs)?.cursor || 0
      const floor = Math.max(cutoff, age)
      if (floor) {
        db.prepare('INSERT INTO change_floors VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET cursor=MAX(cursor,excluded.cursor)').run(owner, floor)
        db.prepare('DELETE FROM changes WHERE owner=? AND cursor<=?').run(owner, floor)
      }
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  // Results outlive the transaction until cleanup. Never delete user files or active writes.
  const ids = new Set(db.prepare('SELECT id FROM executions').all().map(row => row.id))
  for (const name of fs.readdirSync(path.dirname(workerData.file))) {
    const match = /^(exec_[0-9a-f-]+)\.result\.utf16(?:\.[0-9a-f-]+\.tmp)?$/.exec(name)
    if (!match) continue
    const file = path.join(path.dirname(workerData.file), name)
    if ((!ids.has(match[1]) || name.endsWith('.tmp')) && fs.statSync(file).mtimeMs < now - 3600000) fs.rmSync(file, { force: true })
  }
  return expired.map(row => row.id)
}

parentPort.on('message', ({ id, method, input }) => {
  try {
    let result
    if (method === 'load') {
      result = loadRows(input?.initial
        ? db.prepare("SELECT id,state FROM tasks WHERE json_extract(state,'$.status')='running' OR json_extract(state,'$.notificationPending')=1 UNION SELECT id,state FROM (SELECT id,state FROM tasks ORDER BY updated DESC LIMIT 100)").all()
        : input?.taskId ? db.prepare('SELECT id,state FROM tasks WHERE id=?').all(input.taskId)
        : input?.executionId ? db.prepare('SELECT t.id,t.state FROM tasks t JOIN executions e ON e.task_id=t.id WHERE e.id=?').all(input.executionId)
        : input?.key ? db.prepare("SELECT id,state FROM tasks WHERE json_extract(state,'$.key')=?").all(input.key)
        : input?.scopeRef ? db.prepare("SELECT id,state FROM tasks WHERE json_extract(state,'$.scopeRef')=?").all(input.scopeRef)
        : db.prepare('SELECT id,state FROM tasks').all())
    } else if (method === 'session') {
      result = db.prepare("SELECT summary FROM tasks WHERE json_extract(state,'$.source.sessionId')=? AND (json_extract(state,'$.status')='running' OR updated>?) ORDER BY updated DESC LIMIT 100").all(input.sessionId, Date.now()-executionLimits.retentionMs).map(row => JSON.parse(row.summary))
    } else if (method === 'save') {
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const { task, execution, event, change } of input) {
          saveTask.run(task.id, task.identity, task.updatedAt, JSON.stringify(task), JSON.stringify(change))
          if (execution) {
            const { input: executionInput, ...state } = execution
            saveExecution.run(execution.id, task.id, JSON.stringify(state), JSON.stringify(executionInput))
          }
          if (change) db.prepare('INSERT INTO changes(owner,task_id,timestamp,state) VALUES (?,?,?,?)').run(task.identity, task.id, Date.now(), JSON.stringify(change))
          if (event) { saveEvent.run(event.executionId, event.sequence, JSON.stringify(event)); prune.run(event.executionId, event.sequence - executionLimits.eventHistory) }
        }
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      result = true
    } else if (method === 'list') {
      const after = input.cursor ? decode(input.cursor, input.owner, 'list') : null
      if (input.cursor && after === null) throw new Error('Invalid task cursor')
      // Monotonic creation sequence is never reused after retention deletes.
      const rows = db.prepare("SELECT sequence,id,summary FROM tasks WHERE owner=? AND (? IS NULL OR sequence<?) AND (json_extract(state,'$.status')='running' OR updated>?) ORDER BY sequence DESC LIMIT ?").all(input.owner, after, after, Date.now()-executionLimits.retentionMs, input.limit + 1)
      result = { tasks: rows.slice(0,input.limit).map(row => JSON.parse(row.summary)), nextCursor: rows.length > input.limit ? cursor(input.owner,rows[input.limit-1].sequence,'list') : null }
    } else if (method === 'changes') {
      const floor = db.prepare('SELECT cursor FROM change_floors WHERE owner=?').get(input.owner)?.cursor || 0
      const latest = Math.max(floor, db.prepare('SELECT MAX(cursor) AS cursor FROM changes WHERE owner=?').get(input.owner)?.cursor || 0)
      const after = input.afterCursor ? decode(input.afterCursor, input.owner) : latest
      if (after === null || after < floor || after > latest) result = { changes: [], nextCursor: cursor(input.owner,latest), reset: true, hasMore: false }
      else {
        const rows = db.prepare('SELECT cursor,state FROM changes WHERE owner=? AND cursor>? ORDER BY cursor LIMIT ?').all(input.owner, after, input.limit + 1)
        result = { changes: rows.slice(0,input.limit).map(row => ({ cursor: cursor(input.owner,row.cursor), task: JSON.parse(row.state) })), nextCursor: cursor(input.owner,rows.length ? rows[Math.min(rows.length,input.limit)-1].cursor : latest), hasMore: rows.length > input.limit, reset: false }
      }
    } else if (method === 'prune') {
      result = pruneHistory(input?.now || Date.now())
    } else if (method === 'close') { db.close(); result = true }
    else throw new Error('Unknown execution store operation')
    parentPort.postMessage({ id, result })
    if (method === 'close') parentPort.close()
  } catch (error) { parentPort.postMessage({ id, error: String(error?.message || error) }) }
})
