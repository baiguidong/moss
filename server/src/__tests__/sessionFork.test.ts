import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { cloneSessionTranscript } from '../transcript.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('cloneSessionTranscript', () => {
  it('creates an independent main-thread transcript', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moss-session-fork-'))
    roots.push(root)
    const source = join(root, 'source.jsonl')
    const target = join(root, 'target.jsonl')
    await writeFile(source, [
      { type: 'user', uuid: 'u1', sessionId: 'source', slug: 'shared-plan', isSidechain: false, message: { content: 'hello' } },
      { type: 'assistant', uuid: 'a1', sessionId: 'source', isSidechain: false, message: { content: [] } },
      { type: 'assistant', uuid: 'worker', sessionId: 'source', isSidechain: true, message: { content: [] } },
      { type: 'worktree-state', sessionId: 'source', worktreeSession: { sessionId: 'source' } },
    ].map(entry => JSON.stringify(entry)).join('\n'))

    expect(await cloneSessionTranscript(source, target, 'source', 'target', 'Fork')).toBe(2)
    const entries = (await readFile(target, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(entries.map(entry => entry.type)).toEqual(['user', 'assistant', 'custom-title'])
    expect(entries.every(entry => entry.sessionId === 'target')).toBe(true)
    expect(entries[0].forkedFrom).toEqual({ sessionId: 'source', messageUuid: 'u1' })
    expect(entries[0].slug).toBeUndefined()
  })
})
