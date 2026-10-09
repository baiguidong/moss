import { executionLimits } from '../../../packages/host-contracts/src/index.mjs'
import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import path from 'node:path'

fs.mkdirSync(path.dirname(workerData.file), { recursive: true, mode: 0o700 })
const sqlite = await import(process.versions.bun ? 'bun:sqlite' : 'node:sqlite')
const db = new (sqlite.DatabaseSync || sqlite.Database)(workerData.file)
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, owner TEXT NOT NULL, updated INTEGER NOT NULL, state TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS tasks_owner_updated ON tasks(owner, updated DESC, id);
  CREATE TABLE IF NOT EXISTS executions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, state TEXT NOT NULL, input TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS executions_task ON executions(task_id);
  CREATE TABLE IF NOT EXISTS events (execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, state TEXT NOT NULL, PRIMARY KEY(execution_id, sequence));
`)
const saveTask = db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated, state=excluded.state')
const saveExecution = db.prepare('INSERT INTO executions VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state')
const saveEvent = db.prepare('INSERT INTO events VALUES (?, ?, ?)')
const prune = db.prepare('DELETE FROM events WHERE execution_id=? AND sequence<=?')

parentPort.on('message', ({ id, method, input }) => {
  try {
    let result
    if (method === 'load') {
      const tasks = Object.fromEntries(db.prepare('SELECT id,state FROM tasks').all().map(row => [row.id, { ...JSON.parse(row.state), executions: {} }]))
      for (const row of db.prepare('SELECT id,task_id,state,input FROM executions').all()) tasks[row.task_id].executions[row.id] = { ...JSON.parse(row.state), input: JSON.parse(row.input), events: [] }
      for (const row of db.prepare('SELECT e.task_id,v.execution_id,v.state FROM events v JOIN executions e ON e.id=v.execution_id ORDER BY v.sequence').all()) tasks[row.task_id].executions[row.execution_id].events.push(JSON.parse(row.state))
      result = tasks
    } else if (method === 'save') {
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const { task, execution, event } of input) {
          saveTask.run(task.id, task.identity, task.updatedAt, JSON.stringify(task))
          if (execution) {
            const { input: executionInput, ...state } = execution
            saveExecution.run(execution.id, task.id, JSON.stringify(state), JSON.stringify(executionInput))
          }
          if (event) { saveEvent.run(event.executionId, event.sequence, JSON.stringify(event)); prune.run(event.executionId, event.sequence - executionLimits.eventHistory) }
        }
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      result = true
    } else if (method === 'list') {
      result = db.prepare('SELECT id FROM tasks WHERE owner=? ORDER BY updated DESC,id LIMIT ? OFFSET ?').all(input.owner, input.limit, input.offset).map(row => row.id)
    } else if (method === 'close') { db.close(); result = true }
    else throw new Error('Unknown execution store operation')
    parentPort.postMessage({ id, result })
    if (method === 'close') parentPort.close()
  } catch (error) { parentPort.postMessage({ id, error: String(error?.message || error) }) }
})
