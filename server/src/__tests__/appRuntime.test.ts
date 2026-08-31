import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('Server App Runtime', () => {
  it('acquires a known package and restores one persistent deployment after restart', async () => {
    const outdir = await mkdtemp(join(tmpdir(), 'moss-server-app-build-'))
    try {
      const entrypoint = join(dirname(fileURLToPath(import.meta.url)), 'appRuntime.node.ts')
      const build = Bun.spawn(['bun', 'build', entrypoint, '--target=node', '--format=esm', `--outdir=${outdir}`], { stdout: 'pipe', stderr: 'pipe' })
      const [buildExitCode, buildStderr] = await Promise.all([build.exited, new Response(build.stderr).text()])
      expect(buildExitCode, buildStderr).toBe(0)
      const output = join(outdir, 'appRuntime.node.js')
      const process = Bun.spawn(['node', '--no-warnings', output], { stdout: 'pipe', stderr: 'pipe' })
      const [exitCode, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()])
      expect(exitCode, stderr).toBe(0)
    } finally {
      await rm(outdir, { recursive: true, force: true })
    }
  }, 15_000)
})
