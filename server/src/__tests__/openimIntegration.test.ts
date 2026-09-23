import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildNodeFixture } from './buildNodeFixture.js'

test('keeps OpenIM administration in moss-server', async () => {
  const outdir = await mkdtemp(join(tmpdir(), 'moss-openim-integration-test-'))
  try {
    const entrypoint = join(
      dirname(fileURLToPath(import.meta.url)),
      'openimIntegration.node.ts',
    )
    const build = await buildNodeFixture({
      entrypoints: [entrypoint],
      outdir,
      target: 'node',
      format: 'esm',
    })
    expect(build.success).toBe(true)
    const output = build.outputs[0]
    if (!output) throw new Error('OpenIM integration test did not build')
    const process = Bun.spawn(['node', '--no-warnings', output.path], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stderr] = await Promise.all([
      process.exited,
      new Response(process.stderr).text(),
    ])
    expect(exitCode, stderr).toBe(0)
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}, 15_000)
