import { afterEach, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { restoreAppTestScreenshotAttachments } from '../src/session-history-service.mjs'

const roots = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

test('restores screenshot cards from a reloaded control transcript', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-test-history-'))
  roots.push(root)
  const run = path.join(root, 'runs', randomUUID())
  const evidence = path.join(run, 'evidence')
  await fs.mkdir(evidence, { recursive: true })
  const first = path.join(evidence, 'runtime-settings-saved-0.png')
  const second = path.join(evidence, 'runtime-settings-saved-1.png')
  await fs.writeFile(first, 'png')
  await fs.writeFile(second, 'png')
  const history = [{ type: 'user', message: { content: [
    { type: 'text', text: '核对本批新截图。' },
    { type: 'text', text: '截图：runtime-settings-saved-0.png' },
    { type: 'text', text: '截图：runtime-settings-saved-1.png' },
  ] } }]
  await restoreAppTestScreenshotAttachments({ appIds: ['moss.self-test'], workspace: run }, history)
  const resolved = await Promise.all([first, second].map(file => fs.realpath(file)))
  expect(history[0].files).toEqual(resolved)
  expect(history[0].images).toEqual(resolved)
})

test('rejects screenshot captions outside the run evidence directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-test-history-'))
  roots.push(root)
  await fs.mkdir(path.join(root, 'evidence'))
  const outside = path.join(root, 'outside.png')
  await fs.writeFile(outside, 'private')
  await fs.symlink(outside, path.join(root, 'evidence', 'linked.png'))
  const history = [{ type: 'user', message: { content: '核对截图。\n截图：linked.png' } }]
  await restoreAppTestScreenshotAttachments({ appTestRunId: 'run', workspace: root }, history)
  expect(history[0].files).toBeUndefined()
})
