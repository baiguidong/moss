import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('App V2 registry hydration', () => {
  it('lists only installed V2 packages and hydrates their manifest and UI entry', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-registry-'))
    roots.push(home)
    const packageRoot = path.join(home, '.moss', 'apps', 'fixture.registry-v2', 'versions', '1.0.0')
    await fs.mkdir(path.join(packageRoot, 'dist', 'ui'), { recursive: true })
    await fs.writeFile(path.join(packageRoot, 'dist', 'ui', 'index.html'), '<!doctype html><title>Registry V2</title>')
    await fs.writeFile(path.join(packageRoot, 'app.moss.json'), `${JSON.stringify({
      schemaVersion: 2,
      id: 'fixture.registry-v2',
      version: '1.0.0',
      displayName: 'Registry V2',
      hostApi: '^1.0.0',
      ui: { entry: 'dist/ui/index.html' },
      permissions: [],
    }, null, 2)}\n`)
    await writePackageChecksums(packageRoot)
    await fs.writeFile(path.join(home, '.moss', 'apps', 'fixture.registry-v2', 'current.json'), '{"version":"1.0.0"}\n')
    await fs.writeFile(path.join(home, '.moss', 'app-registry.json'), `${JSON.stringify({
      version: 2,
      apps: [
        { id: 'fixture.registry-v2', name: 'fixture.registry-v2', kind: 'app', currentVersion: '1.0.0', createdAt: 1, updatedAt: 2 },
        { id: 'stale-legacy', name: 'stale-legacy', kind: 'legacy-html', currentVersion: null },
      ],
    })}\n`)

    const modulePath = path.resolve(import.meta.dir, '../src/app-platform.mjs')
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { listAppsFromRegistry } from ${JSON.stringify(modulePath)};
      const apps = listAppsFromRegistry();
      console.log(JSON.stringify(apps.map((app) => ({
        id: app.id,
        hasManifest: Boolean(app.manifest),
        hasUi: Boolean(app.manifest?.ui),
        filePath: app.filePath,
        currentVersion: app.currentVersion,
      }))));
    `], {
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout.trim())).toEqual([{
      id: 'fixture.registry-v2',
      hasManifest: true,
      hasUi: true,
      filePath: path.join(packageRoot, 'dist', 'ui', 'index.html'),
      currentVersion: '1.0.0',
    }])
  })
})
