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
import {
  getEmptyToolPermissionContext,
  type ToolUseContext,
} from '../../Tool.js'
import {
  getGlobalMossFolderPermissionPattern,
  GLOBAL_MOSS_FOLDER_PERMISSION_PATTERN,
  MOSS_FOLDER_PERMISSION_PATTERN,
} from '../../tools/FileEditTool/constants.js'
import { asSessionId } from '../../types/ids.js'
import { runWithSessionIdContext } from '../sessionIdContext.js'
import { getMossConfigHomeDir } from '../envUtils.js'
import {
  discardSessionWorkspaceDirectories,
  registerSessionWorkspaceDirectories,
} from '../sessionWorkspaceRegistry.js'
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
const { hasPermissionsToUseTool } = await import('../permissions/permissions.js')
const { validatePath } = await import('../permissions/pathValidation.js')
const { FileWriteTool } = await import('../../tools/FileWriteTool/FileWriteTool.js')

const originalMossConfigDir = process.env.MOSS_CONFIG_DIR
const originalCwd = getOriginalCwd()
const originalSessionId = getSessionId()
const originalSessionProjectDir = getSessionProjectDir()

afterEach(() => {
  discardSessionWorkspaceDirectories(getSessionId())
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

  test('allows explicitly registered session workspace files by session id', () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss'
    const sessionDir = '/tmp/custom-moss/sessions/moss-session'
    const workspaceDir = join(sessionDir, 'workspace')
    setOriginalCwd('/tmp/unrelated-project')
    switchSession(
      asSessionId('underlying-session'),
      join(sessionDir, 'runtime', 'engine'),
    )
    registerSessionWorkspaceDirectories('underlying-session', [workspaceDir])

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

  test('allows both session and shared project workspaces for project sessions', async () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss'
    const sessionWorkspace =
      '/tmp/custom-moss/sessions/project-session/workspace'
    const projectWorkspace =
      '/tmp/custom-moss/projects/project-1/workspace'
    const sessionId = asSessionId('project-engine-session')
    setOriginalCwd('/tmp/unrelated-project')
    switchSession(sessionId, '/tmp/custom-moss/sessions/project-session/runtime/engine')
    registerSessionWorkspaceDirectories(sessionId, [
      sessionWorkspace,
      projectWorkspace,
    ])
    const permissionContext = getEmptyToolPermissionContext()
    const toolUseContext = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: permissionContext }),
    } as unknown as ToolUseContext

    for (const workspaceFile of [
      join(sessionWorkspace, 'working', 'draft.md'),
      join(projectWorkspace, 'shared-report.md'),
    ]) {
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
        await hasPermissionsToUseTool(
          FileWriteTool,
          { file_path: workspaceFile, content: 'project output' },
          toolUseContext,
          {} as never,
          `write-project-workspace-${workspaceFile}`,
        ),
      ).toMatchObject({ behavior: 'allow' })
    }

    const projectConfigFile = join(
      projectWorkspace,
      '.moss',
      'settings.json',
    )
    expect(
      checkPathSafetyForAutoEdit(projectConfigFile, [projectConfigFile]).safe,
    ).toBe(false)
  })

  test('resolves workspace by the stable desktop session id', () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss'
    const desktopSessionId = 'desktop-session'
    const workspace = '/tmp/custom-moss/sessions/desktop-session/workspace'
    const workspaceFile = join(workspace, 'welcome.md')
    registerSessionWorkspaceDirectories(desktopSessionId, [workspace])

    const isAllowed = runWithSessionIdContext(
      asSessionId('underlying-session'),
      '/tmp/custom-moss/sessions/desktop-session/runtime/engine',
      () => pathInAllowedWorkingPath(
        workspaceFile,
        getEmptyToolPermissionContext(),
        [workspaceFile],
      ),
      { kind: 'session', sessionId: desktopSessionId },
    )

    expect(isAllowed).toBe(true)
    discardSessionWorkspaceDirectories(desktopSessionId)
  })

  test('allows a user-selected workspace only for its registered session', async () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss'
    const customWorkspace = '/tmp/custom-moss/workspace/user-selected'
    const workspaceFile = join(customWorkspace, 'welcome.md')
    const sessionId = asSessionId('custom-workspace-session')
    setOriginalCwd('/tmp/unrelated-project')
    switchSession(sessionId, '/tmp/transcripts/custom-workspace-session')
    registerSessionWorkspaceDirectories(sessionId, [customWorkspace])

    const permissionContext = {
      ...getEmptyToolPermissionContext(),
    }
    const toolUseContext = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: permissionContext }),
    } as unknown as ToolUseContext

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
      await hasPermissionsToUseTool(
        FileWriteTool,
        { file_path: workspaceFile, content: 'welcome' },
        toolUseContext,
        {} as never,
        'write-registered-workspace',
      ),
    ).toMatchObject({ behavior: 'allow' })
    expect(
      validatePath(
        workspaceFile,
        '/tmp/unrelated-project',
        permissionContext,
        'write',
      ),
    ).toMatchObject({ allowed: true })

    switchSession(asSessionId('different-session'), '/tmp/transcripts/different')
    expect(
      checkPathSafetyForAutoEdit(workspaceFile, [workspaceFile]).safe,
    ).toBe(false)
    expect(
      pathInAllowedWorkingPath(
        workspaceFile,
        getEmptyToolPermissionContext(),
        [workspaceFile],
      ),
    ).toBe(false)
    expect(
      await hasPermissionsToUseTool(
        FileWriteTool,
        { file_path: workspaceFile, content: 'welcome' },
        toolUseContext,
        {} as never,
        'write-unregistered-workspace',
      ),
    ).toMatchObject({
      behavior: 'ask',
      decisionReason: { type: 'safetyCheck' },
    })
    discardSessionWorkspaceDirectories(sessionId)
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
