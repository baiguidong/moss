import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { createHash, randomUUID, type UUID } from 'crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

mock.module('color-diff-napi', () => ({
  ColorDiff: {},
  ColorFile: {},
  getSyntaxTheme: () => ({}),
}))

import { getIsInteractive, setIsInteractive } from '../bootstrap/state.js'
import { asSessionId } from '../types/ids.js'
import { runWithSessionIdContext } from './sessionIdContext.js'

const { fileHistoryRewind } = await import('./fileHistory.js')

const originalInteractive = getIsInteractive()
let root = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'moss-file-rewind-test-'))
  setIsInteractive(false)
})

afterAll(async () => {
  setIsInteractive(originalInteractive)
  await rm(root, { recursive: true, force: true })
})

function backupName(filePath: string, version: number): string {
  const hash = createHash('sha256').update(filePath).digest('hex').slice(0, 16)
  return `${hash}@v${version}`
}

describe('file history rewind', () => {
  test('restores every original file when a later backup cannot be applied', async () => {
    const configDir = join(root, 'config')
    const workspace = join(root, 'workspace')
    const firstPath = join(workspace, 'first.txt')
    const secondPath = join(workspace, 'second.txt')
    const sessionId = asSessionId(randomUUID())
    const messageId = randomUUID() as UUID
    const firstBackup = backupName(firstPath, 1)
    const missingBackup = backupName(secondPath, 1)
    await mkdir(join(configDir, 'file-history', sessionId), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await Promise.all([
      writeFile(firstPath, 'current first\n'),
      writeFile(secondPath, 'current second\n'),
      writeFile(join(configDir, 'file-history', sessionId, firstBackup), 'target first\n'),
    ])

    const state = {
      snapshots: [{
        messageId,
        trackedFileBackups: {
          [firstPath]: { backupFileName: firstBackup, version: 1, backupTime: new Date() },
          [secondPath]: { backupFileName: missingBackup, version: 1, backupTime: new Date() },
        },
        timestamp: new Date(),
      }],
      trackedFiles: new Set([firstPath, secondPath]),
      snapshotSequence: 1,
    }

    await expect(runWithSessionIdContext(
      sessionId,
      null,
      () => fileHistoryRewind((updater) => { updater(state) }, messageId),
      undefined,
      {
        MOSS_CONFIG_DIR: configDir,
        CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1',
      },
    )).rejects.toThrow('File history backup not found')

    expect(await readFile(firstPath, 'utf8')).toBe('current first\n')
    expect(await readFile(secondPath, 'utf8')).toBe('current second\n')
  })
})
