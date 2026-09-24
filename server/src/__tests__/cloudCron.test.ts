import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildNodeFixture } from './buildNodeFixture.js'

test('cloud cron persists and runs independently with per-user isolation', async () => {
  const outdir = await mkdtemp(join(tmpdir(), 'moss-cloud-cron-test-'))
  try {
    const build = await buildNodeFixture({ entrypoints:[join(dirname(fileURLToPath(import.meta.url)),'cloudCron.node.ts')],outdir,target:'node',format:'esm' })
    const child = Bun.spawn(['node','--no-warnings',build.outputs[0]!.path],{stdout:'pipe',stderr:'pipe'})
    const [code,stderr,stdout] = await Promise.all([child.exited,new Response(child.stderr).text(),new Response(child.stdout).text()])
    if(code) console.error(stderr,stdout)
    expect(code).toBe(0)
    expect(stderr).toBe('')
  } finally { await rm(outdir,{recursive:true,force:true}) }
},30000)
