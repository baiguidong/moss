import { test, expect } from 'bun:test'
import { AsyncResource } from 'node:async_hooks'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AppRuntimeHost, defaultInstanceId, normalizeAppOwner, writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'

test('long-lived Host authorization stays revoked across lifecycle changes and is owner-scoped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-host-currentness-'))
  const appId = 'fixture.currentness'
  const instanceId = defaultInstanceId(appId)
  const protocol = 'moss.fixture-currentness/v1'
  const source = path.join(root, 'source')
  const otherOwner = normalizeAppOwner({ scope: 'user', orgId: 'org', userId: 'alice' })
  const handles = []
  let failDeactivation = false
  let runtime
  try {
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'index.html'), '<!doctype html><title>Currentness</title>')
    await fs.writeFile(path.join(source, 'app.moss.json'), JSON.stringify({
      schemaVersion: 2, id: appId, displayName: 'Currentness', version: '1.0.0', hostApi: '^3.17.0',
      ui: { entry: 'index.html' }, host: { protocols: [protocol] }, permissions: [],
    }))
    await writePackageChecksums(source)
    runtime = await new AppRuntimeHost({ rootDir: path.join(root, 'host'),
      beforeAppDeactivation: () => { if (failDeactivation) throw new Error('deactivation failed') },
    }).initialize()
    runtime.registerHostProtocol({ protocol, methods: { issue: { surfaces: ['backend'] } } })
    runtime.registerHostHandler(protocol, 'issue', (_input, context) => {
      const id = handles.length
      handles.push({ owner: context.owner.key,
        assertCurrent: AsyncResource.bind(() => context.assertAppCurrent()),
        installationIncarnationId: context.installationIncarnationId,
        instanceIncarnationId: context.instanceIncarnationId })
      return { id }
    })
    await runtime.installFromDirectory(source)
    await runtime.withOwner(otherOwner, () => runtime.installFromDirectory(source))

    const issue = async (owner) => runtime.withOwner(owner, async () => {
      const record = runtime.runtimeForInstance(appId, instanceId)
      const result = await runtime.dispatchHostRequest({ appId, instanceId, key: record.key,
        generation: record.generation, version: '1.0.0', owner: runtime.currentOwner(),
        surface: 'backend', protocol, method: 'issue', input: {} })
      return handles[result.id]
    })
    const defaultOwner = runtime.defaultOwner
    const first = await issue(defaultOwner)
    const other = await issue(otherOwner)
    expect(first.owner).not.toBe(other.owner)
    expect(() => first.assertCurrent()).not.toThrow()
    expect(() => other.assertCurrent()).not.toThrow()

    await runtime.setAppEnabled(appId, true)
    expect(() => first.assertCurrent()).not.toThrow()
    const beforeDisable = runtime.runtimeForInstance(appId, instanceId).generation
    await runtime.setAppEnabled(appId, false)
    expect(runtime.runtimeForInstance(appId, instanceId).generation).toBe(beforeDisable + 1)
    expect(() => first.assertCurrent()).toThrow()
    expect(() => other.assertCurrent()).not.toThrow()
    await runtime.setAppEnabled(appId, false)
    expect(runtime.runtimeForInstance(appId, instanceId).generation).toBe(beforeDisable + 1)
    await runtime.setAppEnabled(appId, true)
    expect(() => first.assertCurrent()).toThrow()
    const second = await issue(defaultOwner)
    expect(() => second.assertCurrent()).not.toThrow()

    failDeactivation = true
    await expect(runtime.setAppEnabled(appId, false)).rejects.toThrow('deactivation failed')
    failDeactivation = false
    expect(runtime.getInstallation(appId).enabled).toBe(true)
    expect(() => second.assertCurrent()).toThrow()
    const third = await issue(defaultOwner)
    await runtime.setInstanceEnabled(appId, instanceId, false)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    expect(() => third.assertCurrent()).toThrow()
    expect(() => other.assertCurrent()).not.toThrow()

    const beforeUninstall = await issue(defaultOwner)
    await runtime.uninstall(appId)
    await runtime.installFromDirectory(source)
    expect(() => beforeUninstall.assertCurrent()).toThrow()
    const afterReinstall = await issue(defaultOwner)
    expect(afterReinstall.installationIncarnationId).not.toBe(beforeUninstall.installationIncarnationId)
    expect(afterReinstall.instanceIncarnationId).toBe(beforeUninstall.instanceIncarnationId)
    expect(() => afterReinstall.assertCurrent()).not.toThrow()
    expect(() => other.assertCurrent()).not.toThrow()
  } finally {
    await runtime?.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})
