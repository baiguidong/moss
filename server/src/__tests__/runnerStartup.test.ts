import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildNodeFixture } from './buildNodeFixture.js'

test('runner startup tolerates cold starts and cleans up failed creations', async () => {
  const root = await mkdtemp('/tmp/ms-run-')
  try {
    const build = await buildNodeFixture({
      entrypoints: [join(dirname(fileURLToPath(import.meta.url)), 'runnerStartup.node.ts')],
      outdir: root, target: 'node', format: 'esm',
    })
    const child = Bun.spawn(['node', '--no-warnings', build.outputs[0]!.path], {
      env: { ...process.env, MOSS_SERVER_ASSET_ROOT: root }, stdout: 'pipe', stderr: 'pipe',
    })
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    if (code) console.error(stderr)
    expect(code).toBe(0)
    expect(stderr).toBe('')
  } finally { await rm(root, { recursive: true, force: true }) }
}, 20000)
