import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildNodeFixture } from './buildNodeFixture.js'

test('personal usage persists, backfills history, deduplicates requests and enforces access', async () => {
  const outdir = await mkdtemp(join(tmpdir(), 'moss-user-usage-test-'))
  try {
    const build = await buildNodeFixture({
      entrypoints: [new URL('./userUsage.node.ts', import.meta.url).pathname],
      outdir, target: 'node', format: 'esm',
    })
    const child = Bun.spawn(['node', '--no-warnings', build.outputs[0]!.path], {
      stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MOSS_HIDE_BOOTSTRAP_SECRETS: '1' },
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    if (code) throw new Error(`${stdout}\n${stderr}`)
    expect(code).toBe(0)
  } finally { await rm(outdir, { recursive: true, force: true }) }
}, 30_000)
