import { describe, expect, test } from 'bun:test'
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolUseContext } from '../Tool.js'
import { getSessionCreatedTeams } from '../bootstrap/state.js'
import { asSessionId } from '../types/ids.js'
import { runWithSessionIdContext } from '../utils/sessionIdContext.js'
import {
  readTeamFile,
  removeTeammateFromTeamFile,
  sanitizeName,
  setMemberActive,
  writeTeamFileAsync,
} from '../utils/swarm/teamHelpers.js'
import { approveIdleInProcessShutdown } from '../utils/swarm/inProcessRunner.js'
import { isShutdownApproved, readUnreadMessages } from '../utils/teammateMailbox.js'
import {
  createTask,
  ensureTeamMemberTask,
  getTaskListIdForScope,
  listTasks,
} from '../utils/tasks.js'
import { TeamCreateTool } from './TeamCreateTool/TeamCreateTool.js'
import { TeamDeleteTool } from './TeamDeleteTool/TeamDeleteTool.js'

describe('Agent Teams lifecycle', () => {
  test('binds team polling to the current embedded session store', async () => {
    const source = await readFile(join(import.meta.dir, '..', 'electron-direct.ts'), 'utf8')
    const sendStart = source.indexOf('async *send(')
    const shutdownStart = source.indexOf('async shutdownAgentTeam()', sendStart)
    const sendSource = source.slice(sendStart, shutdownStart)

    expect(sendStart).toBeGreaterThan(-1)
    expect(shutdownStart).toBeGreaterThan(sendStart)
    expect(sendSource).toContain('const sessionStore = this.#store')
    expect(sendSource).not.toMatch(/\bstore\.(?:getState|setState)\b/)
    expect(sendSource).toContain('const hasRunningAgentTeamMembers = () =>')
    expect(sendSource).toContain("task.type === 'in_process_teammate'")
    expect(sendSource).not.toContain('hasRegisteredAgentTeamMembers')
  })

  test('binds pane and in-process spawns to a shared task', async () => {
    const source = await readFile(join(
      import.meta.dir,
      'shared',
      'spawnMultiAgent.ts',
    ), 'utf8')
    const splitPane = source.slice(
      source.indexOf('async function handleSpawnSplitPane('),
      source.indexOf('async function handleSpawnSeparateWindow('),
    )
    const separateWindow = source.slice(
      source.indexOf('async function handleSpawnSeparateWindow('),
      source.indexOf('function registerOutOfProcessTeammateTask('),
    )
    const inProcess = source.slice(
      source.indexOf('async function handleSpawnInProcess('),
      source.indexOf('export async function spawnTeammate('),
    )

    for (const handler of [splitPane, separateWindow, inProcess]) {
      expect(handler).toContain('bindSpawnToSharedTask(')
      expect(handler).toContain('assignedPrompt')
    }
    expect(splitPane).toContain('text: assignedPrompt')
    expect(separateWindow).toContain('text: assignedPrompt')
    expect(inProcess.indexOf('await writeTeamFileAsync(teamName, teamFile)'))
      .toBeLessThan(inProcess.indexOf('startInProcessTeammate({'))
  })

  test('keeps shared task completion explicit and removes failed members', async () => {
    const source = await readFile(join(
      import.meta.dir,
      '..',
      'utils',
      'swarm',
      'inProcessRunner.ts',
    ), 'utf8')
    const failurePath = source.slice(
      source.indexOf('[inProcessRunner] Agent ${identity.agentId} failed'),
      source.indexOf('export function startInProcessTeammate('),
    )

    expect(source).toContain("task.id === taskId && task.status === 'completed'")
    expect(source).not.toContain('await updateTask(teamTaskListId, activeSharedTaskId')
    expect(source).toContain('await persistMemberActivity(identity, true)')
    expect(source).toContain('await persistMemberActivity(identity, false)')
    expect(failurePath).toContain('removeMemberByAgentIdAsync(identity.teamName, identity.agentId)')
    expect(failurePath).toContain('remainingTeammates')
    expect(failurePath.indexOf('await sendIdleNotification('))
      .toBeLessThan(failurePath.indexOf("status: 'failed' as const"))
  })

  test('serializes concurrent in-process member activity updates', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'moss-agent-team-activity-'))
    const teamName = 'Activity Team'

    try {
      await runWithSessionIdContext(
        asSessionId('agent-team-activity-session'),
        null,
        async () => {
          await writeTeamFileAsync(teamName, {
            name: teamName,
            createdAt: Date.now(),
            leadAgentId: 'team-lead@Activity-Team',
            members: ['alpha', 'beta', 'gamma'].map(name => ({
              agentId: `${name}@Activity-Team`,
              name,
              joinedAt: Date.now(),
              tmuxPaneId: 'in-process',
              cwd: configDir,
              subscriptions: [],
              backendType: 'in-process',
              isActive: true,
            })),
          })
          await Promise.all([
            setMemberActive(teamName, 'alpha', false),
            setMemberActive(teamName, 'beta', false),
            setMemberActive(teamName, 'gamma', false),
          ])
          const team = readTeamFile(teamName)
          expect(team?.members.map(member => member.isActive)).toEqual([
            false,
            false,
            false,
          ])
        },
        undefined,
        { MOSS_CONFIG_DIR: configDir },
      )
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test('atomically assigns distinct incarnations when two sessions request one name', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'moss-agent-team-race-'))
    const states: Record<string, unknown>[] = [
      { inbox: { messages: [] } },
      { inbox: { messages: [] } },
    ]
    const contextFor = (index: number) => ({
      abortController: new AbortController(),
      getAppState: () => states[index],
      setAppState: (update: (previous: Record<string, unknown>) => Record<string, unknown>) => {
        states[index] = update(states[index]!)
      },
    }) as unknown as ToolUseContext
    const names: string[] = []

    try {
      const created = await Promise.all([0, 1].map(index => runWithSessionIdContext(
        asSessionId(`agent-team-race-${index}`),
        null,
        async () => {
          const result = await TeamCreateTool.call(
            { team_name: 'Concurrent Team' },
            contextFor(index),
          )
          return {
            result,
            incarnationId: readTeamFile(result.data.team_name)?.incarnationId,
          }
        },
        undefined,
        {
          MOSS_CONFIG_DIR: configDir,
          CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        },
      )))
      names.push(...created.map(entry => entry.result.data.team_name))

      expect(new Set(names).size).toBe(2)
      expect(names).toContain('Concurrent Team')
      const incarnations = created.map(entry => entry.incarnationId)
      expect(new Set(incarnations).size).toBe(2)
      await Promise.all(names.map(name => access(
        join(configDir, 'teams', sanitizeName(name), 'config.json'),
      )))
    } finally {
      names.forEach(name => getSessionCreatedTeams().delete(name))
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test('creates one DAG task per teammate and auto-approves idle shutdown', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'moss-agent-team-dag-'))
    let appState: Record<string, unknown> = { inbox: { messages: [] } }
    const context = {
      abortController: new AbortController(),
      getAppState: () => appState,
      setAppState: (update: (previous: Record<string, unknown>) => Record<string, unknown>) => {
        appState = update(appState)
      },
    } as unknown as ToolUseContext

    try {
      await runWithSessionIdContext(
        asSessionId('agent-team-dag-session'),
        null,
        async () => {
          const created = await TeamCreateTool.call({ team_name: 'DAG Team' }, context)
          const teamName = created.data.team_name
          const taskListId = getTaskListIdForScope({ kind: 'team', teamId: teamName })
          const aggregateId = await createTask(taskListId, {
            subject: 'Summarize results',
            description: 'Combine teammate findings',
            status: 'in_progress',
            owner: 'team-lead',
            blocks: [],
            blockedBy: [],
          })
          const assignments = await Promise.all(['cpu', 'memory', 'disk'].map(async name => ({
            teamName,
            agentId: `${name}@DAG-Team`,
            agentName: name,
            subject: `Check ${name}`,
            description: `Inspect ${name}`,
            taskId: await createTask(taskListId, {
              subject: `Check ${name}`,
              description: `Inspect ${name}`,
              status: 'pending',
              owner: '',
              blocks: [aggregateId],
              blockedBy: [],
            }),
          })))
          const assignmentIds = await Promise.all(assignments.map(ensureTeamMemberTask))
          const tasks = await listTasks(taskListId)
          const aggregate = tasks.find(task => task.id === aggregateId)

          expect(tasks).toHaveLength(4)
          expect(new Set(assignmentIds).size).toBe(3)
          expect(new Set(assignmentIds)).toEqual(
            new Set(assignments.map(assignment => assignment.taskId)),
          )
          expect(new Set(aggregate?.blockedBy)).toEqual(new Set(assignmentIds))
          expect(aggregate?.status).toBe('pending')
          expect(tasks.filter(task => task.metadata?.agentTeamAssignment === true))
            .toHaveLength(3)

          await approveIdleInProcessShutdown({
            agentId: 'cpu@DAG-Team',
            agentName: 'cpu',
            teamName,
            planModeRequired: false,
            parentSessionId: 'agent-team-dag-session',
          }, 'shutdown-test')
          const approvalMessages = await readUnreadMessages('team-lead', teamName)
          expect(isShutdownApproved(approvalMessages.at(-1)?.text ?? '')).toMatchObject({
            requestId: 'shutdown-test',
            from: 'cpu',
          })
        },
        undefined,
        {
          MOSS_CONFIG_DIR: configDir,
          CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        },
      )
    } finally {
      getSessionCreatedTeams().delete('DAG Team')
      await rm(configDir, { recursive: true, force: true })
    }
  })

  test('blocks idle-member deletion and emits a terminal receipt before cleanup', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'moss-agent-team-lifecycle-'))
    let appState: Record<string, unknown> = {
      expandedView: undefined,
      inbox: { messages: [] },
    }
    const context = {
      abortController: new AbortController(),
      getAppState: () => appState,
      setAppState: (update: (previous: Record<string, unknown>) => Record<string, unknown>) => {
        appState = update(appState)
      },
    } as unknown as ToolUseContext

    try {
      await runWithSessionIdContext(
        asSessionId('agent-team-lifecycle-session'),
        null,
        async () => {
          const created = await TeamCreateTool.call({
            team_name: 'Lifecycle Team',
            description: 'Exercise terminal archival',
          }, context)
          const teamName = created.data.team_name
          const teamFile = readTeamFile(teamName)!
          expect(teamFile.incarnationId).toMatch(/^[a-f0-9-]{36}$/)

          await writeTeamFileAsync(teamName, {
            ...teamFile,
            members: [...teamFile.members, {
              agentId: 'idle-worker@Lifecycle-Team',
              name: 'idle-worker',
              agentType: 'worker',
              joinedAt: Date.now(),
              tmuxPaneId: '',
              cwd: configDir,
              subscriptions: [],
              isActive: false,
            }],
          })
          const denied = await TeamDeleteTool.call({}, context)
          expect(denied.data).toMatchObject({
            success: false,
            team_name: teamName,
            message: expect.stringContaining('registered member'),
          })

          expect(removeTeammateFromTeamFile(teamName, { name: 'idle-worker' })).toBe(true)
          const deleted = await TeamDeleteTool.call({}, context)
          expect(deleted.data).toMatchObject({
            success: true,
            team_name: teamName,
            incarnation_id: teamFile.incarnationId,
            final_tasks: [],
          })

          const receiptPath = join(
            configDir,
            'tasks',
            '.agent-team-terminals',
            `${teamFile.incarnationId}.json`,
          )
          const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
          expect(receipt).toMatchObject({
            reason: 'completed',
            teamName,
            incarnationId: teamFile.incarnationId,
          })
          await expect(stat(join(configDir, 'teams', sanitizeName(teamName))))
            .rejects.toThrow()
          await expect(stat(join(configDir, 'tasks', sanitizeName(teamName))))
            .rejects.toThrow()
        },
        undefined,
        {
          MOSS_CONFIG_DIR: configDir,
          CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        },
      )
    } finally {
      getSessionCreatedTeams().delete('Lifecycle Team')
      await rm(configDir, { recursive: true, force: true })
    }
  })
})
