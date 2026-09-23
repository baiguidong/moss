import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildNodeFixture } from './buildNodeFixture.js'

test('database and business concurrency contracts in Node', async () => {
  const outdir = await mkdtemp(join(tmpdir(), 'moss-model-build-'))
  try {
    const build = await buildNodeFixture({
      entrypoints: [new URL('./model.node.ts', import.meta.url).pathname],
      outdir,
      target: 'node',
      format: 'esm',
    })
    const child = Bun.spawn(['node', '--no-warnings', build.outputs[0]!.path], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, MOSS_HIDE_BOOTSTRAP_SECRETS: '1' },
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (code) throw new Error(`${stdout}\n${stderr}`)
    expect(code).toBe(0)
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}, 60000)
