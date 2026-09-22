import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('Server Agent Channel Host', () => {
  it('keeps Channel behavior generic and isolates App-owned sessions', async () => {
    const outdir = await mkdtemp(join(tmpdir(), 'moss-server-agent-channel-build-'))
    try {
      const entrypoint = join(
        dirname(fileURLToPath(import.meta.url)),
        'serverAgentChannelHost.node.ts',
      )
      const build = Bun.spawn([
        'bun',
        'build',
        entrypoint,
        '--target=node',
        '--format=esm',
        `--outdir=${outdir}`,
      ], { stdout: 'pipe', stderr: 'pipe' })
      const [buildExitCode, buildStderr] = await Promise.all([
        build.exited,
        new Response(build.stderr).text(),
      ])
      expect(buildExitCode, buildStderr).toBe(0)

      const output = join(outdir, 'serverAgentChannelHost.node.js')
      const process = Bun.spawn(['node', '--no-warnings', output], {
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
})
