import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

test('cloud storage HTTP, recovery and Host transfers in Node', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moss-cloud-test-build-'))
  try {
    const output = join(dir, 'suite.mjs')
    const build = Bun.spawn(['bun', 'build', new URL('./cloudStorage.node.ts', import.meta.url).pathname, '--target=node', `--outfile=${output}`], { stdout: 'pipe', stderr: 'pipe' })
    const [buildCode, buildError] = await Promise.all([build.exited, new Response(build.stderr).text()])
    if (buildCode) throw new Error(buildError)
    const args = process.env.MOSS_CLOUD_ELECTRON_TEST === '1'
      ? [createRequire(new URL('../../../ui/package.json', import.meta.url))('electron'), new URL('../../../ui/tests/helpers/cloud-electron.cjs', import.meta.url).pathname, output]
      : ['node', '--no-warnings', output]
    const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    if (code) throw new Error(`${stdout}\n${stderr}`)
    process.stdout.write(stdout)
    expect(code).toBe(0)
  } finally { await rm(dir, { recursive: true, force: true }) }
}, process.env.MOSS_CLOUD_SILO_TEST === '1' ? 600000 : 60000)
