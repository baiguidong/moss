import { afterEach, describe, expect, mock, test } from 'bun:test'
import { join } from 'path'
import {
  getOriginalCwd,
  getSessionId,
  getSessionProjectDir,
  setOriginalCwd,
  switchSession,
} from '../../bootstrap/state.js'
import statusline from '../../commands/statusline.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import {
  getGlobalMossFolderPermissionPattern,
  GLOBAL_MOSS_FOLDER_PERMISSION_PATTERN,
  MOSS_FOLDER_PERMISSION_PATTERN,
} from '../../tools/FileEditTool/constants.js'
import { asSessionId } from '../../types/ids.js'
import { getMossConfigHomeDir } from '../envUtils.js'
import { getMemoryPath } from '../config.js'
import { isMemoryFilePath } from '../mossmd.js'
import {
  getProjectInstructionFilePaths,
  isInstructionFilename,
  LOCAL_INSTRUCTION_FILENAMES,
  PROJECT_INSTRUCTION_FILENAMES,
} from '../instructionFiles.js'
import {
  getRelativeSettingsFilePathForSource,
  getSettingsFilePathForSource,
} from '../settings/settings.js'

mock.module('color-diff-napi', () => ({
  ColorDiff: {},
  ColorFile: {},
  getSyntaxTheme: () => ({}),
}))

const { checkPathSafetyForAutoEdit, pathInAllowedWorkingPath } =
  await import('../permissions/filesystem.js')

const originalMossConfigDir = process.env.MOSS_CONFIG_DIR
const originalCwd = getOriginalCwd()
const originalSessionId = getSessionId()
const originalSessionProjectDir = getSessionProjectDir()

afterEach(() => {
  restoreEnv('MOSS_CONFIG_DIR', originalMossConfigDir)
  setOriginalCwd(originalCwd)
  switchSession(originalSessionId, originalSessionProjectDir)
})

describe('Moss project paths', () => {
  test('uses .moss for project and local settings', () => {
    expect(getRelativeSettingsFilePathForSource('projectSettings')).toBe(
      join('.moss', 'settings.json'),
    )
    expect(getRelativeSettingsFilePathForSource('localSettings')).toBe(
      join('.moss', 'settings.local.json'),
    )
  })

  test('uses MOSS_CONFIG_DIR for global settings', () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss'
    expect(getSettingsFilePathForSource('userSettings')).toBe(
      '/tmp/custom-moss/settings.json',
    )
  })

  test('uses AGENTS.md for primary instruction memory paths', () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss'
    setOriginalCwd('/tmp/moss-project')

    expect(getMemoryPath('User')).toBe('/tmp/custom-moss/AGENTS.md')
    expect(getMemoryPath('Project')).toBe('/tmp/moss-project/AGENTS.md')
    expect(getMemoryPath('Local')).toBe('/tmp/moss-project/AGENTS.local.md')
  })

  test('recognizes supported project instruction files as memory files', () => {
    expect(PROJECT_INSTRUCTION_FILENAMES).toEqual(['CLAUDE.md', 'AGENTS.md'])
    expect(LOCAL_INSTRUCTION_FILENAMES).toEqual([
      'CLAUDE.local.md',
      'AGENTS.local.md',
    ])
    expect(getProjectInstructionFilePaths('/tmp/project')).toEqual([
      '/tmp/project/CLAUDE.md',
      '/tmp/project/.moss/CLAUDE.md',
      '/tmp/project/AGENTS.md',
      '/tmp/project/.moss/AGENTS.md',
    ])
    expect(isInstructionFilename('AGENTS.md')).toBe(true)
    expect(isMemoryFilePath(join('/tmp/project', 'AGENTS.md'))).toBe(true)
    expect(isMemoryFilePath(join('/tmp/project', 'AGENTS.local.md'))).toBe(true)
    expect(isMemoryFilePath(join('/tmp/project', 'CLAUDE.md'))).toBe(true)
    expect(isMemoryFilePath(join('/tmp/project', 'CLAUDE.local.md'))).toBe(true)
    expect(isMemoryFilePath(join('/tmp/project', 'MOSS.md'))).toBe(false)
    expect(isMemoryFilePath(join('/tmp/project', 'MOSS.local.md'))).toBe(false)
    expect(
      isMemoryFilePath(join('/tmp/project', '.moss', 'rules', 'testing.md')),
    ).toBe(true)
    expect(isMemoryFilePath(join('/tmp/project', 'README.md'))).toBe(false)
  })

  test('generates project and global Moss permission rules', () => {
    expect(MOSS_FOLDER_PERMISSION_PATTERN).toBe('/.moss/**')
    expect(GLOBAL_MOSS_FOLDER_PERMISSION_PATTERN).toBe('~/.moss/**')

    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss/'
    expect(getGlobalMossFolderPermissionPattern()).toBe('/tmp/custom-moss/**')
  })

  test('protects a custom global Moss config directory', () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss'
    const protectedPath = '/tmp/custom-moss/agents/reviewer.md'
    const adjacentPath = '/tmp/custom-moss-other/agents/reviewer.md'

    expect(checkPathSafetyForAutoEdit(protectedPath, [protectedPath]).safe).toBe(
      false,
    )
    expect(checkPathSafetyForAutoEdit(adjacentPath, [adjacentPath])).toEqual({
      safe: true,
    })
  })

  test('allows managed session workspace files when cwd context is unavailable', () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss'
    const sessionDir = '/tmp/custom-moss/sessions/moss-session'
    const workspaceDir = join(sessionDir, 'workspace')
    setOriginalCwd('/tmp/unrelated-project')
    switchSession(asSessionId('underlying-session'), sessionDir)

    const workspaceFile = join(workspaceDir, 'welcome.txt')
    const sessionMetadataFile = join(sessionDir, 'session.json')
    const otherSessionWorkspaceFile = join(
      '/tmp/custom-moss/sessions/other-session/workspace',
      'welcome.txt',
    )
    const nestedSessionWorkspaceFile = join(
      '/tmp/custom-moss/sessions/group/moss-session/workspace',
      'welcome.txt',
    )
    const nestedProjectConfigFile = join(
      workspaceDir,
      '.moss',
      'agents',
      'reviewer.md',
    )

    expect(checkPathSafetyForAutoEdit(workspaceFile, [workspaceFile])).toEqual({
      safe: true,
    })
    expect(
      pathInAllowedWorkingPath(
        workspaceFile,
        getEmptyToolPermissionContext(),
        [workspaceFile],
      ),
    ).toBe(true)
    expect(
      pathInAllowedWorkingPath(
        sessionMetadataFile,
        getEmptyToolPermissionContext(),
        [sessionMetadataFile],
      ),
    ).toBe(false)
    expect(
      pathInAllowedWorkingPath(
        otherSessionWorkspaceFile,
        getEmptyToolPermissionContext(),
        [otherSessionWorkspaceFile],
      ),
    ).toBe(false)
    expect(
      pathInAllowedWorkingPath(
        nestedSessionWorkspaceFile,
        getEmptyToolPermissionContext(),
        [nestedSessionWorkspaceFile],
      ),
    ).toBe(false)
    expect(
      checkPathSafetyForAutoEdit(sessionMetadataFile, [sessionMetadataFile])
        .safe,
    ).toBe(false)
    expect(
      checkPathSafetyForAutoEdit(nestedProjectConfigFile, [
        nestedProjectConfigFile,
      ]).safe,
    ).toBe(false)
  })

  test('allows statusline to edit only the Moss global config', () => {
    expect(statusline.allowedTools).toContain(
      `Edit(${join(getMossConfigHomeDir(), 'moss.json')})`,
    )
    expect(statusline.allowedTools).not.toContain(
      'Edit(~/.moss/settings.json)',
    )
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
