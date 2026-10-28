import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import type { PermissionDeferDecision } from '../../types/permissions.js'
import {
  classifyDeferredPermission,
  consumeDeferredPermission,
  listDeferredPermissions,
  persistDeferredPermission,
} from './deferredPermission.js'

const defer: PermissionDeferDecision = {
  behavior: 'defer',
  message: 'approval is required',
  toolUseID: 'tool-1',
}

test('interactive defer becomes an ordinary permission prompt', () => {
  const result = classifyDeferredPermission(defer, {
    isNonInteractiveSession: false,
    hasResumeCapability: true,
  })
  expect(result.kind).toBe('ask')
  expect(result.decision.behavior).toBe('ask')
})

test('served defer fails closed without resume machinery', () => {
  const result = classifyDeferredPermission(defer, {
    isNonInteractiveSession: true,
    isServedSession: true,
    hasResumeCapability: false,
  })
  expect(result.kind).toBe('denied')
  if (result.kind === 'denied') {
    expect(result.decision.message).toContain('no resume capability')
  }
})

test('deferred permissions persist atomically and can be consumed once', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'moss-deferred-'))
  const now = Date.now()
  const record = await persistDeferredPermission({
    storageDir,
    decision: defer,
    toolUseID: 'tool-1',
    toolName: 'Bash',
    toolInput: { command: 'git status' },
    permissionMode: 'default',
    hookSnapshot: { hookName: 'policy' },
    now,
    ttlMs: 60_000,
  })

  expect(record.resumeToken).toBeString()
  expect(await listDeferredPermissions(storageDir)).toHaveLength(1)
  const raw = await readFile(join(storageDir, 'deferred-permissions.json'), 'utf8')
  expect(JSON.parse(raw)[0].toolInput).toEqual({ command: 'git status' })

  const consumed = await consumeDeferredPermission(storageDir, record.resumeToken)
  expect(consumed?.toolUseID).toBe('tool-1')
  expect(await consumeDeferredPermission(storageDir, record.resumeToken)).toBeUndefined()
})

test('expired deferred records are removed when listed', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'moss-deferred-expired-'))
  const now = Date.now() - 10_000
  await persistDeferredPermission({
    storageDir,
    decision: { ...defer, resumeToken: 'expired' },
    toolUseID: 'tool-expired',
    toolName: 'Write',
    toolInput: { file_path: '/tmp/x' },
    permissionMode: 'default',
    now,
    ttlMs: 1,
  })

  // The implementation uses the current wall clock when loading, so this
  // record is already expired by the time it is inspected.
  expect(await listDeferredPermissions(storageDir)).toEqual([])
})

test('concurrent resume claims consume a token exactly once', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'moss-deferred-race-'))
  const record = await persistDeferredPermission({
    storageDir,
    decision: defer,
    toolUseID: 'tool-race',
    toolName: 'Bash',
    toolInput: { command: 'true' },
    permissionMode: 'default',
  })

  const claims = await Promise.all(
    Array.from({ length: 4 }, () =>
      consumeDeferredPermission(storageDir, record.resumeToken),
    ),
  )
  expect(claims.filter(Boolean)).toHaveLength(1)
  expect(await listDeferredPermissions(storageDir)).toEqual([])
})
