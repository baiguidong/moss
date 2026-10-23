import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { contractDefinition, validateContract } from '../src/host/contracts.mjs'
import { createMcpClient, validateMcpHostInput } from '../src/mcp/index.mjs'
import { validateAppManifest } from '../src/schemas/index.mjs'
import { AppHostCapabilityRegistry } from '../../app-runtime/src/capabilities/index.mjs'
import { AppPackageStore } from '../../app-runtime/src/packages/index.mjs'
import { generateMcpApp } from '../../app-runtime/src/packages/generate-mcp-app.mjs'
import { contracts } from '../../host-contracts/src/index.mjs'
import { APP_ERROR_CODES } from '../src/errors.mjs'

test('shared Host response helpers return expanded responses without schema validation', () => {
  const response = { futureField: { enabled: true }, servers: null }
  for (const [protocol, definition] of Object.entries(contracts)) {
    const methods = contractDefinition(protocol).methods
    for (const method of Object.keys(definition.methods)) {
      assert.equal(validateContract(protocol, method, 'output', response), response)
      assert.equal(methods[method].validateOutput(response), response)
    }
  }
  assert.throws(() => validateMcpHostInput('servers.list', { unexpected: true }), /Invalid servers.list input/)
  assert.throws(() => validateContract('moss.mcp/v1', 'unknown', 'output', response), /Unsupported/)
})

test('MCP typed clients keep expanded response fields unchanged', async () => {
  const response = { servers: [{ check: { schemaRevision: 'a'.repeat(64), catalogStale: true } }], futureField: true }
  const client = createMcpClient({ request: async (protocol, method, input) => {
    assert.equal(protocol, 'moss.mcp/v1')
    assert.equal(method, 'servers.list')
    assert.deepEqual(input, {})
    return response
  } })
  assert.equal(await client.request('servers.list'), response)
})

test('Host dispatch skips output validators but retains input, method and grant checks', async () => {
  let calls = 0
  const response = { futureField: true }
  const registry = new AppHostCapabilityRegistry({ protocols: [{
    protocol: 'moss.test/v1',
    methods: { echo: {
      permission: 'test:echo',
      validateInput: input => {
        assert.equal(typeof input.text, 'string')
        return input
      },
      validateOutput: () => { throw new Error('Output validation must not run') },
    } },
  }] })
  registry.registerHandler('moss.test/v1', 'echo', () => { calls += 1; return response })
  const request = { appId: 'fixture.compatibility', instanceId: 'fixture.compatibility--default',
    protocol: 'moss.test/v1', method: 'echo', input: { text: 'hello' },
    protocols: ['moss.test/v1'], permissions: ['test:echo'], grants: ['test:echo'] }
  assert.equal(await registry.dispatch(request), response)
  await assert.rejects(registry.dispatch({ ...request, input: { text: 1 } }))
  await assert.rejects(registry.dispatch({ ...request, grants: [] }), { code: 'APP_PERMISSION_DENIED' })
  await assert.rejects(registry.dispatch({ ...request, method: 'unknown' }))
  assert.equal(calls, 1)
})

test('Host version compatibility accepts newer minor versions and rejects another major', () => {
  const manifest = { schemaVersion: 2, id: 'fixture.compatibility', version: '1.0.0',
    displayName: 'Compatibility', hostApi: '^3.1.0', permissions: [], ui: { entry: 'dist/ui/index.html' } }
  for (const hostApiVersion of ['3.1.0', '3.21.0', '3.99.0']) {
    assert.equal(validateAppManifest(manifest, { hostApiVersion }).hostApi, '^3.1.0')
  }
  for (const hostApiVersion of ['3.0.0', '4.1.0']) {
    assert.throws(() => validateAppManifest(manifest, { hostApiVersion }), { code: APP_ERROR_CODES.incompatibleHost })
  }
})

test('installation and startup loading still enforce the App Host major version', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-host-compatibility-'))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  const generated = await generateMcpApp({ destination: path.join(root, 'source'), definition: {
    schemaVersion: 1, id: 'fixture.compatibility', version: '1.0.0', displayName: 'Compatibility',
    mcpServers: { echo: { command: 'node', args: ['echo.mjs'] } },
  } })
  const appsDir = path.join(root, 'installed')
  const store = new AppPackageStore({ appsDir, hostApiVersion: '3.21.0' })
  await store.installFromDirectory(generated.root)
  const newer = new AppPackageStore({ appsDir, hostApiVersion: '3.99.0' })
  assert.equal((await newer.get('fixture.compatibility', '1.0.0')).manifest.id, 'fixture.compatibility')
  const incompatible = new AppPackageStore({ appsDir, hostApiVersion: '4.1.0' })
  await assert.rejects(incompatible.get('fixture.compatibility', '1.0.0'), { code: APP_ERROR_CODES.incompatibleHost })
  await assert.rejects(incompatible.installFromDirectory(generated.root), { code: APP_ERROR_CODES.incompatibleHost })
})
