import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { readJsonResult, readJsonRanges } from '../../packages/app-sdk/src/results/index.mjs'
import { createResultTransport, readUtf16Range } from '../../packages/app-sdk/src/results/store.mjs'
import { TaskChangesWatcher } from '../../packages/app-sdk/src/execution/watcher.mjs'

test('shared transfers preserve Unicode, release on failures and renew bounded leases', async () => {
  let now = 0
  const store = createResultTransport({ now: () => now })
  const value = { text: '🙂汉字'.repeat(70000) }
  const packed = store.pack(value)
  expect(await readJsonResult(packed, { read: async input => store.read(input), release: async id => store.release(id) })).toEqual(value)
  expect(() => store.read({ id: packed.transfer.id, offset: 0 })).toThrow('expired')
  const lease = store.pack(value)
  now = 59000
  store.read({ id: lease.transfer.id, offset: 0 })
  now = 100000
  expect(store.read({ id: lease.transfer.id, offset: 0 }).nextOffset).toBeGreaterThan(0)
  now = 161000
  expect(() => store.read({ id: lease.transfer.id, offset: 0 })).toThrow('expired')
  let released = false
  await expect(readJsonResult(packed, { read: async () => ({ data: 'YQ==', nextOffset: 0, done: false }), release: async () => { released = true } })).rejects.toMatchObject({ code: 'APP_HOST_PROTOCOL_ERROR' })
  expect(released).toBe(true)
  store.close()
})

test('range reads join split surrogate pairs and reject loops, oversized results and cancellation', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'moss-result-range-'))
  try {
    const file = path.join(root, 'value.utf16'), value = { text: 'a'.repeat(31990) + '🙂汉字'.repeat(9000) }
    writeFileSync(file, JSON.stringify(value), 'utf16le')
    expect(await readJsonRanges(async ({ offset, limit }) => readUtf16Range(file, offset, limit))).toEqual(value)
    expect(readUtf16Range(file, 32000, 1).text.length).toBe(1)
    await expect(readJsonRanges(async () => ({ text: 'a', nextOffset: 0 }))).rejects.toMatchObject({ code: 'APP_HOST_PROTOCOL_ERROR' })
    await expect(readJsonRanges(async () => ({ text: 'abcd', nextOffset: null }), { maxBytes: 3 })).rejects.toMatchObject({ code: 'APP_RESOURCE_EXHAUSTED' })
    const abort = new AbortController(); abort.abort()
    await expect(readJsonRanges(async () => { throw new Error('should not run') }, { signal: abort.signal })).rejects.toMatchObject({ code: 'APP_ACTION_CANCELED' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('task watcher recovers missed live events, advances cursors after callbacks and resets expired cursors', async () => {
  let listener, cursor = 0, reset = false, disposed = false, resets = 0
  const feed = [], seen = []
  const client = {
    on: (_name, fn) => { listener = fn; return () => { disposed = true } },
    request: async (_method, input) => {
      if (!input.afterCursor || reset) { const wasReset = reset; reset = false; return { changes: [], nextCursor: String(cursor), reset: wasReset, hasMore: false } }
      return { changes: feed.filter(c => +c.cursor > +input.afterCursor), nextCursor: String(cursor), reset: false, hasMore: false }
    },
  }
  const watcher = new TaskChangesWatcher(client, task => seen.push(task.id), { onReset: () => { resets++ } })
  try {
    await watcher.ready
    feed.push({ cursor: String(++cursor), task: { id: 'missed' } })
    await watcher.refresh()
    expect(seen).toEqual(['missed'])
    await listener({ task: { id: 'missed' } }); await watcher.refresh()
    expect(seen).toEqual(['missed'])
    const live = { id: 'live', revision: 2, updatedAt: 2 }
    await listener({ task: live })
    expect(seen).toEqual(['missed', 'live'])
    feed.push({ cursor: String(++cursor), task: live })
    feed.push({ cursor: String(++cursor), task: { ...live, revision: 1, updatedAt: 1 } })
    await watcher.refresh()
    expect(seen).toEqual(['missed', 'live'])
    reset = true; await watcher.refresh()
    expect(resets).toBe(2)
  } finally { watcher.close() }
  expect(disposed).toBe(true)
})
