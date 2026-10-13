import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'
import { APP_HOST_API_VERSION } from '../../packages/app-sdk/src/index.mjs'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('App V2 registry hydration', () => {
  it('preserves local packages and source when switching to the marketplace and rolling back', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-local-market-'))
    roots.push(home)
    const appId = 'fixture.local-market'
    const localVersion = '1.2.0-local.20261012'
    const packages = [localVersion, '1.2.0', '1.3.0'].map(version => path.join(home, 'packages', version))
    for (const [index, packageRoot] of packages.entries()) {
      await fs.mkdir(path.join(packageRoot, 'src'), { recursive: true })
      await fs.writeFile(path.join(packageRoot, 'src', 'index.html'), `<p>source ${index}</p>`)
      await fs.writeFile(path.join(packageRoot, 'index.html'), `<p>built ${index}</p>`)
      await fs.writeFile(path.join(packageRoot, 'app.moss.json'), JSON.stringify({
        schemaVersion: 2, id: appId, version: [localVersion, '1.2.0', '1.3.0'][index],
        displayName: 'Local market fixture', hostApi: '^3.0.0', ui: { entry: 'index.html' }, permissions: [],
      }))
      await writePackageChecksums(packageRoot)
    }
    const modulePath = path.resolve(import.meta.dir, '../src/app-platform.mjs')
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import fs from 'node:fs/promises';
      import path from 'node:path';
      import { publishAppFromBuild, getAppRoot, getAppInstallationRevision, listAppVersions, listAppsFromRegistry, rollbackAppToVersion } from ${JSON.stringify(modulePath)};
      const [local, market, newer] = ${JSON.stringify(packages)};
      const appId = ${JSON.stringify(appId)}, localVersion = ${JSON.stringify(localVersion)};
      const localModification = { sourceHash: 'local-source' };
      await publishAppFromBuild(local, { localModification, sourceRoot: local });
      const root = getAppRoot(appId);
      const sourceArchive = path.join(root, 'sources', localVersion + '.tar.gz');
      const originalArchive = await fs.readFile(sourceArchive);
      const originalChecksums = await fs.readFile(path.join(root, 'versions', localVersion, 'checksums.json'));
      const marketplaceSource = { catalogUrl: 'https://example.com', appId, version: '1.2.0' };
      await publishAppFromBuild(market, { marketplaceSource,
        expectedInstallationRevision: getAppInstallationRevision(appId), expectedBaseVersion: localVersion });
      assert.equal(listAppsFromRegistry()[0].currentVersion, '1.2.0');
      assert.equal(listAppsFromRegistry()[0].localModification, null);
      assert.deepEqual(listAppsFromRegistry()[0].marketplaceSource, marketplaceSource);
      assert.equal(listAppVersions(appId).length, 2);
      assert.equal(await fs.readFile(path.join(root, 'versions', localVersion, 'src/index.html'), 'utf8'), '<p>source 0</p>');
      assert.deepEqual(await fs.readFile(sourceArchive), originalArchive);
      assert.deepEqual(await fs.readFile(path.join(root, 'versions', localVersion, 'checksums.json')), originalChecksums);
      await assert.rejects(publishAppFromBuild(newer, { expectedInstallationRevision: 0, expectedBaseVersion: localVersion }), { code: 'MOSS_APP_INSTALLATION_CHANGED' });
      assert.equal(listAppsFromRegistry()[0].currentVersion, '1.2.0');
      rollbackAppToVersion(appId, localVersion);
      assert.equal(listAppsFromRegistry()[0].currentVersion, localVersion);
      assert.deepEqual(listAppsFromRegistry()[0].localModification, localModification);
    `], { env: { ...process.env, MOSS_HOME: path.join(home, 'profile') }, encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

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
      category: 'knowledge',
      keywords: ['资料', '文档'],
      hostApi: '^3.4.0',
      navigation: { location: 'settings', viewId: 'configuration' },
      contributes: {
        views: [{ id: 'configuration', title: 'Configuration', route: '#/settings' }],
        settings: [{ id: 'preferences', title: 'Preferences', viewId: 'configuration', group: 'integrations' }],
      },
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
        category: app.category,
        keywords: app.keywords,
        navigation: app.manifest?.navigation,
        settingsGroup: app.manifest?.contributes?.settings?.[0]?.group,
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
      filePath: await fs.realpath(path.join(packageRoot, 'dist', 'ui', 'index.html')),
      currentVersion: '1.0.0',
      category: 'knowledge',
      keywords: ['资料', '文档'],
      navigation: { location: 'settings', viewId: 'configuration' },
      settingsGroup: 'integrations',
    }])
  })

  it('keeps an installed App visible when its Host API is incompatible', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-registry-incompatible-'))
    roots.push(home)
    const packageRoot = path.join(home, '.moss', 'apps', 'fixture.incompatible', 'versions', '1.3.0')
    await fs.mkdir(path.join(packageRoot, 'dist', 'ui'), { recursive: true })
    await fs.writeFile(path.join(packageRoot, 'dist', 'ui', 'index.html'), '<!doctype html><title>Incompatible</title>')
    await fs.writeFile(path.join(packageRoot, 'app.moss.json'), `${JSON.stringify({
      schemaVersion: 2,
      id: 'fixture.incompatible',
      version: '1.3.0',
      displayName: 'Incompatible App',
      hostApi: '^1.3.0',
      ui: { entry: 'dist/ui/index.html' },
      permissions: [],
    }, null, 2)}\n`)
    await writePackageChecksums(packageRoot)
    await fs.writeFile(path.join(home, '.moss', 'apps', 'fixture.incompatible', 'current.json'), '{"version":"1.3.0"}\n')
    await fs.writeFile(path.join(home, '.moss', 'app-registry.json'), `${JSON.stringify({
      version: 2,
      apps: [{
        id: 'fixture.incompatible',
        name: 'fixture.incompatible',
        kind: 'app',
        displayName: 'Incompatible App',
        title: 'Incompatible App',
        description: 'An installed App from an older Host API.',
        hasUi: true,
        hasBackend: false,
        currentVersion: '1.3.0',
        createdAt: 1,
        updatedAt: 2,
      }],
    })}\n`)

    const modulePath = path.resolve(import.meta.dir, '../src/app-platform.mjs')
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { listAppsFromRegistry } from ${JSON.stringify(modulePath)};
      const apps = listAppsFromRegistry();
      console.log(JSON.stringify(apps.map((app) => ({
        id: app.id,
        displayName: app.displayName,
        currentVersion: app.currentVersion,
        packageStatus: app.packageStatus,
        requiredHostApi: app.requiredHostApi,
        packageError: app.packageError,
      }))));
    `], {
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout.trim())).toEqual([{
      id: 'fixture.incompatible',
      displayName: 'Incompatible App',
      currentVersion: '1.3.0',
      packageStatus: 'incompatible',
      requiredHostApi: '^1.3.0',
      packageError: `App requires Host API ^1.3.0; this Host provides ${APP_HOST_API_VERSION}`,
    }])
  })
})
