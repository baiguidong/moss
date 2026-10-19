import { expect, test } from 'bun:test'
import { createConnectorAppHost } from '../src/apps/connector-app-host.mjs'

test('unchanged connector activation skips package validation at startup', async () => {
  let packageLoads = 0
  const installation = { appId: 'moss.example', activeVersion: '1.0.0', enabled: true }
  const runtime = {
    installations: { list: () => [installation] },
    getInstallation: (appId: string) => appId === installation.appId ? installation : null,
    getActivePackage: async () => { packageLoads += 1; throw new Error('unexpected package load') },
  }
  const seen: unknown[] = []
  const host = createConnectorAppHost({
    getRuntime: () => runtime,
    isCurrentActivation: (...args: unknown[]) => { seen.push(args); return true },
  })
  await host.refresh(installation.appId, { connectorApp: { id: 'example' } })
  expect(seen).toEqual([[installation.appId, installation.activeVersion, 'example']])
  expect(packageLoads).toBe(0)
})
