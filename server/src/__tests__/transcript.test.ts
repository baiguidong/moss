import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getSessionUsageSummaryFromTranscriptPath } from '../usage.js'
import { loadSessionContextFromTranscript } from '../transcript.js'
import type { SessionRecord } from '../types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function createTranscript(): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'moss-server-transcript-'))
  tempDirs.push(dir)
  const path = join(dir, 'session.jsonl')
  const entries = [
    { type: 'mode', mode: 'normal', sessionId: 'session-1' },
    { type: 'custom-title', customTitle: 'Remote chat', sessionId: 'session-1' },
    {
      type: 'user',
      uuid: 'user-1',
      parentUuid: null,
      sessionId: 'session-1',
      timestamp: '2026-08-19T00:00:00.000Z',
      message: { role: 'user', content: 'hello' },
    },
    {
      type: 'assistant',
      uuid: 'assistant-1',
      parentUuid: 'user-1',
      sessionId: 'session-1',
      timestamp: '2026-08-19T00:00:01.000Z',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'hi' }],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 5,
        },
      },
    },
  ]
  await writeFile(path, `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`)
  return { dir, path }
}

describe('standalone transcript helpers', () => {
  test('loads a conversation chain and metadata without application imports', async () => {
    const { dir, path } = await createTranscript()
    const session = {
      sessionId: 'session-1',
      transcriptSessionId: 'session-1',
      transcriptPath: path,
      cwd: dir,
    } as SessionRecord
    const context = await loadSessionContextFromTranscript(session)
    expect(context?.customTitle).toBe('Remote chat')
    expect(context?.mode).toBe('normal')
    expect(context?.messages.map(message => message.type)).toEqual(['user', 'assistant'])
    expect(context?.messages[0]).not.toHaveProperty('parentUuid')
    expect(context?.messages[0]).not.toHaveProperty('isSidechain')
    expect(context?.usage?.totalTokens).toBe(135)
  })

  test('summarizes transcript token usage', async () => {
    const { dir, path } = await createTranscript()
    const usage = await getSessionUsageSummaryFromTranscriptPath({
      transcriptSessionId: 'session-1',
      mainTranscriptPath: path,
      subagentsDir: join(dir, 'missing-subagents'),
    })
    expect(usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: 5,
      totalTokens: 135,
      assistantMessageCount: 1,
    })
  })
})
