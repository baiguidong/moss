import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

test('persists session runtime settings and migrates existing databases in Node', async () => {
  const outdir = await mkdtemp(join(tmpdir(), 'moss-server-db-test-'))
  try {
    const entrypoint = join(
      dirname(fileURLToPath(import.meta.url)),
      'dbPersistence.node.ts',
    )
    const build = await Bun.build({
      entrypoints: [entrypoint],
      outdir,
      target: 'node',
      format: 'esm',
    })
    expect(build.success).toBe(true)
    const output = build.outputs[0]
    if (!output) throw new Error('Node database persistence test did not build')
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
}, 15_000)
