import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('explicit desktop transcript resumes without a source UUID or default-project lookup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moss-file-resume-'))
  const sessionId = randomUUID()
  const userId = randomUUID()
  const engineDir = join(root, 'desktop-session', 'engine')
  const transcript = join(engineDir, `${sessionId}.jsonl`)
  try {
    await mkdir(engineDir, { recursive: true })
    await writeFile(transcript, [
      { type: 'user', uuid: userId, parentUuid: null, sessionId, isSidechain: false,
        cwd: root, timestamp: '2026-09-28T00:00:00Z', message: { role: 'user', content: 'Desktop history' } },
      { type: 'assistant', uuid: randomUUID(), parentUuid: userId, sessionId, isSidechain: false,
        cwd: root, timestamp: '2026-09-28T00:00:01Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Saved reply' }] } },
      { type: 'custom-title', sessionId, customTitle: 'Desktop session' },
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n')
    // A separate process keeps config caches, hooks and module mocks isolated.
    const child = Bun.spawn([process.execPath, '-e', `
      import { mock } from 'bun:test';
      mock.module('color-diff-napi', () => ({ ColorDiff: {}, ColorFile: {}, getSyntaxTheme: () => ({}) }));
      const { enableConfigs } = await import('./src/utils/config.ts');
      enableConfigs();
      const { loadConversationForResume } = await import('./src/utils/conversationRecovery.ts');
      const result = await loadConversationForResume(undefined, process.env.TEST_TRANSCRIPT_PATH);
      console.log(JSON.stringify({ sessionId: result?.sessionId, fullPath: result?.fullPath,
        customTitle: result?.customTitle, messages: result?.messages.map(m => m.message?.content) }));
    `], {
      cwd: new URL('../../..', import.meta.url).pathname,
      env: { PATH: process.env.PATH, HOME: root, MOSS_CONFIG_DIR: root, MOSS_HOME: root,
        TEST_TRANSCRIPT_PATH: transcript, DISABLE_TELEMETRY: '1' },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
    const result = JSON.parse(stdout.trim().split('\n').at(-1)!)
    expect(result.sessionId).toBe(sessionId)
    expect(result.fullPath).toBe(transcript)
    expect(result.customTitle).toBe('Desktop session')
    expect(JSON.stringify(result.messages)).toContain('Saved reply')
  } finally { await rm(root, { recursive: true, force: true }) }
}, 15000)
