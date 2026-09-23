import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

test('an existing bootstrap username does not block startup', async () => {
  const outdir = await mkdtemp(join(tmpdir(), 'moss-auth-bootstrap-test-'))
  try {
    const entrypoint = join(
      dirname(fileURLToPath(import.meta.url)),
      'authBootstrap.node.ts',
    )
    const outputPath = join(outdir, 'auth-bootstrap.mjs')
    // A separate compiler process avoids Bun test-loader resolution caching.
    const build = Bun.spawn(
      [
        'bun',
        'build',
        entrypoint,
        '--target=node',
        '--format=esm',
        `--outfile=${outputPath}`,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const [buildCode, buildError] = await Promise.all([
      build.exited,
      new Response(build.stderr).text(),
    ])
    if (buildCode) throw new Error(buildError)
    const process = Bun.spawn(['node', '--no-warnings', outputPath], {
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
