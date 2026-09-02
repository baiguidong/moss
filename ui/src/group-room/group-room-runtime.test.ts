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
    yield { type: 'result', usage: { input_tokens: this.prompts.length } }
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

class ModeratorClaudeSession extends FakeClaudeSession {
  async *send(prompt: string) {
    this.prompts.push(prompt)
    const input = JSON.parse(prompt)
    const decision = input.protocol === 'moss.group-room.moderator.v2' && this.prompts.length === 1
      ? { action: 'delegate', assignments: [{ memberId: 'reviewer', task: 'Verify the design' }], reason: 'Needs evidence' }
      : { action: 'respond', response: 'The design is verified.' }
    yield {
      type: 'assistant',
      message: { content: [{ type: 'text', text: JSON.stringify(decision) }] },
    }
    yield { type: 'result', usage: { input_tokens: this.prompts.length * 2 } }
  }
}

class RecoveringModeratorClaudeSession extends FakeClaudeSession {
  async *send(prompt: string) {
    this.prompts.push(prompt)
    const text = this.prompts.length === 1
      ? 'not json'
      : JSON.stringify({ action: 'respond', response: 'Recovered moderator response.' })
    yield { type: 'assistant', message: { content: [{ type: 'text', text }] } }
  }
}

class FailingModeratorClaudeSession extends FakeClaudeSession {
  async *send(prompt: string): AsyncGenerator<any> {
    this.prompts.push(prompt)
    throw new Error('transport unavailable')
  }
}

class FinalizingModeratorClaudeSession extends FakeClaudeSession {
  async *send(prompt: string) {
    this.prompts.push(prompt)
    yield {
      type: 'assistant',
      message: { content: [{ type: 'text', text: JSON.stringify({ action: 'respond', response: 'Best supported answer.' }) }] },
    }
    yield { type: 'result', usage: { input_tokens: 3 } }
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

  test('uses delta context across runs while the persistent member session remains valid', async () => {
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
    const first = await registry.execute({ room, member: participant, turn: { id: 'turn-1', runId: 'run-1', assignment: 'one' }, snapshotSeq: 1, messages: [message(1, 'first trigger')], resources, signal: new AbortController().signal })
    const second = await registry.execute({ room, member: participant, turn: { id: 'turn-2', runId: 'run-2', assignment: 'two' }, snapshotSeq: 2, messages: [message(1, 'first trigger'), message(2, 'second trigger')], resources, signal: new AbortController().signal })
    const third = await registry.execute({ room, member: participant, turn: { id: 'turn-3', runId: 'run-2', assignment: 'three' }, snapshotSeq: 3, messages: [message(1, 'first trigger'), message(2, 'second trigger'), message(3, 'new conclusion')], resources, signal: new AbortController().signal })

    const prompts = FakeClaudeSession.instances[0].prompts.map((prompt) => JSON.parse(prompt))
    expect(prompts[1].contextMode).toBe('delta')
    expect(prompts[1].publicMessages.map((entry: any) => entry.content)).toEqual(['second trigger'])
    expect(prompts[2].contextMode).toBe('delta')
    expect(prompts[2].publicMessages.map((entry: any) => entry.content)).toEqual(['new conclusion'])
    expect([first.usage, second.usage, third.usage]).toEqual([
      { input_tokens: 1 }, { input_tokens: 1 }, { input_tokens: 1 },
    ])
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

  test('bounds summarization input without dropping message identities', async () => {
    FakeClaudeSession.instances = []
    const registry = new GroupRoomRuntimeRegistry({
      getClaudeSessionCtor: async () => FakeClaudeSession,
      getSettings: () => ({ model: 'fake', advanced: {} }),
      buildThinkingConfig: () => ({ type: 'disabled' }),
      paths: { memberEngineDir: () => '/tmp/member', roomDir: () => '/tmp/group-room-summary' },
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const messages = [1, 2, 3, 4].map(seq => ({
      seq,
      authorType: 'human',
      authorId: 'user',
      content: `${seq}:${'x'.repeat(100_000)}:${seq}`,
    }))
    await registry.summarize({
      room: { id: 'summary-room', topic: 'Summarize', workspace: '/tmp' },
      previousSummary: 's'.repeat(150_000),
      messages,
    })

    const prompt = JSON.parse(FakeClaudeSession.instances[0].prompts[0])
    expect(prompt.previousSummary).toHaveLength(120_000)
    expect(prompt.publicMessages.map((message: any) => message.seq)).toEqual([1, 2, 3, 4])
    expect(prompt.publicMessages.reduce((total: number, message: any) => total + message.content.length, 0))
      .toBeLessThanOrEqual(200_000)
    expect(prompt.publicMessages[0].content).toContain('[middle truncated for summary]')
    registry.disposeAll()
  })

  test('keeps one tool-disabled moderator session that delegates and then answers', async () => {
    FakeClaudeSession.instances = []
    const registry = new GroupRoomRuntimeRegistry({
      getClaudeSessionCtor: async () => ModeratorClaudeSession,
      getSettings: () => ({ model: 'fake', advanced: {} }),
      buildThinkingConfig: () => ({ type: 'disabled' }),
      paths: {
        memberEngineDir: () => '/tmp/member',
        roomDir: () => '/tmp/group-room-moderator',
      },
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const participant = member('reviewer')
    const challenger = member('challenger')
    const room = {
      id: 'moderator-room',
      topic: 'Resolve the design',
      workspace: '/tmp',
      summary: 'Earlier context summary.',
      summaryThroughSeq: 1,
      settings: {
        maxAgentTurns: 12,
        maxModeratorSteps: 16,
        turnTimeoutMs: 900_000,
        runTimeoutMs: 2_700_000,
        tokenBudget: 0,
        moderatorInstructions: 'Use another expert when independent review adds value.',
      },
      members: [participant, challenger],
      messages: [{ id: 'old-message', seq: 1, authorType: 'human', authorId: 'user', kind: 'message', content: 'Earlier request.' }],
    }
    const first = await registry.moderate({
      room,
      run: { turns: [] },
      step: 1,
      signal: new AbortController().signal,
    })
    const second = await registry.moderate({
      room: {
        ...room,
        messages: [...room.messages, { id: 'result', seq: 2, authorType: 'agent', authorId: participant.id, kind: 'conclusion', content: 'Verified.' }],
      },
      run: {
        turns: [{
          memberId: participant.id,
          assignment: 'Verify the design',
          status: 'completed',
          outputMessageId: 'result',
          error: '',
        }],
      },
      step: 2,
      signal: new AbortController().signal,
    })

    expect(first.decision).toEqual({
      action: 'delegate',
      assignments: [{ memberId: 'reviewer', task: 'Verify the design' }],
      reason: 'Needs evidence',
    })
    expect(second.decision).toEqual({ action: 'respond', response: 'The design is verified.' })
    expect(second.usage).toEqual({ input_tokens: 2 })
    expect(FakeClaudeSession.instances).toHaveLength(1)
    const session = FakeClaudeSession.instances[0] as ModeratorClaudeSession
    expect(session.opts.maxTurns).toBe(1)
    expect(await session.opts.onToolUseValidation('Read')).toMatchObject({ behavior: 'deny' })
    expect(session.opts.customSystemPrompt).toContain('independent challenge')
    expect(JSON.parse(session.prompts[0]).protocol).toBe('moss.group-room.moderator.v2')
    expect(JSON.parse(session.prompts[0]).members.map((member: any) => member.id)).toEqual(['reviewer', 'challenger'])
    expect(JSON.parse(session.prompts[0]).moderatorInstructions).toContain('independent review')
    expect(JSON.parse(session.prompts[0]).operatingLimits).toMatchObject({
      memberMaxTurns: 12,
      moderatorStepLimit: 16,
      maxParallelAssignments: 3,
      tokenBudget: null,
    })
    expect(JSON.parse(session.prompts[1]).executionLedger[0]).toMatchObject({
      status: 'completed', result: 'Verified.',
    })
    expect(JSON.parse(session.prompts[1]).recentPublicMessages.map((message: any) => message.seq)).toEqual([2])
    expect(JSON.parse(session.prompts[1]).contextMode).toBe('delta')
    expect(JSON.parse(session.prompts[1]).summary).toBe('')
    expect(session.disposed).toBe(false)
    registry.disposeAll()
    expect(session.disposed).toBe(true)
  })

  test('recovers malformed moderator JSON once but does not retry transport failures', async () => {
    FakeClaudeSession.instances = []
    const dependencies = (Ctor: typeof FakeClaudeSession) => ({
      getClaudeSessionCtor: async () => Ctor,
      getSettings: () => ({ model: 'fake', advanced: {} }),
      buildThinkingConfig: () => ({ type: 'disabled' }),
      paths: { memberEngineDir: () => '/tmp/member', roomDir: () => '/tmp/group-room-moderator-recovery' },
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const participant = member('reviewer')
    const room = {
      id: 'recovery-moderator-room', topic: 'Recover JSON', workspace: '/tmp', summary: '',
      members: [participant], messages: [],
    }
    const recovering = new GroupRoomRuntimeRegistry(dependencies(RecoveringModeratorClaudeSession))
    const result = await recovering.moderate({
      room, run: { turns: [] }, step: 1, signal: new AbortController().signal,
    })
    expect(result.decision).toEqual({ action: 'respond', response: 'Recovered moderator response.' })
    expect((FakeClaudeSession.instances[0] as RecoveringModeratorClaudeSession).prompts).toHaveLength(2)
    expect(JSON.parse((FakeClaudeSession.instances[0] as RecoveringModeratorClaudeSession).prompts[1]).protocol)
      .toBe('moss.group-room.moderator-format-recovery.v1')
    recovering.disposeAll()

    FakeClaudeSession.instances = []
    const failing = new GroupRoomRuntimeRegistry(dependencies(FailingModeratorClaudeSession))
    await expect(failing.moderate({
      room: { ...room, id: 'failing-moderator-room' },
      run: { turns: [] },
      step: 1,
      signal: new AbortController().signal,
    })).rejects.toThrow('transport unavailable')
    expect((FakeClaudeSession.instances[0] as FailingModeratorClaudeSession).prompts).toHaveLength(1)
    failing.disposeAll()
  })

  test('does not expose the internal force-finish field to the moderator model', async () => {
    FakeClaudeSession.instances = []
    const registry = new GroupRoomRuntimeRegistry({
      getClaudeSessionCtor: async () => FinalizingModeratorClaudeSession,
      getSettings: () => ({ model: 'fake', advanced: {} }),
      buildThinkingConfig: () => ({ type: 'disabled' }),
      paths: { memberEngineDir: () => '/tmp/member', roomDir: () => '/tmp/group-room-finalizing' },
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const participant = member('reviewer')
    await registry.moderate({
      room: {
        id: 'finalizing-room', topic: 'Finish safely', workspace: '/tmp', summary: '', summaryThroughSeq: 0,
        members: [participant], messages: [],
      },
      run: { id: 'run', turns: [] },
      step: 2,
      forceFinish: true,
      signal: new AbortController().signal,
    })

    const session = FakeClaudeSession.instances[0] as FinalizingModeratorClaudeSession
    expect(session.prompts[0]).not.toContain('forceFinish')
    expect(JSON.parse(session.prompts[0]).allowedActions).toEqual(['respond'])
    expect(session.opts.customSystemPrompt).not.toContain('forceFinish')
    registry.disposeAll()
  })
})
