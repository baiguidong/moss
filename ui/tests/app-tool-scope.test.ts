import { expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { validateAppManifest } from '../../packages/app-sdk/src/index.mjs'
import { collectManifestContributions } from '../../packages/app-runtime/src/contributions/index.mjs'
import { AppRuntimeHost } from '../../packages/app-runtime/src/host/index.mjs'

test('creation examples validate, and tool-level properties cannot override the App', async () => {
  const text = await fs.readFile(new URL('../docs/app-authoring.md', import.meta.url), 'utf8')
  const raw = JSON.parse(text.match(/```json\n([\s\S]*?)\n```/)![1]!)
  for (const scope of ['session', 'global']) {
    raw.toolScope = scope
    raw.contributes.tools[0].toolScope = scope === 'global' ? 'session' : 'global'
    const manifest = validateAppManifest(raw)
    expect(collectManifestContributions(manifest).tools[0].toolScope).toBe(scope)
    expect(manifest.contributes.tools[0].toolScope).toBeUndefined()
  }
})

test('session filtering happens before schemas are loaded and manager catalog stays complete', async () => {
  const manifest = { id: 'private', version: '1.0.0', displayName: 'Private', contributes: {
    tools: [{ id: 'search', title: 'Search', inputSchema: 'missing.json' }],
  } }
  const host = Object.create(AppRuntimeHost.prototype)
  host.installations = { list: () => [{ appId: 'private', enabled: true, grants: [] }] }
  host.getActivePackage = async () => ({ manifest, root: '/missing-app-fixture' })
  expect((await host.listContributions({ kinds: ['tools'] })).tools).toHaveLength(1)
  expect((await host.listContributions({ kinds: ['tools'], selectedAppIds: [], loadSchemas: true })).tools).toEqual([])
  expect((await host.listContributions({ kinds: ['tools'], selectedAppIds: ['private'] })).tools).toHaveLength(1)
  await expect(host.listContributions({ kinds: ['tools'], selectedAppIds: ['private'], loadSchemas: true })).rejects.toThrow()
})
