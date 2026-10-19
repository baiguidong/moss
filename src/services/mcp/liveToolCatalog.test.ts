import { expect, test } from 'bun:test'
import { LiveToolCatalog } from './liveToolCatalog'
const tool = (name: string, type = 'string') => ({ name, inputSchema: { type: 'object', properties: { value: { type } } } })

test('complete pagination commits atomically; failure keeps old schema and revision marked stale', async () => {
  let fail = false, round = 0, commits = 0
  const catalog = new LiveToolCatalog({ page: async cursor => {
    if (cursor && fail) throw new Error('second page failed')
    return cursor ? { tools: [tool('second')] } : { tools: [tool('first', round ? 'number' : 'string')], nextCursor: '2' }
  }, committed: () => { commits++ } })
  expect((await catalog.refresh()).tools).toHaveLength(2)
  const old = catalog.snapshot
  round++; fail = true
  await expect(catalog.refresh()).rejects.toThrow('second page failed')
  expect(catalog.snapshot).toBe(old); expect(commits).toBe(1); expect(catalog.state().stale).toBe(true)
  fail = false; await catalog.refresh()
  expect(catalog.snapshot!.revision).not.toBe(old!.revision)
  expect(catalog.state().stale).toBe(false)
})

test('duplicate cursors/names and malformed schemas cannot replace a complete catalog', async () => {
  for (const invalid of [
    { tools: [tool('same')], nextCursor: 'loop' },
    { tools: [tool('same'), tool('same')] },
    { tools: [{ name: 'bad', inputSchema: { type: 'string' } }] },
  ]) {
    const catalog = new LiveToolCatalog({ page: async () => invalid })
    await expect(catalog.refresh()).rejects.toThrow()
    expect(catalog.snapshot).toBeUndefined()
  }
})

test('concurrent refresh is coalesced; cancellation after a page prevents commit', async () => {
  let resolve!: (value: unknown) => void, calls = 0
  const owner = new AbortController()
  const catalog = new LiveToolCatalog({ signal: owner.signal, page: async () => { calls++; return new Promise(yes => { resolve = yes }) } })
  const first = catalog.refresh(), second = catalog.refresh()
  expect(first).toBe(second); expect(calls).toBe(1)
  owner.abort(new Error('released')); resolve({ tools: [tool('one')] })
  await expect(first).rejects.toThrow('released'); expect(catalog.snapshot).toBeUndefined()
})

test('empty completed catalog is a real deletion; bounded timeout leaves prior snapshot intact', async () => {
  let hang = false
  const catalog = new LiveToolCatalog({ timeoutMs: 15, page: async (_cursor, signal) => {
    if (hang) return new Promise((_yes, no) => signal.addEventListener('abort', () => no(signal.reason), { once: true }))
    return { tools: [] }
  } })
  expect(await catalog.refresh()).toEqual({ tools: [] })
  hang = true; await expect(catalog.refresh()).rejects.toThrow()
  expect(catalog.snapshot!.result.tools).toEqual([]); expect(catalog.state().stale).toBe(true)
})

test('notifications during a refresh discard the candidate and coalesce into one fresh read', async () => {
  let calls = 0, commits = 0, resolve!: (value: unknown) => void
  const catalog = new LiveToolCatalog({ page: async () => {
    if (++calls === 1) return new Promise(yes => { resolve = yes })
    return { tools: [tool('latest')] }
  }, committed: () => { commits++ } })
  const pending = catalog.refresh()
  for (let i = 0; i < 20; i++) expect(catalog.refresh({ invalidated: true })).toBe(pending)
  resolve({ tools: [tool('obsolete')] })
  expect((await pending).tools.map(tool => tool.name)).toEqual(['latest'])
  expect(calls).toBe(2)
  expect(commits).toBe(1)
})
