import { afterAll, afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../../Tool.js'
import { runWithCwdOverride } from '../../utils/cwd.js'
import { ripGrep, RipgrepSearchError } from '../../utils/ripgrep.js'
import { GrepTool } from './GrepTool.js'
import { GlobTool } from '../GlobTool/GlobTool.js'

const roots: string[] = []
const previousSystemRg = process.env.USE_BUILTIN_RIPGREP
process.env.USE_BUILTIN_RIPGREP = 'false'
afterAll(() => {
  if (previousSystemRg === undefined) delete process.env.USE_BUILTIN_RIPGREP
  else process.env.USE_BUILTIN_RIPGREP = previousSystemRg
})
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
// This file uses the same real rg adapter as production, not an array fixture.
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'moss-search-'))
  roots.push(root)
  await writeFile(join(root, 'a.txt'), 'needle needle\nneedle\n')
  await writeFile(join(root, 'b.txt'), 'needle\n')
  await writeFile(join(root, 'long.txt'), `${'x'.repeat(2000)} needle\n`)
  return root
}
const context = () => ({ abortController: new AbortController(), getAppState: () => ({ toolPermissionContext: getEmptyToolPermissionContext() }) }) as ToolUseContext
async function grep(root: string, input: Record<string, unknown>) {
  return runWithCwdOverride(root, async () => {
    const { data } = await GrepTool.call(GrepTool.inputSchema.parse(input), context())
    return { data, text: GrepTool.mapToolResultToToolResultBlockParam(data, 'search').content as string }
  })
}

test('search failure and partial stdout never become a successful empty or partial list', async () => {
  const root = await fixture()
  await expect(ripGrep(['['], root, new AbortController().signal)).rejects.toBeInstanceOf(RipgrepSearchError)
  await expect(grep(root, { pattern: '[' })).rejects.toThrow('did not complete')
  await expect(ripGrep(['needle'], join(root, 'missing'), new AbortController().signal)).rejects.toThrow('did not complete')
  try {
    await ripGrep(['needle', join(root, 'a.txt')], join(root, 'missing'), new AbortController().signal)
    throw new Error('should reject')
  } catch (error) {
    expect(error).toBeInstanceOf(RipgrepSearchError)
    expect((error as RipgrepSearchError).partialResults.length).toBeGreaterThan(0)
  }
  expect(await ripGrep(['not-present'], root, new AbortController().signal)).toEqual([])
  const reason = new Error('cancel-search')
  await expect(ripGrep(['needle'], root, AbortSignal.abort(reason))).rejects.toBe(reason)
})

test('file pagination distinguishes shown, total, zero matches and a page beyond the end', async () => {
  const root = await fixture()
  expect((await grep(root, { pattern: 'needle', head_limit: 1 })).data)
    .toMatchObject({ numFiles: 1, totalFiles: 3, countIsComplete: true, truncated: true })
  const beyond = await grep(root, { pattern: 'needle', offset: 10 })
  expect(beyond.data).toMatchObject({ numFiles: 0, totalFiles: 3 })
  expect(beyond.text).toContain('No results on this page')
  expect(beyond.text).not.toContain('No files found')
  expect((await grep(root, { pattern: 'not-present' })).data).toMatchObject({ numFiles: 0, totalFiles: 0, truncated: false })
  expect(GrepTool.inputSchema.safeParse({ pattern: 'x', offset: -1 }).success).toBe(false)
})

test('count mode preserves full totals across pagination and names matching lines vs occurrences', async () => {
  const root = await fixture()
  const lines = await grep(root, { pattern: 'needle', output_mode: 'count', head_limit: 1 })
  expect(lines.data).toMatchObject({ numFiles: 1, totalFiles: 3, totalMatches: 4, countUnit: 'matching_lines' })
  expect(lines.text).toContain('Total: 4 matching lines across 3 files')
  const occurrences = await grep(root, { pattern: 'needle', output_mode: 'count', '-o': true })
  expect(occurrences.data).toMatchObject({ numMatches: 5, totalMatches: 5, countUnit: 'occurrences' })
  // rg omits the filename for a single target unless --with-filename is supplied.
  const single = await grep(root, { pattern: 'needle', path: join(root, 'a.txt'), output_mode: 'count' })
  expect(single.data).toMatchObject({ numFiles: 1, numMatches: 2, totalMatches: 2 })
  expect((await grep(root, { pattern: 'needle\\nneedle', path: join(root, 'a.txt'), output_mode: 'count', multiline: true })).data)
    .toMatchObject({ totalMatches: 1, countUnit: 'occurrences' })
})

test('only-matching retrieves text from long lines, and content totals survive an empty page', async () => {
  const root = await fixture()
  const input = { pattern: 'needle', path: join(root, 'long.txt'), output_mode: 'content' }
  const normal = await grep(root, input)
  expect(normal.data).toMatchObject({ contentTruncated: true, truncated: true })
  const short = await grep(root, { ...input, '-o': true, context: 3 })
  expect(short.data).toMatchObject({ totalLines: 1, numLines: 1, contentTruncated: false })
  expect(short.text).toContain('needle')
  expect(short.text).not.toContain('Omitted')
  const beyond = await grep(root, { ...input, '-o': true, offset: 2 })
  expect(beyond.text).toContain('No results on this page')
  expect(beyond.data).toMatchObject({ totalLines: 1 })
})

test('Glob reports the complete matching count before applying its display limit', async () => {
  const root = await fixture()
  const { data } = await runWithCwdOverride(root, () => GlobTool.call(
    { pattern: '*.txt' }, { ...context(), globLimits: { maxResults: 1 } },
  ))
  expect(data).toMatchObject({ numFiles: 1, totalMatches: 3, countIsComplete: true, truncated: true })
  expect(GlobTool.mapToolResultToToolResultBlockParam(data, 'glob').content).toContain('Showing 1 of 3')
})
