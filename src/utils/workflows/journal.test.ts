import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { WorkflowJournal } from './journal.js'

describe('WorkflowJournal', () => {
  test('persists and reloads results by stable node cache key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moss-workflow-journal-'))
    const path = join(dir, 'journal.jsonl')
    try {
      const journal = new WorkflowJournal(path)
      await journal.append({ type: 'started', key: 'node:abc', agentId: 'agent-1' })
      await journal.append({ type: 'result', key: 'node:abc', agentId: 'agent-1', result: { ok: true } })
      await journal.append({
        type: 'node',
        event: {
          type: 'workflow_node',
          sequence: 1,
          nodeId: 'review',
          instanceId: 'review',
          state: 'completed',
          timestamp: 1,
        },
      })
      await journal.flush()

      expect(await readFile(path, 'utf8')).toContain('"key":"node:abc"')
      const snapshot = await journal.load()
      expect(snapshot.results.get('node:abc')).toEqual({
        agentId: 'agent-1',
        result: { ok: true },
      })
      expect(snapshot.started.has('node:abc')).toBe(false)
      expect(snapshot.nodeEvents).toContainEqual(expect.objectContaining({
        nodeId: 'review',
        state: 'completed',
      }))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
