import { test, expect } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inspectSourceProject } from '../../packages/app-runtime/src/packages/source.mjs'

test('declarative connector source is rebuildable only when its declared payload exists', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'connector-source-'))
  const write = (name: string, value: unknown) => fs.writeFile(path.join(root, name), JSON.stringify(value))
  try {
    await fs.mkdir(path.join(root, 'connector'))
    await write('app.moss.json', { id: 'moss.fixture', version: '0.1.0', connectorApp: { id: 'fixture', capabilities: ['cli'] } })
    await write('package.json', { name: 'fixture', version: '0.1.0', packageManager: 'npm@10.9.0', scripts: { build: 'node ../../packages/connector-app-build/build.mjs' } })
    await write('connector/connector.json', { id: 'fixture', skillNames: [] })
    await write('connector/cli.json', { status: 'fixture status' })
    expect((await inspectSourceProject(root)).manifest.id).toBe('moss.fixture')
    await fs.rm(path.join(root, 'connector/cli.json'))
    await expect(inspectSourceProject(root)).rejects.toThrow('capabilities do not match')
    await fs.rm(path.join(root, 'connector/connector.json'))
    await expect(inspectSourceProject(root)).rejects.toThrow('missing editable source')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
