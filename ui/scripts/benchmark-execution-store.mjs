import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { AppExecutionHost } from '../src/apps/app-execution-host.mjs'

// Synthetic history comparable to the previous tasks.json benchmark; never opens user data.
for (const count of [10, 100, 250]) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-store-benchmark-'))
  const options = { directory, createSource: async () => ({ sessionId: 'benchmark' }), execute: async () => ({ value: {} }) }
  let host
  try {
    host = new AppExecutionHost(options)
    await host.ready
    await host.close()
    const db = new DatabaseSync(path.join(directory, 'tasks.sqlite'))
    const taskInsert = db.prepare('INSERT INTO tasks(id,owner,updated,state,summary) VALUES (?, ?, ?, ?, ?)')
    const execInsert = db.prepare('INSERT INTO executions VALUES (?, ?, ?, ?)')
    const eventInsert = db.prepare('INSERT INTO events VALUES (?, ?, ?)')
    db.exec('BEGIN')
    for (let n = 0; n < count; n++) {
      const id = `task-${n}`
      taskInsert.run(id, 'benchmark', Date.now(), JSON.stringify({ id, identity: 'benchmark', key: id, source: { sessionId: 'benchmark' }, owner: null, appId: 'fixture.benchmark', instanceId: 'default', status: 'completed', revision: 1, limits: { maxConcurrency: 8, maxCalls: 256, maxDurationMs: 1800000, maxTokens: 2000000 }, contexts: {}, updatedAt: Date.now() }), '{}')
      for (let i = 0; i < 8; i++) {
        const eid = `execution-${n}-${i}`
        execInsert.run(eid, id, JSON.stringify({ id: eid, taskId: id, status: 'completed', sequence: 50, tokens: 1, toolCalls: 1 }), JSON.stringify({ prompt: 'x'.repeat(5120), outputSchema: {} }))
        for (let sequence = 1; sequence <= 50; sequence++) eventInsert.run(eid, sequence, JSON.stringify({ eventId: `${eid}:${sequence}`, executionId: eid, sequence, type: 'progress', timestamp: 1, tokens: sequence, toolCalls: 1 }))
      }
    }
    db.exec('COMMIT'); db.close()
    host = new AppExecutionHost(options)
    await host.ready
    clearInterval(host.timer)
    const initialCacheSize = Object.keys(host.tasks).length
    await host.hydrate({ taskId: 'task-0' })
    const task = host.tasks['task-0'], execution = task.executions['execution-0-0']
    const sync = [], committed = []
    for (let i = 0; i < 5; i++) {
      const start = performance.now()
      host.event(task, execution, 'progress', { tokens: i + 1, toolCalls: 1 })
      sync.push(performance.now() - start)
      await host.flush()
      committed.push(performance.now() - start)
    }
    const median = values => Number([...values].sort((a, b) => a - b)[2].toFixed(2))
    console.log(JSON.stringify({ tasks: count, initialCacheSize, executionsPerTask: 8, eventsPerExecution: 50, mainThreadMedianMs: median(sync), commitMedianMs: median(committed), mainThreadMaxMs: Number(Math.max(...sync).toFixed(2)) }))
  } finally { await host?.close(); await fs.rm(directory, { recursive: true, force: true }) }
}
