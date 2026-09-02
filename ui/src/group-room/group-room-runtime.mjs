import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { GROUP_ROOM_CONTRACT, buildRoomTurnPrompt } from './group-room-context.mjs';
import {
  CONNECTOR_AUTH_REQUIRED_PREFIX,
  createRoomToolPolicy,
  extractAssistantText,
  extractStableTraceEvents,
  extractStreamDelta,
  extractUsage,
} from './group-room-policy.mjs';

function promptHash(prompt) {
  return createHash('sha256').update(prompt).digest('hex');
}

function runtimeKey(roomId, memberId) {
  return `${roomId}:${memberId}`;
}

function memberSystemPrompt(member) {
  return [
    member.teamCharterSnapshot
      ? `Shared expert-team charter:\n${member.teamCharterSnapshot}`
      : '',
    `Your participant role:\n${member.promptSnapshot}`,
  ].filter(Boolean).join('\n\n');
}

function connectorIdForTool(toolName, input, resources) {
  if (toolName === 'ListMcpResourcesTool' || toolName === 'ReadMcpResourceTool') {
    const server = String(input?.server || '').trim();
    return server ? resources?.mcpServerConnectors?.[server] || null : null;
  }
  const match = /^mcp__([^_].*?)__/.exec(String(toolName || ''));
  return match ? resources?.mcpServerConnectors?.[match[1]] || null : null;
}

function connectorAuthFailure(trace, resources) {
  for (const event of trace) {
    if (event?.type !== 'tool_result' || event.isError !== true) continue;
    const content = typeof event.content === 'string' ? event.content : JSON.stringify(event.content);
    const index = content.indexOf(CONNECTOR_AUTH_REQUIRED_PREFIX);
    if (index < 0) continue;
    const server = content.slice(index + CONNECTOR_AUTH_REQUIRED_PREFIX.length).match(/^[A-Za-z0-9._-]+/)?.[0] || 'unknown';
    return resources?.mcpServerConnectors?.[server] || server;
  }
  return '';
}

function connectorAuthFailureFromText(content, resources) {
  const match = String(content || '').trim().match(/^GROUP_ROOM_CONNECTOR_AUTH_REQUIRED:([A-Za-z0-9._-]+)/);
  if (!match) return '';
  return resources?.mcpServerConnectors?.[match[1]] || match[1];
}

function withExecutionDetails(error, trace, usage) {
  const result = error instanceof Error ? error : new Error(String(error || 'Group Room execution failed.'));
  result.roomTrace = trace;
  result.roomUsage = usage;
  return result;
}

export function resolveRoomPermissionPolicy(room, settings) {
  const configured = room?.settings?.permissionMode;
  if (configured === 'ask') {
    return { configured: 'ask', effective: 'default', forceRoomConfirmation: true };
  }
  if (configured === 'allow-all') {
    return { configured: 'allow-all', effective: 'allow-all', forceRoomConfirmation: false };
  }
  return {
    configured: 'inherit',
    effective: settings?.bypassPermissions ? 'allow-all' : 'default',
    forceRoomConfirmation: false,
  };
}

export class GroupRoomRuntimeRegistry {
  #entries = new Map();
  #deps;

  constructor(dependencies) {
    this.#deps = dependencies || {};
  }

  async #ensure(room, member, resources) {
    const settings = this.#deps.getSettings();
    const permissionPolicy = resolveRoomPermissionPolicy(room, settings);
    const runtimeFingerprint = `${resources.fingerprint}:${permissionPolicy.configured}:${permissionPolicy.effective}`;
    const key = runtimeKey(room.id, member.id);
    const existing = this.#entries.get(key);
    if (existing?.fingerprint === runtimeFingerprint) return existing;
    if (existing) this.disposeMember(room.id, member.id);

    const ClaudeSession = await this.#deps.getClaudeSessionCtor();
    const policy = createRoomToolPolicy(resources);
    const executionState = { conclusionOnly: false };
    const projectDir = this.#deps.paths.memberEngineDir(room.id, member.id);
    const session = new ClaudeSession({
      cwd: room.workspace,
      model: settings.model,
      url: settings.url || undefined,
      apiKey: settings.apiKey || undefined,
      customSystemPrompt: memberSystemPrompt(member),
      appendSystemPrompt: [settings.appendSystemPrompt, GROUP_ROOM_CONTRACT].filter(Boolean).join('\n\n'),
      maxTurns: Math.max(1, Math.min(50, Number(room.settings?.maxAgentTurns) || 12)),
      thinkingConfig: this.#deps.buildThinkingConfig(settings),
      permissionMode: permissionPolicy.effective,
      coordinatorMode: false,
      mcpServers: resources.mcpServers,
      addDirs: resources.addDirs,
      workspaceDirectories: [room.workspace],
      environment: {
        ...resources.environment,
        MOSS_RUNTIME_ADVANCED_SETTINGS: JSON.stringify(settings.advanced || {}),
        MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: false }),
        MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }),
      },
      projectDir,
      taskScope: { kind: 'session', sessionId: `group_${room.id}_${member.id}` },
      onToolUseValidation: async (toolName, input, metadata) => (
        executionState.conclusionOnly
          ? { behavior: 'deny', message: `Conclusion recovery does not allow tool use: ${toolName}` }
          : policy.validate(toolName, input, metadata)
      ),
      shouldForceToolPermission: async (toolName, input, metadata) => (
        permissionPolicy.forceRoomConfirmation
          ? policy.shouldForcePermission(toolName, input, metadata)
          : false
      ),
      onPermissionRequest: async (toolName, input, request) => this.#deps.requestPermission({
        roomId: room.id,
        memberId: member.id,
        connectorId: connectorIdForTool(toolName, input, resources),
        toolName,
        input,
        request,
      }),
    });
    const entry = {
      session,
      fingerprint: runtimeFingerprint,
      lastSnapshotSeq: 0,
      lastRunId: '',
      lastSummaryThroughSeq: 0,
      executionState,
    };
    this.#entries.set(key, entry);
    this.#deps.onRuntimeSession?.(member.id, session.sessionId);
    return entry;
  }

  async execute({ room, member, turn, snapshotSeq, messages, resources, signal, onEvent }) {
    const entry = await this.#ensure(room, member, resources);
    const prompt = buildRoomTurnPrompt({
      room,
      member,
      turn,
      messages,
      snapshotSeq,
      afterSeq: entry.lastRunId === turn.runId
        && entry.lastSummaryThroughSeq === (Number(room.summaryThroughSeq) || 0)
        ? entry.lastSnapshotSeq
        : 0,
    });
    const trace = [];
    let latestText = '';
    let streamedText = '';
    let usage = null;
    let streamOffset = 0;
    let traceOffset = 0;

    try {
      for await (const message of entry.session.send(prompt, signal)) {
        const text = extractAssistantText(message);
        if (text) latestText = text;
        const delta = extractStreamDelta(message);
        if (delta) {
          streamedText += delta;
          streamOffset += 1;
          onEvent?.({ type: 'text-delta', delta, streamOffset });
        }
        for (const event of extractStableTraceEvents(message)) {
          trace.push(event);
          traceOffset += 1;
          onEvent?.({ type: 'trace', event, traceOffset });
        }
        usage = extractUsage(message) || usage;
      }
    } catch (error) {
      throw withExecutionDetails(error, trace, usage);
    }

    let content = (latestText || streamedText).trim();
    let connectorId = connectorAuthFailure(trace, resources)
      || connectorAuthFailureFromText(content, resources);
    if (connectorId) {
      throw withExecutionDetails(
        new Error(`连接器授权需要在连接器中心刷新: ${connectorId}`),
        trace,
        usage,
      );
    }
    if (!content) {
      entry.executionState.conclusionOnly = true;
      latestText = '';
      streamedText = '';
      try {
        const recoveryPrompt = JSON.stringify({
          protocol: 'moss.group-room.conclusion-recovery.v1',
          instruction: 'Your previous turn completed without a public conclusion. Do not call tools or repeat the task. Using only the evidence already in this session, return the concise public conclusion now.',
          assignment: turn.assignment,
        });
        for await (const message of entry.session.send(recoveryPrompt, signal)) {
          const text = extractAssistantText(message);
          if (text) latestText = text;
          const delta = extractStreamDelta(message);
          if (delta) {
            streamedText += delta;
            streamOffset += 1;
            onEvent?.({ type: 'text-delta', delta, streamOffset });
          }
          for (const event of extractStableTraceEvents(message)) {
            trace.push(event);
            traceOffset += 1;
            onEvent?.({ type: 'trace', event, traceOffset });
          }
          usage = extractUsage(message) || usage;
        }
      } catch (error) {
        throw withExecutionDetails(error, trace, usage);
      } finally {
        entry.executionState.conclusionOnly = false;
      }
      content = (latestText || streamedText).trim();
      connectorId = connectorAuthFailure(trace, resources)
        || connectorAuthFailureFromText(content, resources);
      if (connectorId) {
        throw withExecutionDetails(
          new Error(`连接器授权需要在连接器中心刷新: ${connectorId}`),
          trace,
          usage,
        );
      }
      if (!content) {
        throw withExecutionDetails(
          new Error('Room member returned no public conclusion after a no-tool recovery prompt.'),
          trace,
          usage,
        );
      }
    }
    entry.lastSnapshotSeq = snapshotSeq;
    entry.lastRunId = turn.runId;
    entry.lastSummaryThroughSeq = Number(room.summaryThroughSeq) || 0;
    return { content, trace, usage, promptHash: promptHash(prompt) };
  }

  async summarize({ room, previousSummary, messages }) {
    const ClaudeSession = await this.#deps.getClaudeSessionCtor();
    const settings = this.#deps.getSettings();
    const summaryDir = path.join(this.#deps.paths.roomDir(room.id), 'summary-engine');
    await fsp.mkdir(summaryDir, { recursive: true });
    const session = new ClaudeSession({
      cwd: room.workspace,
      model: settings.model,
      url: settings.url || undefined,
      apiKey: settings.apiKey || undefined,
      customSystemPrompt: 'Summarize a Group Room transcript. Return only a compact factual summary. Preserve decisions, disagreements, evidence, open questions, and named responsibilities. Never call tools.',
      appendSystemPrompt: '',
      maxTurns: 1,
      thinkingConfig: { type: 'disabled' },
      permissionMode: 'default',
      coordinatorMode: false,
      mcpServers: {},
      addDirs: [],
      workspaceDirectories: [room.workspace],
      environment: {
        MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: false }),
        MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }),
      },
      projectDir: summaryDir,
      taskScope: { kind: 'session', sessionId: `group_summary_${room.id}` },
      onToolUseValidation: async (toolName) => ({
        behavior: 'deny',
        message: `Group Room summarization does not allow tool use: ${toolName}`,
      }),
      onPermissionRequest: async () => ({ behavior: 'deny', message: 'Group Room summarization does not allow tool use.' }),
    });
    let latestText = '';
    let streamedText = '';
    try {
      const prompt = JSON.stringify({
        protocol: 'moss.group-room.summary.v1',
        topic: room.topic,
        previousSummary: previousSummary || '',
        publicMessages: messages.map((message) => ({
          seq: message.seq,
          authorType: message.authorType,
          authorId: message.authorId,
          content: message.content,
        })),
      });
      for await (const message of session.send(prompt)) {
        latestText = extractAssistantText(message) || latestText;
        streamedText += extractStreamDelta(message);
      }
      const summary = (latestText || streamedText).trim();
      if (!summary) throw new Error('Summary runtime returned no content.');
      return summary;
    } finally {
      try { session.dispose(); } catch {}
    }
  }

  async suggestModeration({ room, content }) {
    const ClaudeSession = await this.#deps.getClaudeSessionCtor();
    const settings = this.#deps.getSettings();
    const moderatorDir = path.join(this.#deps.paths.roomDir(room.id), 'moderator-engine');
    await fsp.mkdir(moderatorDir, { recursive: true });
    const session = new ClaudeSession({
      cwd: room.workspace,
      model: settings.model,
      url: settings.url || undefined,
      apiKey: settings.apiKey || undefined,
      customSystemPrompt: 'You are a Group Room moderator. Return only valid JSON matching the requested schema. Select suitable participants and give each a concrete, non-overlapping assignment. Never call tools.',
      maxTurns: 1,
      thinkingConfig: { type: 'disabled' },
      permissionMode: 'default',
      coordinatorMode: false,
      mcpServers: {},
      addDirs: [],
      workspaceDirectories: [room.workspace],
      environment: {
        MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: false }),
        MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }),
      },
      projectDir: moderatorDir,
      taskScope: { kind: 'session', sessionId: `group_moderator_${room.id}` },
      onToolUseValidation: async (toolName) => ({ behavior: 'deny', message: `Moderator tools are disabled: ${toolName}` }),
      onPermissionRequest: async () => ({ behavior: 'deny', message: 'Moderator tools are disabled.' }),
    });
    let latestText = '';
    let streamedText = '';
    try {
      const prompt = JSON.stringify({
        protocol: 'moss.group-room.moderator.v1',
        topic: room.topic,
        hostMessage: content,
        recentPublicMessages: room.messages.slice(-20).map((message) => ({
          authorId: message.authorId,
          content: message.content,
        })),
        members: room.members.map((member) => ({ id: member.id, name: member.displayName, role: member.role })),
        outputSchema: {
          mode: 'conversation | parallel',
          assignments: [{ memberId: 'member id', task: 'specific task' }],
          reason: 'brief selection rationale',
        },
      });
      for await (const message of session.send(prompt)) {
        latestText = extractAssistantText(message) || latestText;
        streamedText += extractStreamDelta(message);
      }
      const raw = (latestText || streamedText).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      return JSON.parse(raw);
    } finally {
      try { session.dispose(); } catch {}
    }
  }

  async assessDiscussion({ room, round, memberIds, signal }) {
    const ClaudeSession = await this.#deps.getClaudeSessionCtor();
    const settings = this.#deps.getSettings();
    const moderatorDir = path.join(this.#deps.paths.roomDir(room.id), 'moderator-engine');
    await fsp.mkdir(moderatorDir, { recursive: true });
    const session = new ClaudeSession({
      cwd: room.workspace,
      model: settings.model,
      url: settings.url || undefined,
      apiKey: settings.apiKey || undefined,
      customSystemPrompt: 'You are a strict Group Room convergence reviewer. Return only valid JSON. Mark stable true only when the host request is answered, material disagreements are resolved, evidence is adequate, and no actionable issue remains. Never call tools.',
      maxTurns: 1,
      thinkingConfig: { type: 'disabled' },
      permissionMode: 'default',
      coordinatorMode: false,
      mcpServers: {},
      addDirs: [],
      workspaceDirectories: [room.workspace],
      environment: {
        MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify({ enabled: false }),
        MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }),
      },
      projectDir: moderatorDir,
      taskScope: { kind: 'session', sessionId: `group_convergence_${room.id}_${round}` },
      onToolUseValidation: async (toolName) => ({ behavior: 'deny', message: `Convergence review tools are disabled: ${toolName}` }),
      onPermissionRequest: async () => ({ behavior: 'deny', message: 'Convergence review tools are disabled.' }),
    });
    let latestText = '';
    let streamedText = '';
    try {
      const selected = new Set(memberIds);
      const prompt = JSON.stringify({
        protocol: 'moss.group-room.convergence.v1',
        topic: room.topic,
        completedRound: round,
        recentPublicMessages: room.messages
          .filter((message) => message.authorType !== 'agent' || selected.has(message.authorId))
          .slice(-Math.max(30, memberIds.length * 3))
          .map((message) => ({
            authorType: message.authorType,
            authorId: message.authorId,
            content: message.content,
          })),
        outputSchema: {
          stable: 'boolean',
          reason: 'brief factual reason',
          unresolvedIssues: ['material unresolved issue'],
        },
      });
      for await (const message of session.send(prompt, signal)) {
        latestText = extractAssistantText(message) || latestText;
        streamedText += extractStreamDelta(message);
      }
      const raw = (latestText || streamedText).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(raw);
      const unresolvedIssues = Array.isArray(parsed?.unresolvedIssues)
        ? parsed.unresolvedIssues.map((issue) => String(issue || '').trim()).filter(Boolean).slice(0, 20)
        : [];
      return {
        stable: parsed?.stable === true && unresolvedIssues.length === 0,
        reason: String(parsed?.reason || '').slice(0, 2_000),
        unresolvedIssues,
      };
    } finally {
      try { session.dispose(); } catch {}
    }
  }

  abortMember(roomId, memberId) {
    try { this.#entries.get(runtimeKey(roomId, memberId))?.session.abort(); } catch {}
  }

  disposeMember(roomId, memberId) {
    const key = runtimeKey(roomId, memberId);
    const entry = this.#entries.get(key);
    this.#entries.delete(key);
    try { entry?.session.dispose(); } catch {}
  }

  disposeRoom(room) {
    for (const member of room?.members || []) this.disposeMember(room.id, member.id);
  }

  disposeAll() {
    for (const entry of this.#entries.values()) {
      try { entry.session.dispose(); } catch {}
    }
    this.#entries.clear();
  }
}
