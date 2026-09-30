import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildNodeFixture } from './buildNodeFixture.js'

test('trace routes preserve owner scopes, session permissions, history and live revisions under Node', async () => {
  const outdir = await mkdtemp(join(tmpdir(), 'moss-trace-routes-build-'))
  try {
    const build = await buildNodeFixture({
      entrypoints: [join(dirname(fileURLToPath(import.meta.url)), 'traceRoutes.node.ts')],
      outdir, target: 'node', format: 'esm',
    })
    const child = Bun.spawn(['node', '--no-warnings', build.outputs[0]!.path], { stdout: 'pipe', stderr: 'pipe' })
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}, 30_000)
