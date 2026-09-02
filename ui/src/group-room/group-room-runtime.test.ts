import { describe, expect, test } from 'bun:test'

import { GroupRoomRuntimeRegistry, resolveRoomPermissionPolicy } from './group-room-runtime.mjs'

class FakeClaudeSession {
  static instances: FakeClaudeSession[] = []

  opts: any
  sessionId: string
  aborted = false
  disposed = false
  prompts: string[] = []

  constructor(opts: any) {
    this.opts = opts
    this.sessionId = `fake-${FakeClaudeSession.instances.length + 1}`
    FakeClaudeSession.instances.push(this)
  }

  async *send(prompt: string) {
    this.prompts.push(prompt)
    yield { type: 'assistant', message: { content: [{ type: 'text', text: this.sessionId }] } }
    yield { type: 'result', usage: { input_tokens: 1 } }
  }

  abort() { this.aborted = true }
  dispose() { this.disposed = true }
}

class AuthRequiredClaudeSession extends FakeClaudeSession {
  async *send() {
    yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'auth-1', name: 'mcp__mail__authenticate', input: {} }] } }
    yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'auth-1', is_error: true, content: 'GROUP_ROOM_CONNECTOR_AUTH_REQUIRED:mail' }] } }
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'I could not search, but here is a conclusion.' }] } }
  }
}

class AuthReportedClaudeSession extends FakeClaudeSession {
  async *send() {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'GROUP_ROOM_CONNECTOR_AUTH_REQUIRED:mail' }] } }
  }
}

class EmptyThenConclusionClaudeSession extends FakeClaudeSession {
  calls = 0
  recoveryToolDecision: any = null

  async *send(prompt: string) {
    this.prompts.push(prompt)
    this.calls += 1
    if (this.calls === 1) {
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/tmp/a' } }] } }
      yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'evidence' }] } }
      yield { type: 'result', usage: { input_tokens: 2 } }
      return
    }
    this.recoveryToolDecision = await this.opts.onToolUseValidation('Read', { file_path: '/tmp/a' }, { readOnly: true })
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Recovered public conclusion.' }] } }
  }
}

class ConvergenceClaudeSession extends FakeClaudeSession {
  async *send(prompt: string) {
    this.prompts.push(prompt)
    yield {
      type: 'assistant',
      message: { content: [{ type: 'text', text: JSON.stringify({
        stable: true,
        reason: 'All material issues are resolved.',
        unresolvedIssues: [],
      }) }] },
    }
  }
}

function member(id: string) {
  return {
    id,
    displayName: id,
    role: `${id} role`,
    promptSnapshot: `${id} prompt`,
    teamCharterSnapshot: '',
  }
}

describe('GroupRoomRuntimeRegistry isolation', () => {
  test('resolves room permission before global permission', () => {
    expect(resolveRoomPermissionPolicy({ settings: { permissionMode: 'inherit' } }, { bypassPermissions: true })).toEqual({
      configured: 'inherit', effective: 'allow-all', forceRoomConfirmation: false,
    })
    expect(resolveRoomPermissionPolicy({ settings: { permissionMode: 'ask' } }, { bypassPermissions: true })).toEqual({
      configured: 'ask', effective: 'default', forceRoomConfirmation: true,
    })
    expect(resolveRoomPermissionPolicy({ settings: { permissionMode: 'allow-all' } }, { bypassPermissions: false })).toEqual({
      configured: 'allow-all', effective: 'allow-all', forceRoomConfirmation: false,
    })
  })

  test('passes the resolved permission mode and room confirmation policy into ClaudeSession', async () => {
    FakeClaudeSession.instances = []
    const registry = new GroupRoomRuntimeRegistry({
      getClaudeSessionCtor: async () => FakeClaudeSession,
      getSettings: () => ({ model: 'fake', bypassPermissions: true, advanced: {} }),
      buildThinkingConfig: () => ({ type: 'disabled' }),
      paths: { memberEngineDir: () => '/tmp/member-permission' },
      requestPermission: async () => ({ behavior: 'allow' }),
    })
    const room = {
      id: 'permission-room', topic: 'Permission', workspace: '/tmp', summary: '', summaryThroughSeq: 0,
      settings: { permissionMode: 'ask' }, members: [member('permission-member')],
    }
    await registry.execute({
      room,
      member: room.members[0],
      turn: { id: 'turn-permission', assignment: 'work' },
      snapshotSeq: 0,
      messages: [],
      resources: {
        fingerprint: 'permission-resources', connectorGrants: [], mcpServers: {}, mcpServerNames: [],
        mcpServerAccess: {}, mcpServerConnectors: {}, addDirs: [], environment: {}, skillCommands: [],
      },
      signal: new AbortController().signal,
    })
    expect(FakeClaudeSession.instances[0].opts.permissionMode).toBe('default')
    expect(await FakeClaudeSession.instances[0].opts.shouldForceToolPermission('Bash', { command: 'bun test' }, { readOnly: false })).toBe(true)
    expect(await FakeClaudeSession.instances[0].opts.shouldForceToolPermission('Read', { file_path: '/tmp/a' }, { readOnly: true })).toBe(false)
    room.settings.permissionMode = 'allow-all'
    await registry.execute({
      room,
      member: room.members[0],
      turn: { id: 'turn-allow-all', runId: 'run-allow-all', assignment: 'work' },
      snapshotSeq: 0,
      messages: [],
      resources: {
        fingerprint: 'permission-resources', connectorGrants: [], mcpServers: {}, mcpServerNames: [],
        mcpServerAccess: {}, mcpServerConnectors: {}, addDirs: [], environment: {}, skillCommands: [],
      },
      signal: new AbortController().signal,
    })
    expect(FakeClaudeSession.instances[1].opts.permissionMode).toBe('allow-all')
    expect(await FakeClaudeSession.instances[1].opts.shouldForceToolPermission('Bash', { command: 'bun test' }, { readOnly: false })).toBe(false)
    expect(await FakeClaudeSession.instances[1].opts.onToolUseValidation('Agent', {}, { readOnly: false })).toEqual({
      behavior: 'deny',
      message: 'Tool is not available in Group Rooms: Agent',
    })
    registry.disposeAll()
  })

  test('keeps MCP config, credentials, lifecycle, and permission routing per member', async () => {
    FakeClaudeSession.instances = []
    const permissionRequests: any[] = []
    const runtimeSessions: Array<[string, string]> = []
    const registry = new GroupRoomRuntimeRegistry({
      getClaudeSessionCtor: async () => FakeClaudeSession,
      getSettings: () => ({ model: 'fake', advanced: {} }),
      buildThinkingConfig: () => ({ type: 'disabled' }),
      paths: { memberEngineDir: (_roomId: string, memberId: string) => `/tmp/${memberId}` },
      requestPermission: async (request: any) => {
        permissionRequests.push(request)
        return { behavior: 'allow', updatedInput: request.input }
      },
      onRuntimeSession: (memberId: string, sessionId: string) => runtimeSessions.push([memberId, sessionId]),
    })
    const room = {
      id: 'room',
      topic: 'Isolation',
      workspace: '/tmp',
      summary: '',
      summaryThroughSeq: 0,
      settings: {},
      members: [member('alpha'), member('beta')],
    }
    const resources = [
      {
        fingerprint: 'alpha-resources', connectorGrants: [{ id: 'mail', access: 'read' }],
        mcpServers: { mail: { command: 'mail', env: { TOKEN: 'alpha-secret' } } },
        mcpServerNames: ['mail'], mcpServerAccess: { mail: 'read' }, mcpServerConnectors: { mail: 'mail' },
        addDirs: [], environment: { MAIL_TOKEN: 'alpha-secret' }, skillCommands: [],
      },
      {
        fingerprint: 'beta-resources', connectorGrants: [{ id: 'calendar', access: 'write' }],
        mcpServers: { calendar: { command: 'calendar', env: { TOKEN: 'beta-secret' } } },
        mcpServerNames: ['calendar'], mcpServerAccess: { calendar: 'write' }, mcpServerConnectors: { calendar: 'calendar' },
        addDirs: [], environment: { CALENDAR_TOKEN: 'beta-secret' }, skillCommands: [],
      },
    ]

    await Promise.all(room.members.map((entry, index) => registry.execute({
      room,
      member: entry,
      turn: { id: `turn-${index}`, assignment: 'work' },
      snapshotSeq: 0,
      messages: [],
      resources: resources[index],
      signal: new AbortController().signal,
    })))

    expect(FakeClaudeSession.instances).toHaveLength(2)
    expect(Object.keys(FakeClaudeSession.instances[0].opts.mcpServers)).toEqual(['mail'])
    expect(Object.keys(FakeClaudeSession.instances[1].opts.mcpServers)).toEqual(['calendar'])
    expect(FakeClaudeSession.instances[0].opts.environment).not.toHaveProperty('CALENDAR_TOKEN')
    expect(FakeClaudeSession.instances[1].opts.environment).not.toHaveProperty('MAIL_TOKEN')
    expect(runtimeSessions).toEqual([['alpha', 'fake-1'], ['beta', 'fake-2']])

    await Promise.all([
      FakeClaudeSession.instances[0].opts.onPermissionRequest('mcp__mail__read', { query: 'a' }, {}),
      FakeClaudeSession.instances[1].opts.onPermissionRequest('mcp__calendar__write', { event: 'b' }, {}),
      FakeClaudeSession.instances[0].opts.onPermissionRequest('ListMcpResourcesTool', { server: 'mail' }, {}),
    ])
    expect(permissionRequests.map(request => [request.memberId, request.connectorId])).toEqual([
      ['alpha', 'mail'],
      ['beta', 'calendar'],
      ['alpha', 'mail'],
    ])

    registry.abortMember('room', 'alpha')
    expect(FakeClaudeSession.instances[0].aborted).toBe(true)
    expect(FakeClaudeSession.instances[1].aborted).toBe(false)
    registry.disposeAll()
    expect(FakeClaudeSession.instances.every(instance => instance.disposed)).toBe(true)
  })


  test('rejects a final answer that masks a connector authorization failure', async () => {
    const registry = new GroupRoomRuntimeRegistry({
      getClaudeSessionCtor: async () => AuthRequiredClaudeSession,
      getSettings: () => ({ model: 'fake', advanced: {} }),
      buildThinkingConfig: () => ({ type: 'disabled' }),
      paths: { memberEngineDir: () => '/tmp/member' },
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const room = {
      id: 'room', topic: 'Auth', workspace: '/tmp', summary: '', summaryThroughSeq: 0,
      settings: {}, members: [member('alpha')],
    }
    await expect(registry.execute({
      room,
      member: room.members[0],
      turn: { id: 'turn', assignment: 'search' },
      snapshotSeq: 0,
      messages: [],
      resources: {
        fingerprint: 'auth-resources', connectorGrants: [{ id: 'mail', access: 'read' }],
        mcpServers: { mail: { command: 'mail' } }, mcpServerNames: ['mail'],
        mcpServerAccess: { mail: 'read' }, mcpServerConnectors: { mail: 'qq-mail' },
        addDirs: [], environment: {}, skillCommands: [],
      },
      signal: new AbortController().signal,
    })).rejects.toThrow('连接器授权需要在连接器中心刷新: qq-mail')
    registry.disposeAll()
  })

  test('turns an agent-reported connector authorization requirement into a failure', async () => {
    const registry = new GroupRoomRuntimeRegistry({
      getClaudeSessionCtor: async () => AuthReportedClaudeSession,
      getSettings: () => ({ model: 'fake', advanced: {} }),
      buildThinkingConfig: () => ({ type: 'disabled' }),
      paths: { memberEngineDir: () => '/tmp/member' },
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const room = {
      id: 'room', topic: 'Auth', workspace: '/tmp', summary: '', summaryThroughSeq: 0,
      settings: {}, members: [member('alpha')],
    }
    await expect(registry.execute({
      room,
      member: room.members[0],
      turn: { id: 'turn', assignment: 'search' },
      snapshotSeq: 0,
      messages: [],
      resources: {
        fingerprint: 'reported-auth-resources', connectorGrants: [{ id: 'mail', access: 'read' }],
        mcpServers: { mail: { command: 'mail' } }, mcpServerNames: ['mail'],
        mcpServerAccess: { mail: 'read' }, mcpServerConnectors: { mail: 'qq-mail' },
        addDirs: [], environment: {}, skillCommands: [],
      },
      signal: new AbortController().signal,
    })).rejects.toThrow('连接器授权需要在连接器中心刷新: qq-mail')
    registry.disposeAll()
  })

  test('scopes cached sessions and aborts to room plus member identity', async () => {
    FakeClaudeSession.instances = []
    const registry = new GroupRoomRuntimeRegistry({
      getClaudeSessionCtor: async () => FakeClaudeSession,
      getSettings: () => ({ model: 'fake', advanced: {} }),
      buildThinkingConfig: () => ({ type: 'disabled' }),
      paths: { memberEngineDir: (roomId: string) => `/tmp/${roomId}` },
      requestPermission: async () => ({ behavior: 'allow' }),
    })
    const sharedMember = member('shared')
    const resources = {
      fingerprint: 'same-resources', connectorGrants: [], mcpServers: {}, mcpServerNames: [],
      mcpServerAccess: {}, mcpServerConnectors: {}, addDirs: [], environment: {}, skillCommands: [],
    }
    for (const roomId of ['room-a', 'room-b']) {
      await registry.execute({
        room: { id: roomId, topic: roomId, workspace: `/tmp/${roomId}`, summary: '', summaryThroughSeq: 0, settings: {}, members: [sharedMember] },
        member: sharedMember,
        turn: { id: `turn-${roomId}`, runId: `run-${roomId}`, assignment: 'work' },
        snapshotSeq: 0,
        messages: [],
        resources,
        signal: new AbortController().signal,
      })
    }
    expect(FakeClaudeSession.instances).toHaveLength(2)
    registry.abortMember('room-a', 'shared')
    expect(FakeClaudeSession.instances[0].aborted).toBe(true)
    expect(FakeClaudeSession.instances[1].aborted).toBe(false)
    registry.disposeAll()
  })

  test('uses full context at a new run boundary and delta only within the same run', async () => {
    FakeClaudeSession.instances = []
    const registry = new GroupRoomRuntimeRegistry({
      getClaudeSessionCtor: async () => FakeClaudeSession,
      getSettings: () => ({ model: 'fake', advanced: {} }),
      buildThinkingConfig: () => ({ type: 'disabled' }),
      paths: { memberEngineDir: () => '/tmp/context-member' },
      requestPermission: async () => ({ behavior: 'allow' }),
    })
    const participant = member('context-member')
    const room = { id: 'context-room', topic: 'Context', workspace: '/tmp', summary: '', summaryThroughSeq: 0, settings: {}, members: [participant] }
    const resources = {
      fingerprint: 'context-resources', connectorGrants: [], mcpServers: {}, mcpServerNames: [],
      mcpServerAccess: {}, mcpServerConnectors: {}, addDirs: [], environment: {}, skillCommands: [],
    }
    const message = (seq: number, content: string) => ({ seq, content, authorType: 'human', authorId: 'host', kind: 'message', status: 'completed', visibility: 'public' })
    await registry.execute({ room, member: participant, turn: { id: 'turn-1', runId: 'run-1', assignment: 'one' }, snapshotSeq: 1, messages: [message(1, 'first trigger')], resources, signal: new AbortController().signal })
    await registry.execute({ room, member: participant, turn: { id: 'turn-2', runId: 'run-2', assignment: 'two' }, snapshotSeq: 2, messages: [message(1, 'first trigger'), message(2, 'second trigger')], resources, signal: new AbortController().signal })
    await registry.execute({ room, member: participant, turn: { id: 'turn-3', runId: 'run-2', assignment: 'three' }, snapshotSeq: 3, messages: [message(1, 'first trigger'), message(2, 'second trigger'), message(3, 'new conclusion')], resources, signal: new AbortController().signal })

    const prompts = FakeClaudeSession.instances[0].prompts.map((prompt) => JSON.parse(prompt))
    expect(prompts[1].contextMode).toBe('full')
    expect(prompts[1].publicMessages.map((entry: any) => entry.content)).toEqual(['first trigger', 'second trigger'])
    expect(prompts[2].contextMode).toBe('delta')
    expect(prompts[2].publicMessages.map((entry: any) => entry.content)).toEqual(['new conclusion'])
    registry.disposeAll()
  })

  test('recovers an empty final response once without allowing more tools', async () => {
    FakeClaudeSession.instances = []
    const registry = new GroupRoomRuntimeRegistry({
      getClaudeSessionCtor: async () => EmptyThenConclusionClaudeSession,
      getSettings: () => ({ model: 'fake', advanced: {} }),
      buildThinkingConfig: () => ({ type: 'disabled' }),
      paths: { memberEngineDir: () => '/tmp/recovery-member' },
      requestPermission: async () => ({ behavior: 'allow' }),
    })
    const participant = member('recovery-member')
    const result = await registry.execute({
      room: { id: 'recovery-room', topic: 'Recovery', workspace: '/tmp', summary: '', summaryThroughSeq: 0, settings: {}, members: [participant] },
      member: participant,
      turn: { id: 'recovery-turn', runId: 'recovery-run', assignment: 'inspect' },
      snapshotSeq: 0,
      messages: [],
      resources: {
        fingerprint: 'recovery-resources', connectorGrants: [], mcpServers: {}, mcpServerNames: [],
        mcpServerAccess: {}, mcpServerConnectors: {}, addDirs: [], environment: {}, skillCommands: [],
      },
      signal: new AbortController().signal,
    })
    const session = FakeClaudeSession.instances[0] as EmptyThenConclusionClaudeSession
    expect(result.content).toBe('Recovered public conclusion.')
    expect(session.calls).toBe(2)
    expect(JSON.parse(session.prompts[1]).protocol).toBe('moss.group-room.conclusion-recovery.v1')
    expect(session.recoveryToolDecision).toEqual({ behavior: 'deny', message: 'Conclusion recovery does not allow tool use: Read' })
    expect(result.trace.some((event: any) => event.name === 'Read')).toBe(true)
    registry.disposeAll()
  })

  test('reviews continuous discussions with a tool-disabled convergence session', async () => {
    FakeClaudeSession.instances = []
    const registry = new GroupRoomRuntimeRegistry({
      getClaudeSessionCtor: async () => ConvergenceClaudeSession,
      getSettings: () => ({ model: 'fake', advanced: {} }),
      buildThinkingConfig: () => ({ type: 'disabled' }),
      paths: {
        memberEngineDir: () => '/tmp/member',
        roomDir: () => '/tmp/group-room-convergence',
      },
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const participant = member('reviewer')
    const decision = await registry.assessDiscussion({
      room: {
        id: 'convergence-room',
        topic: 'Resolve the design',
        workspace: '/tmp',
        members: [participant],
        messages: [{ authorType: 'agent', authorId: participant.id, content: 'Resolved conclusion.' }],
      },
      round: 2,
      memberIds: [participant.id],
      signal: new AbortController().signal,
    })

    expect(decision).toEqual({
      stable: true,
      reason: 'All material issues are resolved.',
      unresolvedIssues: [],
    })
    const session = FakeClaudeSession.instances[0] as ConvergenceClaudeSession
    expect(session.opts.maxTurns).toBe(1)
    expect(await session.opts.onToolUseValidation('Read')).toMatchObject({ behavior: 'deny' })
    expect(JSON.parse(session.prompts[0]).protocol).toBe('moss.group-room.convergence.v1')
    expect(session.disposed).toBe(true)
  })
})
