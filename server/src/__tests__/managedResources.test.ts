import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { ManagedResourcesService } from '../managedResources.js'
import { buildNodeFixture } from './buildNodeFixture.js'

test('explicit grants persist and a required skill must be enabled and assigned', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moss-managed-resources-'))
  try {
    const store = new ManagedResourcesService(root)
    const skillZip = await new JSZip().file('sample/SKILL.md', '# Sample').generateAsync({ type: 'uint8array' })
    const expertZip = await new JSZip().file('assistant.md', 'Use the sample skill')
      .file('avatars/expert.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="7" fill="blue"/></svg>')
      .generateAsync({ type: 'uint8array' })
    const skill = await store.install({ orgId: 'org', kind: 'skill', slug: 'sample', packageBytes: skillZip })
    const expert = await store.install({ orgId: 'org', kind: 'expert', slug: 'helper', dependencies: [skill.id], packageBytes: expertZip })
    expect(store.listForUser('org', 'A')).toEqual([])
    await store.setAssignedIds('org', 'A', 'expert', [expert.id])
    expect(store.listForUser('org', 'A')).toEqual([])
    await store.setAssignedIds('org', 'A', 'skill', [skill.id])
    expect(store.listForUser('org', 'A').map(r => r.id)).toEqual([skill.id, expert.id])
    const reloaded = new ManagedResourcesService(root)
    await rm(join(root, 'managed-resources', 'packages', expert.packageFile + '.thumbnail'), { force: true })
    const manifest = await reloaded.manifest('org', 'A')
    expect(manifest.resources.find(item => item.id === expert.id)?.icon).toStartWith('data:image/webp;')
    expect(reloaded.getPackage(skill)).toEqual(skillZip)
    expect(reloaded.getAssignedIds('org', 'A', 'expert')).toEqual([expert.id])
    await reloaded.setEnabled('org', 'skill', skill.id, false)
    expect(reloaded.listForUser('org', 'A')).toEqual([])
    expect(reloaded.getForUser('org', 'A', 'expert', expert.id)).toBeNull()
    expect(reloaded.listForUser('org', 'B')).toEqual([])
    const updateZip = await new JSZip().file('./SKILL.md', '# Updated').generateAsync({ type: 'uint8array' })
    const updated = await reloaded.install({ orgId: 'org', kind: 'skill', slug: 'sample', packageBytes: updateZip })
    expect(updated.id).toBe(skill.id)
    expect(reloaded.getPackage(skill)).toBeNull()
    expect(reloaded.getPackage(updated)).toEqual(updateZip)
    expect(await reloaded.remove('org', 'skill', updated.id)).toBe(true)
    expect(reloaded.getPackage(updated)).toBeNull()
    expect(reloaded.getAssignedIds('org', 'A', 'skill')).toEqual([])
    await expect(reloaded.install({ orgId: 'org', kind: 'skill', slug: 'invalid', packageBytes: expertZip })).rejects.toThrow('SKILL.md')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('saved draft policies become explicit grants and never include later installs', async () => {
  const home = await mkdtemp(join(tmpdir(), 'moss-managed-migration-'))
  try {
    const store = new ManagedResourcesService(home)
    const bytes = await new JSZip().file('SKILL.md', 'Sample').generateAsync({ type: 'uint8array' })
    const original = await store.install({ orgId: 'org', kind: 'skill', slug: 'sample', packageBytes: bytes })
    const index = join(home, 'managed-resources', 'index.json')
    const { resources } = JSON.parse(await readFile(index, 'utf8'))
    const policies = {
      [JSON.stringify(['org', 'A', 'skill'])]: { mode: 'allow_list', resourceIds: [original.slug] },
      [JSON.stringify(['org', 'B', 'skill'])]: { mode: 'deny_list', resourceIds: [original.id] },
      [JSON.stringify(['org', 'C', 'skill'])]: { mode: 'inherit', resourceIds: [] },
    }
    await writeFile(index, JSON.stringify({ resources, policies }))
    const migrated = new ManagedResourcesService(home)
    await migrated.install({ orgId: 'org', kind: 'skill', slug: 'new', packageBytes: bytes })
    const reloaded = new ManagedResourcesService(home)
    expect(reloaded.getAssignedIds('org', 'A', 'skill')).toEqual([original.id])
    expect(reloaded.getAssignedIds('org', 'B', 'skill')).toEqual([])
    expect(reloaded.getAssignedIds('org', 'C', 'skill')).toEqual([original.id])
    expect(reloaded.getAssignedIds('org', 'D', 'skill')).toEqual([])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('existing experts default to installed and revocations survive later installs and restarts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moss-expert-defaults-'))
  try {
    const store = new ManagedResourcesService(root)
    const bytes = await new JSZip().file('assistant.md', '# Expert').generateAsync({ type: 'uint8array' })
    const input = { orgId: 'org', kind: 'expert', packageBytes: bytes } as const
    const expert = await store.install({ ...input, slug: 'writer' })
    await store.setAssignedIds('org', 'revoked', 'expert', [])
    const index = join(root, 'managed-resources', 'index.json')
    const legacy = JSON.parse(await readFile(index, 'utf8'))
    legacy.resources[0].category = '06-ContentCreative'
    await writeFile(index, JSON.stringify(legacy))
    const migrated = new ManagedResourcesService(root)
    expect(migrated.listForUser('org', 'new-user')[0]?.category).toBe('内容创作')
    expect(migrated.getForUser('org', 'revoked', 'expert', expert.id)).toBeNull()
    await migrated.install({ ...input, slug: 'writer' })
    const next = await migrated.install({ ...input, slug: 'editor' })
    await migrated.install({ ...input, orgId: 'other', slug: 'unrelated' })
    const reloaded = new ManagedResourcesService(root)
    expect(reloaded.getAssignedIds('org', 'revoked', 'expert')).toEqual([next.id])
    expect(reloaded.getAssignedIds('org', 'new-user', 'expert')).toEqual([expert.id, next.id])
    reloaded.updateAssignments('org', ['new-user'], 'expert', [], [expert.id])
    expect(reloaded.assignmentCounts('org', ['revoked', 'new-user'], 'expert')).toEqual({ [next.id]: 2 })
    await reloaded.setEnabled('org', 'expert', next.id, false)
    expect(reloaded.listForUser('org', 'new-user')).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('the server and desktop enforce grants, downloads and revocation over HTTP', async () => {
  const outdir = await mkdtemp(join(tmpdir(), 'moss-managed-http-build-'))
  try {
    const build = await buildNodeFixture({
      entrypoints: [new URL('./managedResourcesHttp.node.ts', import.meta.url).pathname],
      outdir, target: 'node', format: 'esm',
    })
    const child = Bun.spawn(['node', '--no-warnings', build.outputs[0]!.path], {
      stdout: 'pipe', stderr: 'pipe', env: { ...process.env, MOSS_HIDE_BOOTSTRAP_SECRETS: '1' },
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    if (code) throw new Error(`${stdout}\n${stderr}`)
    expect(code).toBe(0)
  } finally {
    await rm(outdir, { recursive: true, force: true })
  }
}, 30_000)
