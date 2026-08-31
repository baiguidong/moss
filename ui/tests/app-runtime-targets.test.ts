import { describe, expect, it } from 'bun:test'
import {
  appCanDeployToServer,
  appCanCreateServerInstance,
  appCanMoveInstance,
  availableInstanceTargets,
  backendForTarget,
} from '../src/renderer-react/lib/app-runtime-targets'
import type { StoredApp } from '../src/renderer-react/types'

function appWithTargets(targets: Array<'desktop' | 'server'>, patch: Partial<StoredApp> = {}): StoredApp {
  return {
    name: 'target-test',
    title: 'Target test',
    description: '',
    icon: '',
    width: 800,
    height: 600,
    resizable: true,
    createdAt: 1,
    updatedAt: 1,
    currentVersion: '1.0.0',
    backend: {
      lifecycle: 'persistent',
      instanceMode: 'multiple',
      targets,
      actions: [],
    },
    ...patch,
  }
}

describe('App Runtime deployment targets', () => {
  it('keeps a Desktop-only App local and hides Server deployment', () => {
    const app = appWithTargets(['desktop'], { serverConfigured: true, serverAvailable: true })
    expect(backendForTarget(app, 'desktop')).not.toBeNull()
    expect(backendForTarget(app, 'server')).toBeNull()
    expect(appCanDeployToServer(app)).toBe(false)
    expect(availableInstanceTargets(app)).toEqual(['desktop'])
  })

  it('does not expose a Desktop Backend for a Server-only App', () => {
    const app = appWithTargets(['server'], {
      serverConfigured: true,
      serverAvailable: true,
      serverPackageAvailable: true,
    })
    expect(backendForTarget(app, 'desktop')).toBeNull()
    expect(backendForTarget(app, 'server')).not.toBeNull()
    expect(appCanDeployToServer(app)).toBe(true)
    expect(appCanCreateServerInstance(app)).toBe(true)
    expect(availableInstanceTargets(app)).toEqual(['server'])
  })

  it('keeps a dual-target App usable on Desktop while Server is unavailable', () => {
    const app = appWithTargets(['desktop', 'server'], { serverConfigured: true, serverAvailable: false })
    expect(appCanDeployToServer(app)).toBe(true)
    expect(availableInstanceTargets(app)).toEqual(['desktop'])
  })

  it('offers deployment again when Desktop has a newer Server-capable version', () => {
    const app = appWithTargets(['desktop', 'server'], {
      remoteInstalled: true,
      serverVersion: '0.9.0',
      serverAvailable: true,
    })
    expect(appCanDeployToServer(app)).toBe(true)
    expect(appCanDeployToServer({ ...app, serverVersion: '1.0.0' })).toBe(false)
  })

  it('requires a deployable package before creating or moving a Server instance', () => {
    const unavailable = appWithTargets(['desktop', 'server'], {
      serverConfigured: true,
      serverAvailable: true,
      serverPackageAvailable: false,
    })
    expect(appCanCreateServerInstance(unavailable)).toBe(false)
    expect(appCanMoveInstance(unavailable, 'desktop')).toBe(false)

    const available = { ...unavailable, serverPackageAvailable: true }
    expect(appCanCreateServerInstance(available)).toBe(true)
    expect(appCanMoveInstance(available, 'desktop')).toBe(true)
  })

  it('requires matching installed versions before moving an instance between Hosts', () => {
    const mismatched = appWithTargets(['desktop', 'server'], {
      remoteInstalled: true,
      serverAvailable: true,
      serverVersion: '0.9.0',
      serverBackend: appWithTargets(['desktop', 'server']).backend,
    })
    expect(appCanMoveInstance(mismatched, 'desktop')).toBe(false)
    expect(appCanMoveInstance(mismatched, 'server')).toBe(false)
    expect(appCanCreateServerInstance(mismatched)).toBe(true)

    const matched = { ...mismatched, serverVersion: '1.0.0' }
    expect(appCanMoveInstance(matched, 'desktop')).toBe(true)
    expect(appCanMoveInstance(matched, 'server')).toBe(true)
  })
})
