import { expect, test } from 'bun:test'
import { mkdtemp, rm, readFile, writeFile, stat, symlink, link, readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { persistBoundedOutput } from './boundedToolOutput'
import { persistToolResult, buildLargeToolResultMessage, generatePreview, getToolResultPath, processPreMappedToolResultBlock, persistLargeHookOutput } from './toolResultStorage'
import { getLargeOutputInstructions } from './mcpOutputStorage'
import { runWithSessionIdContext } from './sessionIdContext'
import { asSessionId } from '../types/ids'

async function isolated(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'moss-output-boundary-'))
  try { await runWithSessionIdContext(asSessionId('fixture-session'), root, () => run(root)) }
  finally { await rm(root, { recursive: true, force: true }) }
}
test('bounded UTF-8 previews and storage preserve characters and disclose truncation', () => isolated(async root => {
  const text = '中文😀'.repeat(8)
  const file = join(root, 'out.txt')
  const saved = await persistBoundedOutput(file, { text }, { maxBytes: 9 })
  expect(await readFile(file, 'utf8')).toBe('中文')
  expect(saved).toMatchObject({ storedBytes: 6, originalBytes: Buffer.byteLength(text), truncated: true })
  expect(generatePreview(text, 9)).toEqual({ preview: '中文', hasMore: true })
}))
test('bounded file snapshots leave source logs unchanged and remain independent of later writes', () => isolated(async root => {
  const source = join(root, 'raw.log'), target = join(root, 'snapshot.txt')
  await writeFile(source, 'abcdefghijklmnop')
  const saved = await persistBoundedOutput(target, { file: source }, { maxBytes: 8 })
  expect(saved).toMatchObject({ storedBytes: 8, originalBytes: 16, truncated: true })
  expect(await readFile(source, 'utf8')).toBe('abcdefghijklmnop')
  expect((await stat(target)).ino).not.toBe((await stat(source)).ino)
  await writeFile(source, 'new raw log')
  expect(await readFile(target, 'utf8')).toBe('abcdefgh')
}))
test('replays are content-checked, concurrent writers share a complete result, and links are rejected', () => isolated(async root => {
  const target = join(root, 'result.txt')
  const saved = await Promise.all(Array.from({ length: 4 }, () => persistBoundedOutput(target, { text: 'original' })))
  expect(saved.every(item => item.storedBytes === 8)).toBe(true)
  await expect(persistBoundedOutput(target, { text: 'replaced' })).rejects.toThrow('different content')
  expect(await readFile(target, 'utf8')).toBe('original')
  const alias = join(root, 'alias.txt'); await symlink(target, alias)
  await expect(persistBoundedOutput(alias, { text: 'original' })).rejects.toThrow()
  const hard = join(root, 'hard.txt'); await link(target, hard)
  await expect(persistBoundedOutput(hard, { text: 'original' })).rejects.toThrow('matching snapshot')
  expect((await readdir(root)).some(name => name.endsWith('.tmp'))).toBe(false)
}))
test('cancellation and non-regular sources do not publish a result', () => isolated(async root => {
  const signal = AbortSignal.abort(new Error('stopped')), target = join(root, 'result.txt')
  await expect(persistBoundedOutput(target, { text: 'data' }, { signal })).rejects.toThrow('stopped')
  await expect(persistBoundedOutput(target, { file: root })).rejects.toThrow('regular file')
  expect(await readdir(root)).toEqual([])
}))
test('truncated JSON uses a text file and every result instruction describes only the saved portion', () => isolated(async () => {
  const result = await persistToolResult([{ type: 'text', text: 'content '.repeat(40) }], 'json-result', { maxBytes: 31 })
  if ('error' in result) throw new Error(result.error)
  expect(result.isJson).toBe(false); expect(result.filepath.endsWith('.txt')).toBe(true)
  expect(result.storageComplete).toBe(false)
  expect((await stat(result.filepath)).size).toBe(31)
  expect(buildLargeToolResultMessage(result)).toContain('partial snapshot')
  expect(buildLargeToolResultMessage(result)).not.toContain('Full output saved')
  const instructions = getLargeOutputInstructions(result.filepath, result.originalSize, 'JSON', undefined, result)
  expect(instructions).toContain('may not be valid JSON')
  expect(instructions).not.toContain('100%')
}))
test('complete output stays readable, traversal IDs are contained, and disk failure returns a bounded preview', () => isolated(async root => {
  const result = await persistToolResult('complete', '../../outside')
  if ('error' in result) throw new Error(result.error)
  expect(result.filepath.startsWith(join(root, 'fixture-session', 'tool-results'))).toBe(true)
  expect(buildLargeToolResultMessage(result)).toContain('Full output saved')
  const blocked = getToolResultPath('blocked', false); await mkdir(blocked)
  const content = 'x'.repeat(60_000)
  const output = await processPreMappedToolResultBlock({ type: 'tool_result', tool_use_id: 'blocked', content }, 'fixture', 100)
  expect(String(output.content)).toContain('could not be saved')
  expect(String(output.content).length).toBeLessThan(3000)
  expect(String(output.content)).not.toContain('Full output saved')
}))

test('oversized hook output is persisted with a bounded model preview', () => isolated(async root => {
  const content = 'hook output '.repeat(2_000)
  const modelContent = await persistLargeHookOutput(content, 'UserPromptSubmit', 'hook-use')
  expect(modelContent).toContain('<persisted-output>')
  expect(modelContent).toContain('Full output saved to:')
  expect(modelContent).toContain('Preview (first 2000 characters):')
  expect(modelContent).not.toContain(content)
  const files = await readdir(join(root, 'fixture-session', 'tool-results'))
  expect(files.some(file => file.startsWith('hook-UserPromptSubmit-hook-use'))).toBe(true)
}))

test('Bash and PowerShell adapters retain snapshot completeness in model-facing results', async () => {
  const { BashTool } = await import('../tools/BashTool/BashTool')
  const { PowerShellTool } = await import('../tools/PowerShellTool/PowerShellTool')
  for (const tool of [BashTool, PowerShellTool]) {
    const input: any = { stdout: 'preview', stderr: '', interrupted: false, persistedOutputPath: '/fixture/snapshot.txt', persistedOutputSize: 100, persistedOutputStoredBytes: 10, persistedOutputTruncated: true }
    const partial = tool.mapToolResultToToolResultBlockParam(input, 'fixture')
    expect(String(partial.content)).toContain('partial snapshot')
    expect(String(partial.content)).not.toContain('Full output saved')
    input.persistedOutputStoredBytes = 100; input.persistedOutputTruncated = false
    expect(String(tool.mapToolResultToToolResultBlockParam(input, 'fixture').content)).toContain('Full output saved')
  }
})
