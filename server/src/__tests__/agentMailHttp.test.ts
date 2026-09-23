import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildNodeFixture } from './buildNodeFixture.js'

test('Agent Mail HTTP authentication and delivery flow in Node', async () => {
  const outdir = await mkdtemp(join(tmpdir(), 'moss-agent-mail-http-test-'))
  try {
    const entrypoint = join(
      dirname(fileURLToPath(import.meta.url)),
      'agentMailHttp.node.ts',
    )
    const build = await buildNodeFixture({
      entrypoints: [entrypoint],
      outdir,
      target: 'node',
      format: 'esm',
    })
    expect(build.success).toBe(true)
    const output = build.outputs[0]
    if (!output) throw new Error('Node Agent Mail HTTP test did not build')
    const process = Bun.spawn(['node', '--no-warnings', output.path], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stderr] = await Promise.all([
      process.exited,
      new Response(process.stderr).text(),
    ])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}, 20_000)
