import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';

import { redactRoomValue } from './group-room-policy.mjs';
import { PausableDeadline } from './group-room-timeout.mjs';

class RoomCommandQueue {
  #tails = new Map();

  run(roomId, command) {
    const previous = this.#tails.get(roomId) || Promise.resolve();
    const next = previous.catch(() => {}).then(command);
    const tail = next.catch(() => {}).finally(() => {
      if (this.#tails.get(roomId) === tail) this.#tails.delete(roomId);
    });
    this.#tails.set(roomId, tail);
    return next;
  }
}

function sourceKey(member) {
  return `${member.source.kind}:${member.source.id}:${member.source.memberId || ''}`;
}

function normalizeConnectorGrants(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const grants = [];
  for (const raw of value) {
    const id = String(raw?.id || raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const access = raw?.access === 'write' ? 'write' : 'read';
    grants.push({
      id,
      access,
      exec: access === 'write' && raw?.exec === true,
    });
  }
  return grants;
}

function publicMember(member) {
  const {
    promptSnapshot: _promptSnapshot,
    teamCharterSnapshot: _teamCharterSnapshot,
    resourceSnapshot,
    ...safeMember
  } = member;
  return {
    ...safeMember,
    resourceSnapshot: {
      assistantName: resourceSnapshot?.assistantName || member.source.id,
      enabledSkills: resourceSnapshot?.enabledSkills || [],
      skillCommands: resourceSnapshot?.skillCommands || [],
      sourceType: resourceSnapshot?.sourceType || 'local',
      sourceHash: resourceSnapshot?.sourceHash || member.source.hash || '',
    },
  };
}

function runError(error) {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown Group Room error');
}

function safeRunError(error) {
  return String(redactRoomValue(runError(error)));
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizePermissionMode(value) {
  return value === 'ask' || value === 'allow-all' ? value : 'inherit';
}

function discussionAssignment(base, round, { policy = 'fixed', rounds = 1 } = {}) {
  if (policy === 'fixed' && rounds <= 1) return base;
  const roundLabel = policy === 'until-stable' ? `${round}` : `${round}/${rounds}`;
  if (round === 1) {
    return [
      `[讨论第 ${roundLabel} 轮：独立分析]`,
      base,
      '给出可核验的证据、主要判断和具体方案；先形成自己的观点，不要只复述题目。',
    ].join('\n');
  }
  return [
    `[讨论第 ${roundLabel} 轮：质疑、补充并收敛]`,
    base,
    '阅读房间内前面所有成员的结论，明确指出至少一项你赞同的证据和一项需要质疑或补充的内容。',
    policy === 'fixed' && round === rounds
      ? '最后给出吸收争议后的修订结论、风险和可执行下一步。'
      : '给出修订观点，并明确列出仍未解决的问题；如果已经没有实质问题，请明确说明依据。',
  ].join('\n');
}

function tokenUsage(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  return Object.entries(usage).reduce((total, [key, value]) => (
    /token/i.test(key) && typeof value === 'number' && Number.isFinite(value)
      ? total + Math.max(0, value)
      : total
  ), 0);
}

export class GroupRoomController {
  #store;
  #catalog;
  #runtime;
  #scheduler;
  #emit;
  #commands = new RoomCommandQueue();
  #active = new Map();
  #permissions = new Map();
  #disposed = false;

  constructor({ store, catalog, runtime, scheduler, emit }) {
    this.#store = store;
    this.#catalog = catalog;
    this.#runtime = runtime;
    this.#scheduler = scheduler;
    this.#emit = typeof emit === 'function' ? emit : () => {};
  }

  listRooms() {
    return this.#store.listRooms().map((room) => ({
      ...room,
      members: this.#store.listMembers(room.id).map(publicMember),
    }));
  }

  getRoom(roomId) {
    return this.#publicRoom(this.#store.getRoom(roomId));
  }

  async listResources() {
    const [inviteables, connectors, skills] = await Promise.all([
      this.#catalog.listInviteables(),
      this.#catalog.listConnectors(),
      this.#catalog.listSkills(),
    ]);
    return { inviteables, connectors, skills };
  }

  listPendingPermissions() {
    return [...this.#permissions.entries()].map(([requestId, pending]) => ({
      requestId,
      roomId: pending.roomId,
      roomTitle: pending.roomTitle,
      memberId: pending.memberId,
      memberName: pending.memberName,
      connectorId: pending.connectorId || null,
      turnId: pending.turnId || null,
      toolName: pending.toolName,
      input: redactRoomValue(pending.input),
      readOnly: pending.readOnly,
      requestedAt: pending.requestedAt,
    }));
  }

  async createRoom(input) {
    const workspace = String(input?.workspace || '').trim();
    let workspaceStat;
    try { workspaceStat = await fsp.stat(workspace); } catch {}
    if (!workspaceStat?.isDirectory()) throw new Error('Select an existing workspace directory.');
    const invitationIds = Array.isArray(input?.invitationIds) ? input.invitationIds : [];
    const [invitedMembers, customMembers] = await Promise.all([
      invitationIds.length > 0 ? this.#catalog.resolveInvitations(invitationIds) : [],
      this.#catalog.resolveCustomMembers(input?.customMembers),
    ]);
    const members = [...invitedMembers, ...customMembers];
    if (members.length < 2) throw new Error('A Group Room requires at least two participants.');
    if (members.length > 32) throw new Error('A Group Room supports at most 32 participants.');
    const memberNames = new Set();
    for (const member of members) {
      const key = member.displayName.trim().toLocaleLowerCase();
      if (memberNames.has(key)) throw new Error(`Room member names must be unique: ${member.displayName}`);
      memberNames.add(key);
    }
    const defaultConnectorGrants = await this.#validateConnectorGrants(input?.connectorGrants);
    const bySource = input?.memberConnectorGrants && typeof input.memberConnectorGrants === 'object'
      ? input.memberConnectorGrants
      : {};
    for (const member of members) {
      member.grants = {
        ...member.grants,
        connectors: Object.prototype.hasOwnProperty.call(bySource, sourceKey(member))
          ? await this.#validateConnectorGrants(bySource[sourceKey(member)])
          : defaultConnectorGrants,
      };
    }
    const room = this.#store.createRoom({
      title: input?.title,
      topic: input?.topic,
      workspace,
      settings: {
        maxAgentTurns: Math.max(1, Math.min(50, Number(input?.settings?.maxAgentTurns) || 12)),
        mode: input?.settings?.mode === 'parallel' ? 'parallel' : 'conversation',
        permissionMode: normalizePermissionMode(input?.settings?.permissionMode),
        discussionPolicy: input?.settings?.discussionPolicy === 'until-stable' ? 'until-stable' : 'fixed',
        discussionRounds: clampNumber(input?.settings?.discussionRounds, 2, 1, 100),
        turnTimeoutMs: clampNumber(input?.settings?.turnTimeoutMs, 15 * 60_000, 30_000, 30 * 60_000),
        runTimeoutMs: clampNumber(input?.settings?.runTimeoutMs, 45 * 60_000, 60_000, 90 * 60_000),
        tokenBudget: clampNumber(input?.settings?.tokenBudget, 120_000, 1_000, 2_000_000),
        summaryThresholdChars: clampNumber(input?.settings?.summaryThresholdChars, 120_000, 40_000, 1_000_000),
      },
      members,
    });
    this.#emitSnapshot(room.id, 'room-created');
    return this.#publicRoom(room);
  }

  updateRoom(roomId, updates, expectedRevision) {
    return this.#commands.run(roomId, async () => {
      if (this.#active.has(roomId)) throw new Error('Cannot change room configuration while a run is active.');
      const current = this.#store.getRoom(roomId);
      const safeUpdates = {};
      if (updates?.title !== undefined) safeUpdates.title = updates.title;
      if (updates?.topic !== undefined) safeUpdates.topic = updates.topic;
      if (updates?.settings !== undefined) {
        const settings = { ...current.settings, ...(updates.settings || {}) };
        safeUpdates.settings = {
          maxAgentTurns: Math.max(1, Math.min(50, Number(settings.maxAgentTurns) || 12)),
          mode: settings.mode === 'parallel' ? 'parallel' : 'conversation',
          permissionMode: normalizePermissionMode(settings.permissionMode),
          discussionPolicy: settings.discussionPolicy === 'until-stable' ? 'until-stable' : 'fixed',
          discussionRounds: clampNumber(settings.discussionRounds, 2, 1, 100),
          turnTimeoutMs: clampNumber(settings.turnTimeoutMs, 15 * 60_000, 30_000, 30 * 60_000),
          runTimeoutMs: clampNumber(settings.runTimeoutMs, 45 * 60_000, 60_000, 90 * 60_000),
          tokenBudget: clampNumber(settings.tokenBudget, 120_000, 1_000, 2_000_000),
          summaryThresholdChars: clampNumber(settings.summaryThresholdChars, 120_000, 40_000, 1_000_000),
        };
      }
      if (Object.keys(safeUpdates).length === 0) return this.#publicRoom(current);
      const room = this.#store.updateRoom(roomId, safeUpdates, expectedRevision);
      this.#emitSnapshot(room.id, 'room-updated');
      return this.#publicRoom(room);
    });
  }

  async updateMemberGrants(roomId, memberId, grants, expectedRevision) {
    return this.#commands.run(roomId, async () => {
      if (this.#active.has(roomId)) throw new Error('Cannot change member resources while a room run is active.');
      const existing = this.#store.getRoom(roomId).members.find((member) => member.id === memberId);
      if (!existing) throw new Error(`Room member not found: ${memberId}`);
      const allowedSkills = new Set(existing.resourceSnapshot?.skillCommands || []);
      const requestedSkills = [...new Set(Array.isArray(grants?.skills) ? grants.skills.map(String) : [])];
      const unknownSkills = requestedSkills.filter((skill) => !allowedSkills.has(skill));
      if (unknownSkills.length > 0) throw new Error(`Skills are not assigned to this room member: ${unknownSkills.join(', ')}`);
      const room = this.#store.updateMemberGrants(roomId, memberId, {
        connectors: await this.#validateConnectorGrants(grants?.connectors),
        skills: requestedSkills,
      }, expectedRevision);
      this.#runtime.disposeMember(roomId, memberId);
      this.#emitSnapshot(room.id, 'member-resources-updated');
      return this.#publicRoom(room);
    });
  }

  async refreshMemberSource(roomId, memberId, expectedRevision) {
    return this.#commands.run(roomId, async () => {
      if (this.#active.has(roomId)) throw new Error('Cannot refresh a member while a room run is active.');
      const room = this.#store.getRoom(roomId);
      const member = room.members.find((entry) => entry.id === memberId);
      if (!member) throw new Error(`Room member not found: ${memberId}`);
      const snapshot = await this.#catalog.resolveMemberSource(member);
      const updated = this.#store.updateMemberSnapshot(roomId, memberId, snapshot, expectedRevision);
      this.#runtime.disposeMember(roomId, memberId);
      this.#emitSnapshot(roomId, 'member-source-refreshed');
      return this.#publicRoom(updated);
    });
  }

  async dispatch(roomId, input) {
    return this.#commands.run(roomId, async () => {
      if (this.#active.has(roomId) || this.#store.getActiveRun(roomId)) {
        throw new Error('The Group Room is already running. Intervene or stop it first.');
      }
      const room = this.#store.getRoom(roomId);
      const memberIds = Array.isArray(input?.memberIds) && input.memberIds.length > 0
        ? [...new Set(input.memberIds.map(String))]
        : [room.members[0]?.id].filter(Boolean);
      const members = new Map(room.members.map((member) => [member.id, member]));
      for (const memberId of memberIds) {
        if (!members.has(memberId)) throw new Error(`Room member not found: ${memberId}`);
      }
      const content = String(input?.content || '').trim();
      if (!content) throw new Error('A host message or assignment is required.');
      const mode = input?.mode === 'parallel' && memberIds.length > 1 ? 'parallel' : 'conversation';
      const untilStable = mode === 'conversation'
        && memberIds.length > 1
        && (input?.untilStable === true || (
          input?.untilStable === undefined && room.settings?.discussionPolicy === 'until-stable'
        ));
      const rounds = mode === 'conversation' && memberIds.length > 1
        ? clampNumber(input?.rounds, clampNumber(room.settings?.discussionRounds, 2, 1, 100), 1, 100)
        : 1;
      const discussionPolicy = untilStable ? 'until-stable' : 'fixed';
      await this.#compactContextIfNeeded(roomId);
      const trigger = this.#store.addMessage(roomId, {
        authorType: 'human',
        authorId: 'host',
        audience: memberIds,
        kind: 'message',
        content,
      });
      const assignments = input?.assignments && typeof input.assignments === 'object'
        ? input.assignments
        : {};
      const turns = memberIds.map((memberId) => {
        const base = String(assignments[memberId] || content).trim();
        return {
          memberId,
          assignment: discussionAssignment(base, 1, { policy: discussionPolicy, rounds }),
        };
      });
      const run = this.#store.createRun(roomId, {
        mode,
        triggerMessageId: trigger.id,
        turns,
      });
      const control = {
        runId: run.id,
        abortController: new AbortController(),
        softIntervention: null,
        hardIntervention: null,
        stoppedMemberIds: new Set(),
        activeMemberIds: new Set(),
        activeTurnIds: new Map(),
        totalTokens: 0,
        tokenBudget: clampNumber(room.settings?.tokenBudget, 120_000, 1_000, 2_000_000),
        budgetReached: false,
        abortReason: '',
        runDeadline: null,
        turnDeadlines: new Map(),
        permissionWaitCounts: new Map(),
        totalPermissionWaits: 0,
        assessingConvergence: false,
        discussion: mode === 'conversation' && memberIds.length > 1 ? {
          policy: discussionPolicy,
          targetRounds: rounds,
          currentRound: 1,
          memberIds,
          assignments: Object.fromEntries(memberIds.map((memberId) => [
            memberId,
            String(assignments[memberId] || content).trim(),
          ])),
        } : null,
        finished: null,
      };
      const runTimeoutMs = clampNumber(room.settings?.runTimeoutMs, 45 * 60_000, 60_000, 90 * 60_000);
      control.runDeadline = new PausableDeadline(runTimeoutMs, () => {
        control.abortReason = 'Group Room run timed out';
        control.abortController.abort(new Error(control.abortReason));
        for (const memberId of control.activeMemberIds) this.#runtime.abortMember(roomId, memberId);
        this.#rejectRoomPermissions(roomId, control.abortReason);
      });
      this.#active.set(roomId, control);
      this.#emitSnapshot(roomId, 'run-started');
      control.finished = this.#executeRun(roomId, run.id, control);
      void control.finished.catch(() => {});
      return this.#store.getRun(run.id);
    });
  }

  async suggestModeration(roomId, content) {
    return this.#commands.run(roomId, async () => {
      if (this.#active.has(roomId)) throw new Error('Cannot plan a new dispatch while the room is running.');
      const room = this.#store.getRoom(roomId);
      const hostMessage = String(content || '').trim();
      if (!hostMessage) throw new Error('Enter a discussion request before asking the moderator.');
      const raw = await this.#runtime.suggestModeration({ room, content: hostMessage });
      const memberIds = new Set(room.members.map((member) => member.id));
      const assignments = Array.isArray(raw?.assignments) ? raw.assignments : [];
      const normalized = [];
      const seen = new Set();
      for (const assignment of assignments) {
        const memberId = String(assignment?.memberId || '').trim();
        const task = String(assignment?.task || '').trim();
        if (!memberIds.has(memberId) || !task || seen.has(memberId)) continue;
        seen.add(memberId);
        normalized.push({ memberId, task: task.slice(0, 10_000) });
      }
      if (normalized.length === 0) throw new Error('Moderator returned no valid member assignments.');
      return {
        mode: raw?.mode === 'parallel' && normalized.length > 1 ? 'parallel' : 'conversation',
        assignments: normalized,
        reason: String(raw?.reason || '').slice(0, 2_000),
      };
    });
  }

  async intervene(roomId, { content, mode = 'soft' } = {}) {
    return this.#commands.run(roomId, async () => {
      const text = String(content || '').trim();
      if (!text) throw new Error('Intervention content is required.');
      const control = this.#active.get(roomId);
      const activeRun = control ? this.#store.getRun(control.runId) : null;
      const hasUnfinishedTurns = activeRun?.turns.some((turn) => ['pending', 'running'].includes(turn.status));
      if (!control || (!hasUnfinishedTurns && !control.assessingConvergence)) {
        const message = this.#store.addMessage(roomId, {
          authorType: 'human',
          authorId: 'host',
          content: text,
        });
        this.#emitSnapshot(roomId, 'human-message');
        return message;
      }
      if (control.softIntervention || control.hardIntervention) {
        throw new Error('A host intervention is already queued.');
      }
      const queued = this.#store.addMessage(roomId, {
        authorType: 'human',
        authorId: 'host',
        content: text,
        status: 'queued',
      });
      if (mode === 'hard') {
        control.hardIntervention = queued;
        control.abortReason = 'Interrupted by the room host';
        control.abortController.abort(new Error('Interrupted by the room host'));
        for (const memberId of control.activeMemberIds) this.#runtime.abortMember(roomId, memberId);
        this.#rejectRoomPermissions(roomId, 'Interrupted by the room host');
      } else {
        control.softIntervention = queued;
      }
      this.#emitSnapshot(roomId, mode === 'hard' ? 'hard-intervention-queued' : 'soft-intervention-queued');
      return queued;
    });
  }

  async stop(roomId) {
    return this.#commands.run(roomId, async () => {
      this.#stopActiveRun(roomId);
      return this.getRoom(roomId);
    });
  }

  stopMember(roomId, memberId) {
    const control = this.#active.get(roomId);
    if (!control || !control.activeMemberIds.has(memberId)) {
      throw new Error('The room member is not currently running.');
    }
    control.stoppedMemberIds.add(memberId);
    this.#runtime.abortMember(roomId, memberId);
    return this.getRoom(roomId);
  }

  async deleteRoom(roomId) {
    return this.#commands.run(roomId, async () => {
      const active = this.#stopActiveRun(roomId);
      if (active?.finished) await active.finished.catch(() => {});
      const room = this.#store.getRoom(roomId);
      this.#runtime.disposeRoom(room);
      await this.#store.deleteRoom(roomId);
      this.#emit('group-room:event', { roomId, type: 'room-deleted', payload: { roomId } });
    });
  }

  #stopActiveRun(roomId) {
    const control = this.#active.get(roomId);
    if (!control) return null;
    control.abortReason = 'Stopped by the room host';
    control.abortController.abort(new Error(control.abortReason));
    for (const memberId of control.activeMemberIds) this.#runtime.abortMember(roomId, memberId);
    this.#rejectRoomPermissions(roomId, 'Stopped by the room host');
    return control;
  }

  requestPermission(request) {
    const control = this.#active.get(request.roomId);
    if (!control || !control.activeMemberIds.has(request.memberId)) {
      return Promise.resolve({ behavior: 'deny', message: 'The room turn is no longer active.' });
    }
    const room = this.#store.getRoom(request.roomId);
    const member = room.members.find((entry) => entry.id === request.memberId);
    const requestId = `roomperm_${randomUUID().replaceAll('-', '')}`;
    const publicFields = {
      roomTitle: room.title,
      memberName: member?.displayName || request.memberId,
      connectorId: request.connectorId || null,
      turnId: control.activeTurnIds.get(request.memberId) || null,
      readOnly: Boolean(request.request?.readOnly),
      requestedAt: Date.now(),
    };
    const releaseTimeoutHold = this.#holdTimeoutsForPermission(control, request.memberId);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!this.#permissions.has(requestId)) return;
        this.#permissions.delete(requestId);
        releaseTimeoutHold();
        resolve({ behavior: 'deny', message: 'Group Room permission request timed out.' });
        this.#emit('group-room:permission-resolved', { requestId, roomId: request.roomId });
      }, 10 * 60 * 1000);
      timeout.unref?.();
      this.#permissions.set(requestId, { ...request, ...publicFields, resolve, timeout, releaseTimeoutHold });
      this.#emit('group-room:permission-request', {
        requestId,
        roomId: request.roomId,
        roomTitle: publicFields.roomTitle,
        memberId: request.memberId,
        memberName: publicFields.memberName,
        connectorId: publicFields.connectorId,
        turnId: publicFields.turnId,
        toolName: request.toolName,
        input: redactRoomValue(request.input),
        readOnly: publicFields.readOnly,
        requestedAt: publicFields.requestedAt,
      });
    });
  }

  resolvePermission(requestId, allowed) {
    const pending = this.#permissions.get(requestId);
    if (!pending) throw new Error('Group Room permission request is no longer pending.');
    this.#permissions.delete(requestId);
    clearTimeout(pending.timeout);
    pending.releaseTimeoutHold?.();
    pending.resolve(allowed
      ? { behavior: 'allow', updatedInput: pending.input }
      : { behavior: 'deny', message: 'Denied by the room host' });
    this.#emit('group-room:permission-resolved', { requestId, roomId: pending.roomId });
  }

  async #executeRun(roomId, runId, control) {
    let finalStatus = 'completed';
    let stopReason = '';
    try {
      const run = this.#store.getRun(runId);
      if (run.mode === 'parallel') {
        const settled = await Promise.allSettled(
          run.turns.map((turn) => this.#executeTurn(roomId, run, turn, control, run.contextSnapshotSeq)),
        );
        const rejected = settled.find((entry) => entry.status === 'rejected');
        if (rejected) {
          finalStatus = control.hardIntervention || control.abortController.signal.aborted
            ? 'interrupted'
            : control.stoppedMemberIds.size > 0 ? 'superseded' : 'failed';
          stopReason = safeRunError(rejected.reason);
        }
      } else {
        let snapshotSeq = run.contextSnapshotSeq;
        let turnIndex = 0;
        let currentRun = run;
        while (turnIndex < currentRun.turns.length) {
          const turn = currentRun.turns[turnIndex];
          await this.#executeTurn(roomId, run, turn, control, snapshotSeq);
          turnIndex += 1;
          const completed = this.#store.listMessages(roomId)
            .filter((message) => message.status === 'completed' && message.visibility === 'public');
          snapshotSeq = completed.at(-1)?.seq || snapshotSeq;
          if (control.softIntervention) {
            finalStatus = 'superseded';
            stopReason = 'Superseded by a host intervention';
            break;
          }
          if (control.totalTokens >= control.tokenBudget) {
            finalStatus = 'superseded';
            stopReason = 'Room token budget reached';
            break;
          }
          const discussion = control.discussion;
          const completedRound = discussion
            && turnIndex === currentRun.turns.length
            && turnIndex % discussion.memberIds.length === 0;
          if (!completedRound) continue;
          if (discussion.policy === 'fixed' && discussion.currentRound >= discussion.targetRounds) break;
          if (discussion.policy === 'until-stable') {
            const roomSnapshot = this.#store.getRoom(roomId);
            let decision;
            control.assessingConvergence = true;
            try {
              decision = await this.#runtime.assessDiscussion({
                room: roomSnapshot,
                round: discussion.currentRound,
                memberIds: discussion.memberIds,
                signal: control.abortController.signal,
              });
            } finally {
              control.assessingConvergence = false;
            }
            if (control.softIntervention) {
              finalStatus = 'superseded';
              stopReason = 'Superseded by a host intervention';
              break;
            }
            if (decision?.stable === true) {
              const safeReason = String(redactRoomValue(decision.reason || ''));
              stopReason = `Discussion converged after round ${discussion.currentRound}${safeReason ? `: ${safeReason}` : ''}`;
              this.#store.addMessage(roomId, {
                authorType: 'system',
                authorId: 'moderator',
                kind: 'moderation',
                content: `主持判断：讨论已在第 ${discussion.currentRound} 轮收敛${safeReason ? `。${safeReason}` : '。'}`,
              });
              break;
            }
          }
          discussion.currentRound += 1;
          currentRun = this.#store.appendRunTurns(runId, discussion.memberIds.map((memberId) => ({
            memberId,
            assignment: discussionAssignment(discussion.assignments[memberId], discussion.currentRound, {
              policy: discussion.policy,
              rounds: discussion.targetRounds,
            }),
          })), { contextSnapshotSeq: snapshotSeq });
          this.#emitSnapshot(roomId, 'discussion-round-added');
        }
      }
      if (control.hardIntervention || control.abortController.signal.aborted) {
        finalStatus = control.budgetReached ? 'superseded' : 'interrupted';
        stopReason ||= control.abortReason || 'Stopped by the room host';
      }
    } catch (error) {
      finalStatus = control.abortController.signal.aborted
        ? control.budgetReached ? 'superseded' : 'interrupted'
        : control.stoppedMemberIds.size > 0 ? 'superseded' : 'failed';
      stopReason = safeRunError(error);
    } finally {
      control.runDeadline?.clear();
      for (const deadline of control.turnDeadlines.values()) deadline.clear();
      try {
        this.#store.finishRun(runId, { status: finalStatus, stopReason });
      } catch {}
      const intervention = control.hardIntervention || control.softIntervention;
      if (intervention) {
        try { this.#store.promoteMessage(intervention.id); } catch {}
      }
      this.#active.delete(roomId);
      this.#rejectRoomPermissions(roomId, 'The room run finished.');
      this.#emitSnapshot(roomId, 'run-finished');
    }
  }

  async #executeTurn(roomId, run, turn, control, snapshotSeq) {
    const room = this.#store.getRoom(roomId);
    const member = room.members.find((entry) => entry.id === turn.memberId);
    if (!member) throw new Error(`Room member disappeared: ${turn.memberId}`);
    const resources = await this.#catalog.resolveRuntimeResources(member);
    const writeConnectorIds = resources.connectorGrants
      .filter((grant) => grant?.access === 'write')
      .map((grant) => grant.id);
    return this.#scheduler.run({
      roomId,
      memberId: member.id,
      connectorLeaseIds: writeConnectorIds,
      signal: control.abortController.signal,
    }, async () => {
      control.activeMemberIds.add(member.id);
      control.activeTurnIds.set(member.id, turn.id);
      this.#store.startTurn(turn.id, {
        resourceFingerprint: resources.fingerprint,
        contextSnapshotSeq: snapshotSeq,
      });
      this.#emitSnapshot(roomId, 'turn-started');
      const turnTimeoutMs = clampNumber(room.settings?.turnTimeoutMs, 15 * 60_000, 30_000, 30 * 60_000);
      const turnAbort = new AbortController();
      const turnDeadline = new PausableDeadline(turnTimeoutMs, () => {
        turnAbort.abort(new Error('Group Room member turn timed out'));
        this.#runtime.abortMember(roomId, member.id);
      });
      control.turnDeadlines.set(member.id, turnDeadline);
      try {
        const result = await this.#runtime.execute({
          room,
          member,
          turn,
          snapshotSeq,
          messages: this.#store.listMessages(roomId),
          resources,
          signal: AbortSignal.any([control.abortController.signal, turnAbort.signal]),
          onEvent: (event) => this.#emit('group-room:stream', {
            roomId,
            runId: run.id,
            turnId: turn.id,
            memberId: member.id,
            ...event,
          }),
        });
        if (control.abortController.signal.aborted || control.stoppedMemberIds.has(member.id) || turnAbort.signal.aborted) {
          const error = new Error(
            control.abortReason
            || (turnAbort.signal.aborted ? 'Group Room member turn timed out' : 'Room member was stopped'),
          );
          error.roomTrace = result.trace;
          error.roomUsage = result.usage;
          throw error;
        }
        this.#store.completeTurn(turn.id, {
          ...result,
          content: redactRoomValue(result.content),
        });
        control.totalTokens += tokenUsage(result.usage);
        if (run.mode === 'parallel' && control.totalTokens >= control.tokenBudget && !control.abortController.signal.aborted) {
          control.budgetReached = true;
          control.abortReason = 'Room token budget reached';
          control.abortController.abort(new Error(control.abortReason));
          for (const memberId of control.activeMemberIds) {
            if (memberId !== member.id) this.#runtime.abortMember(roomId, memberId);
          }
        }
        this.#emitSnapshot(roomId, 'turn-completed');
        return result;
      } catch (error) {
        const interrupted = control.abortController.signal.aborted || control.stoppedMemberIds.has(member.id);
        try {
          this.#store.failTurn(turn.id, safeRunError(error), interrupted ? 'interrupted' : 'failed', {
            trace: redactRoomValue(error?.roomTrace || []),
            usage: redactRoomValue(error?.roomUsage || null),
          });
        } catch {}
        this.#emitSnapshot(roomId, interrupted ? 'turn-interrupted' : 'turn-failed');
        throw error;
      } finally {
        turnDeadline.clear();
        if (control.turnDeadlines.get(member.id) === turnDeadline) control.turnDeadlines.delete(member.id);
        control.activeMemberIds.delete(member.id);
        control.activeTurnIds.delete(member.id);
      }
    });
  }

  #rejectRoomPermissions(roomId, message) {
    for (const [requestId, pending] of this.#permissions.entries()) {
      if (pending.roomId !== roomId) continue;
      this.#permissions.delete(requestId);
      clearTimeout(pending.timeout);
      pending.releaseTimeoutHold?.();
      pending.resolve({ behavior: 'deny', message });
      this.#emit('group-room:permission-resolved', { requestId, roomId });
    }
  }

  #holdTimeoutsForPermission(control, memberId) {
    const memberWaits = (control.permissionWaitCounts.get(memberId) || 0) + 1;
    control.permissionWaitCounts.set(memberId, memberWaits);
    if (memberWaits === 1) control.turnDeadlines.get(memberId)?.pause();
    control.totalPermissionWaits += 1;
    if (control.totalPermissionWaits === 1) control.runDeadline?.pause();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const remainingMemberWaits = Math.max(0, (control.permissionWaitCounts.get(memberId) || 1) - 1);
      if (remainingMemberWaits === 0) {
        control.permissionWaitCounts.delete(memberId);
        control.turnDeadlines.get(memberId)?.resume();
      } else {
        control.permissionWaitCounts.set(memberId, remainingMemberWaits);
      }
      control.totalPermissionWaits = Math.max(0, control.totalPermissionWaits - 1);
      if (control.totalPermissionWaits === 0) control.runDeadline?.resume();
    };
  }

  async #compactContextIfNeeded(roomId) {
    const room = this.#store.getRoom(roomId);
    const unsummarized = room.messages.filter((message) => message.seq > room.summaryThroughSeq);
    const totalChars = unsummarized.reduce((total, message) => total + message.content.length, 0);
    const threshold = Math.max(40_000, Number(room.settings?.summaryThresholdChars) || 120_000);
    if (totalChars <= threshold || unsummarized.length < 10) return room;
    const retained = unsummarized.slice(-6);
    const retainedIds = new Set(retained.map((message) => message.id));
    const toSummarize = unsummarized.filter((message) => !retainedIds.has(message.id));
    if (toSummarize.length === 0) return room;
    try {
      const summary = redactRoomValue(await this.#runtime.summarize({
        room,
        previousSummary: room.summary,
        messages: toSummarize,
      }));
      return this.#store.updateSummary(roomId, summary, toSummarize.at(-1).seq);
    } catch (error) {
      try { this.#store.updateRoom(roomId, { status: 'paused' }); } catch {}
      throw new Error(`Unable to summarize the Group Room safely: ${safeRunError(error)}`);
    }
  }

  #publicRoom(room) {
    return {
      ...room,
      members: room.members.map(publicMember),
      recentRuns: this.#store.listRuns(room.id).map((run) => ({
        ...run,
        turns: run.turns.map((turn) => ({ ...turn, trace: redactRoomValue(turn.trace) })),
      })),
    };
  }

  async #validateConnectorGrants(value) {
    const grants = normalizeConnectorGrants(value);
    if (grants.length === 0) return grants;
    const connectors = await this.#catalog.listConnectors();
    const available = new Set(connectors.map((connector) => connector.id));
    const unavailable = grants.filter((grant) => !available.has(grant.id)).map((grant) => grant.id);
    if (unavailable.length > 0) {
      throw new Error(`Room connectors are unavailable or not authorized: ${unavailable.join(', ')}`);
    }
    return grants;
  }

  #emitSnapshot(roomId, type) {
    if (this.#disposed) return;
    const room = this.getRoom(roomId);
    this.#emit('group-room:event', {
      roomId,
      revision: room.revision,
      type,
      payload: room,
    });
  }

  dispose() {
    this.#disposed = true;
    for (const [roomId, control] of this.#active.entries()) {
      control.abortController.abort(new Error('The Group Room controller was disposed.'));
      for (const memberId of control.activeMemberIds) this.#runtime.abortMember(roomId, memberId);
      this.#rejectRoomPermissions(roomId, 'The Group Room controller was disposed.');
    }
    this.#runtime.disposeAll();
    this.#rejectRoomPermissionsForAll();
  }

  #rejectRoomPermissionsForAll() {
    for (const [requestId, pending] of this.#permissions.entries()) {
      this.#permissions.delete(requestId);
      clearTimeout(pending.timeout);
      pending.releaseTimeoutHold?.();
      pending.resolve({ behavior: 'deny', message: 'The Group Room controller was disposed.' });
    }
  }
}
