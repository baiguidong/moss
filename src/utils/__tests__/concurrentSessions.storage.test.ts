import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Must be set before sessionStorage's persistence guard runs.
process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'

// The vendored color-diff-napi stub has no named exports, which breaks the
// transitive import chain from sessionStorage under bun test. Mock it before
// dynamically importing the module under test.
mock.module('color-diff-napi', () => ({
  ColorDiff: {},
  ColorFile: {},
  getSyntaxTheme: () => ({}),
}))

import { runWithSessionIdContext } from '../sessionIdContext.js'
import { asSessionId } from '../../types/ids.js'
import type { Message } from '../../types/message.js'

const {
  flushSessionStorage,
  recordTranscript,
  removeTranscriptMessage,
  resetProjectForTesting,
} = await import('../sessionStorage.js')

// Minimal user message (avoids importing utils/messages.ts and its heavy
// dependency chain).
function userMessage(content: string, uuid: string = randomUUID()): Message {
  return {
    type: 'user',
    message: { role: 'user', content },
    uuid,
    timestamp: new Date().toISOString(),
  } as unknown as Message
}

const baseDir = join(tmpdir(), `cc-concurrent-sessions-${Date.now()}`)
const projectDirA = join(baseDir, 'project-a')
const projectDirB = join(baseDir, 'project-b')
const sessionA = asSessionId(randomUUID())
const sessionB = asSessionId(randomUUID())

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function readEntries(filePath: string): Array<Record<string, unknown>> {
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

beforeAll(() => {
  mkdirSync(projectDirA, { recursive: true })
  mkdirSync(projectDirB, { recursive: true })
  resetProjectForTesting()
})

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

describe('concurrent session storage isolation', () => {
  const fileA = join(projectDirA, `${sessionA}.jsonl`)
  const fileB = join(projectDirB, `${sessionB}.jsonl`)
  const uuidB1 = randomUUID()

  it('routes interleaved appends from two sessions to their own files', async () => {
    const runSessionA = runWithSessionIdContext(
      sessionA,
      projectDirA,
      async () => {
        await recordTranscript([userMessage('hello from session A')])
        await sleep(10)
        await recordTranscript([userMessage('second message in A')])
      },
    )
    const runSessionB = runWithSessionIdContext(
      sessionB,
      projectDirB,
      async () => {
        await sleep(5)
        await recordTranscript([userMessage('hello from session B', uuidB1)])
        await sleep(10)
        await recordTranscript([userMessage('second message in B')])
      },
    )

    await Promise.all([runSessionA, runSessionB])
    await flushSessionStorage()

    expect(existsSync(fileA)).toBe(true)
    expect(existsSync(fileB)).toBe(true)

    const entriesA = readEntries(fileA)
    const entriesB = readEntries(fileB)

    // Every entry is stamped with its own session's id — no interleaving.
    for (const entry of entriesA) {
      expect(entry.sessionId).toBe(sessionA)
    }
    for (const entry of entriesB) {
      expect(entry.sessionId).toBe(sessionB)
    }

    const contentA = JSON.stringify(entriesA)
    const contentB = JSON.stringify(entriesB)
    expect(contentA).toContain('hello from session A')
    expect(contentA).not.toContain('hello from session B')
    expect(contentB).toContain('hello from session B')
    expect(contentB).not.toContain('hello from session A')
  })

  it('removeTranscriptMessage in one session never touches the other file', async () => {
    const before = readFileSync(fileB, 'utf8')

    // Session A tries to remove a UUID that only exists in B's transcript.
    await runWithSessionIdContext(sessionA, projectDirA, async () => {
      await removeTranscriptMessage(uuidB1 as never)
    })
    await flushSessionStorage()

    expect(readFileSync(fileB, 'utf8')).toBe(before)
    expect(JSON.stringify(readEntries(fileB))).toContain('hello from session B')
  })
})
