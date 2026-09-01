import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  initializeKeybindingWatcher,
  loadKeybindings,
  reloadKeybindings,
  resetKeybindingLoaderForTesting,
  subscribeToKeybindingChanges,
} from '../keybindings/loadUserBindings.js'
import { getDestructiveCommandWarning as getBashDestructiveCommandWarning } from '../tools/BashTool/destructiveCommandWarning.js'
import { getDestructiveCommandWarning as getPowerShellDestructiveCommandWarning } from '../tools/PowerShellTool/destructiveCommandWarning.js'
import { isAgentSwarmsEnabled } from './agentSwarmsEnabled.js'
import { getOpusDefaultEffortConfig } from './effort.js'
import { addLineNumbers } from './file.js'
import { getMossMds, type MemoryFileInfo } from './mossmd.js'

const originalConfigDir = process.env.MOSS_CONFIG_DIR
const originalAgentTeams = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.MOSS_CONFIG_DIR
  else process.env.MOSS_CONFIG_DIR = originalConfigDir
  if (originalAgentTeams === undefined) {
    delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  } else {
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = originalAgentTeams
  }
  resetKeybindingLoaderForTesting()
})

describe('solidified feature behavior', () => {
  test('keeps project and local instructions in the Moss context', () => {
    const memoryFiles: MemoryFileInfo[] = [
      {
        path: '/workspace/AGENTS.md',
        type: 'Project',
        content: 'Project instructions',
      },
      {
        path: '/workspace/AGENTS.local.md',
        type: 'Local',
        content: 'Local instructions',
      },
    ]

    const prompt = getMossMds(memoryFiles)

    expect(prompt).toContain('Project instructions')
    expect(prompt).toContain('Local instructions')
  })

  test('uses compact tab-separated line number prefixes', () => {
    expect(addLineNumbers({ content: 'first\nsecond', startLine: 7 })).toBe(
      '7\tfirst\n8\tsecond',
    )
  })

  test('loads an explicit user keybindings file without a release gate', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'moss-keybindings-'))
    process.env.MOSS_CONFIG_DIR = configDir
    resetKeybindingLoaderForTesting()
    try {
      await writeFile(
        join(configDir, 'keybindings.json'),
        JSON.stringify({
          bindings: [
            {
              context: 'Global',
              bindings: { 'ctrl+shift+y': 'app:toggleTodos' },
            },
          ],
        }),
      )

      const result = await loadKeybindings()

      expect(
        result.bindings.some(
          binding =>
            binding.context === 'Global' &&
            binding.action === 'app:toggleTodos' &&
            binding.chord[0]?.key === 'y',
        ),
      ).toBe(true)
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test('initializes and reloads keybindings when the config directory is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moss-keybindings-missing-'))
    const configDir = join(root, 'nested', 'config')
    process.env.MOSS_CONFIG_DIR = configDir
    resetKeybindingLoaderForTesting()
    let reloaded = false
    const unsubscribe = subscribeToKeybindingChanges(result => {
      reloaded = result.bindings.some(
        binding =>
          binding.context === 'Global' &&
          binding.action === 'app:toggleTodos' &&
          binding.chord[0]?.key === 'u',
      )
    })

    try {
      await initializeKeybindingWatcher()
      expect((await stat(configDir)).isDirectory()).toBe(true)
      await writeFile(
        join(configDir, 'keybindings.json'),
        JSON.stringify({
          bindings: [
            {
              context: 'Global',
              bindings: { 'ctrl+shift+u': 'app:toggleTodos' },
            },
          ],
        }),
      )

      await reloadKeybindings()

      expect(reloaded).toBe(true)
    } finally {
      unsubscribe()
      await rm(root, { recursive: true, force: true })
    }
  })

  test('enables Agent Teams through explicit environment opt-in', () => {
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
    expect(isAgentSwarmsEnabled()).toBe(true)
  })

  test('uses fixed Opus effort recommendation copy', () => {
    expect(getOpusDefaultEffortConfig()).toEqual({
      dialogTitle: 'We recommend medium effort for Opus',
      dialogDescription:
        'Effort determines how long Claude thinks for when completing your task. We recommend medium effort for most tasks to balance speed and intelligence and maximize rate limits.',
    })
  })

  test('detects destructive Bash and PowerShell commands', () => {
    expect(getBashDestructiveCommandWarning('git reset --hard')).not.toBeNull()
    expect(
      getPowerShellDestructiveCommandWarning(
        'Remove-Item ./build -Recurse -Force',
      ),
    ).not.toBeNull()
  })
})
