import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getAppDiscovery, connectorIdFromApp } from '../../packages/app-sdk/src/discovery.mjs'
import { createAppDiscoveryPreferences, normalizeAppPreferences } from '../src/apps/app-discovery-preferences.mjs'
import { selectedConnectorIds } from '../src/apps/connector-app-selection.mjs'

describe('App discovery and compatibility', () => {
  test('classifies purpose independently of CLI/MCP transport and keeps unknown visible', () => {
    expect(getAppDiscovery({ id: 'moss.filesystem' }).group).toBe('local')
    expect(getAppDiscovery({ id: 'moss.database' }).group).toBe('local')
    for (const id of ['moss.backup', 'moss.data-workbench', 'moss.media-tools']) {
      expect(getAppDiscovery({ id }).group).toBe('local')
    }
    expect(getAppDiscovery({ id: 'moss.feishu' }).group).toBe('online')
    expect(getAppDiscovery({ id: 'external.cli', discovery: { group: 'online', authMethods: ['browser'] } })).toEqual({ group: 'online', authMethods: ['browser'] })
    expect(getAppDiscovery({ id: 'external.unknown' }).group).toBe('unknown')
    expect(connectorIdFromApp({ id: 'moss.feishu-cli', connectorApp: { id: 'feishu' } })).toBe('feishu')
    expect(connectorIdFromApp({ id: 'example.team-chat', connectorApp: { id: 'feishu' } })).toBe('feishu')
    expect(connectorIdFromApp({ id: 'moss.feishu' })).toBeNull()
    expect(connectorIdFromApp('moss.feishu-cli')).toBeNull()
    expect(connectorIdFromApp({ connectorApp: { id: '../escape' } })).toBeNull()
  })
  test('section preferences survive restart, serialize edits, and discard legacy common data', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-prefs-'))
    try {
      const prefs = createAppDiscoveryPreferences({ rootDir: dir })
      await Promise.all([
        prefs.update('owner-a', { action: 'section', surface: 'installed', section: 'app' }),
        prefs.update('owner-a', { action: 'section', surface: 'marketplace', section: 'app' }),
        prefs.update('owner-a', { action: 'section', surface: 'installed', section: 'tool' }),
      ])
      await prefs.update('owner-b', { action: 'section', surface: 'installed', section: 'tool' })
      const restarted = createAppDiscoveryPreferences({ rootDir: dir })
      expect(await restarted.read('owner-a')).toEqual({ sections: { installed: 'tool', marketplace: 'app' } })
      expect(await restarted.read('owner-b')).toEqual({ sections: { installed: 'tool', marketplace: 'app' } })
      expect(await restarted.read('new-owner')).toEqual({ sections: { installed: 'app', marketplace: 'app' } })
      const legacyFile = path.join(dir, `${createHash('sha256').update('legacy-owner').digest('hex')}.json`)
      await fs.writeFile(legacyFile, JSON.stringify({ pinnedAppIds: ['a.app'], recentAppUsage: { 'a.app': 123 }, sections: { installed: 'common', marketplace: 'online' } }))
      const migrated = { sections: { installed: 'app', marketplace: 'app' } }
      expect(await restarted.read('legacy-owner')).toEqual(migrated)
      expect(JSON.parse(await fs.readFile(legacyFile, 'utf8'))).toEqual({ schemaVersion: 4, ...migrated })
      const formerDefaultFile = path.join(dir, `${createHash('sha256').update('former-default').digest('hex')}.json`)
      await fs.writeFile(formerDefaultFile, JSON.stringify({ sections: { installed: 'online', marketplace: 'local' } }))
      expect(await restarted.read('former-default')).toEqual({ sections: { installed: 'app', marketplace: 'app' } })
      expect(JSON.parse(await fs.readFile(formerDefaultFile, 'utf8')).schemaVersion).toBe(4)
      expect(await restarted.update('former-default', { action: 'section', surface: 'marketplace', section: 'tool' })).toEqual({ sections: { installed: 'app', marketplace: 'tool' } })
      expect(await restarted.read('former-default')).toEqual({ sections: { installed: 'app', marketplace: 'tool' } })
      expect(normalizeAppPreferences({ sections: { installed: 'common' } }).sections.installed).toBe('app')
      expect(normalizeAppPreferences({ sections: { installed: 'all', marketplace: 'all' } })).toEqual({ sections: { installed: 'app', marketplace: 'app' } })
      await expect(prefs.update('owner-a', { action: 'section', surface: 'installed', section: 'all' })).rejects.toThrow()
      await expect(prefs.update('owner-a', { action: 'section', surface: 'marketplace', section: 'common' })).rejects.toThrow()
      await expect(prefs.update('owner-a', { action: 'section', surface: 'installed', section: 'online' })).rejects.toThrow()
      await expect(prefs.update('owner-a', { action: 'pin', appId: 'a.app' })).rejects.toThrow()
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  })
  test('explicit App selections map to connector capabilities', () => {
    const apps = [
      { id: 'moss.git' }, { id: 'moss.feishu' },
      { id: 'moss.feishu-cli', connectorApp: { id: 'feishu' } },
      { id: 'example.team-chat', connectorApp: { id: 'feishu' } },
    ]
    expect(selectedConnectorIds(['moss.git', 'moss.feishu', 'moss.feishu-cli', 'moss.feishu-cli', 'example.team-chat'], apps)).toEqual(['feishu'])
    expect(selectedConnectorIds(['moss.feishu-cli'], [])).toEqual([])
  })
})
