import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MODERATOR_INSTRUCTIONS = '根据任务复杂度、成员专长、已有证据和分歧程度自主决定自己处理或委派，决定串行、并行、复核与收敛。审查、方案、架构和风险判断中，如果第二意见能显著提高可靠性，应主动安排相关成员交叉验证；不要为凑人数调用无关成员。';

function sourceKey(member) {
  return `${member.source.kind}:${member.source.id}:${member.source.memberId || ''}`;
}

function normalizePermissionMode(value) {
  return value === 'ask' || value === 'allow-all' ? value : 'inherit';
}

function normalizeRoomSettings(settings = {}) {
  return {
    permissionMode: normalizePermissionMode(settings.permissionMode),
    moderatorInstructions: String(settings.moderatorInstructions || DEFAULT_MODERATOR_INSTRUCTIONS).trim().slice(0, 12_000),
  };
}

function normalizeConnectorGrants(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const grants = [];
  for (const raw of value) {
    const id = String(raw?.id || raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    grants.push({ id });
  }
  return grants;
}

function publicMember(member) {
  const { promptSnapshot: _prompt, teamCharterSnapshot: _charter, resourceSnapshot, ...safe } = member;
  return {
    ...safe,
    resourceSnapshot: {
      assistantName: resourceSnapshot?.assistantName || member.source.id,
      enabledSkills: resourceSnapshot?.enabledSkills || [],
      skillCommands: resourceSnapshot?.skillCommands || [],
      sourceType: resourceSnapshot?.sourceType || 'local',
      sourceHash: resourceSnapshot?.sourceHash || member.source.hash || '',
    },
  };
}

function ensureUniqueMembers(members) {
  if (members.length < 1) throw new Error('A Group Room requires at least one expert.');
  if (members.length > 32) throw new Error('A Group Room supports at most 32 participants.');
  const names = new Set();
  const sources = new Set();
  for (const member of members) {
    const name = String(member.displayName || '').trim().toLocaleLowerCase();
    if (!name || names.has(name)) throw new Error(`Room member names must be unique: ${member.displayName || 'unknown'}`);
    names.add(name);
    const source = sourceKey(member);
    if (sources.has(source)) throw new Error(`Duplicate room member source: ${member.displayName}`);
    sources.add(source);
  }
}

function roomId() {
  return `room_${randomUUID().replaceAll('-', '')}`;
}

export class GroupRoomController {
  #store;
  #catalog;
  #paths;
  #sessions;
  #emit;

  constructor({ store, catalog, paths, sessions, emit }) {
    this.#store = store;
    this.#catalog = catalog;
    this.#paths = paths;
    this.#sessions = sessions;
    this.#emit = typeof emit === 'function' ? emit : () => {};
  }

  #sessionSummary(sessionId) {
    try { return this.#sessions.getSummary(sessionId); } catch { return null; }
  }

  #sessionIsActive(sessionId) {
    try {
      if (typeof this.#sessions.isActive === 'function') return this.#sessions.isActive(sessionId);
    } catch {}
    return Boolean(this.#sessionSummary(sessionId)?.busy);
  }

  #publicRoom(room) {
    const session = this.#sessionSummary(room.sessionId);
    return {
      ...room,
      status: this.#sessionIsActive(room.sessionId) ? 'running' : 'idle',
      preview: session?.preview || '',
      messageCount: session?.messageCount || 0,
      members: room.members.map(publicMember),
    };
  }

  listRooms() {
    return this.#store.listRooms().map((summary) => this.#publicRoom(this.#store.getRoom(summary.id)));
  }

  getRoom(id) {
    return this.#publicRoom(this.#store.getRoom(id));
  }

  async listResources() {
    const [inviteables, connectors, skills] = await Promise.all([
      this.#catalog.listInviteables(),
      this.#catalog.listConnectors(),
      this.#catalog.listSkills(),
    ]);
    return { inviteables, connectors, skills };
  }

  async #validateConnectorGrants(value) {
    const grants = normalizeConnectorGrants(value);
    if (grants.length === 0) return [];
    const available = new Set((await this.#catalog.listConnectors()).map((connector) => connector.id));
    const unavailable = grants.filter((grant) => !available.has(grant.id));
    if (unavailable.length > 0) throw new Error(`Unavailable room connectors: ${unavailable.map((grant) => grant.id).join(', ')}`);
    return grants;
  }

  async #resolveMembers(input) {
    const invitationIds = Array.isArray(input?.invitationIds) ? input.invitationIds : [];
    const [invited, custom] = await Promise.all([
      invitationIds.length > 0 ? this.#catalog.resolveInvitations(invitationIds) : [],
      this.#catalog.resolveCustomMembers(input?.customMembers),
    ]);
    const members = [...invited, ...custom].map((member) => ({
      ...member,
      id: member.id || `member_${randomUUID().replaceAll('-', '')}`,
    }));
    ensureUniqueMembers(members);
    const defaults = await this.#validateConnectorGrants(input?.connectorGrants);
    const bySource = input?.memberConnectorGrants && typeof input.memberConnectorGrants === 'object'
      ? input.memberConnectorGrants
      : {};
    for (const member of members) {
      member.grants = {
        ...member.grants,
        connectors: Object.prototype.hasOwnProperty.call(bySource, sourceKey(member))
          ? await this.#validateConnectorGrants(bySource[sourceKey(member)])
          : defaults,
      };
    }
    return members;
  }

  async #writeMemberInstructions(room) {
    const dir = path.join(this.#paths.resourcesDir(room.id), 'experts');
    await fsp.mkdir(dir, { recursive: true });
    await Promise.all(room.members.map(async (member) => {
      const memberDir = path.join(dir, member.id);
      await fsp.mkdir(memberDir, { recursive: true });
      const content = [
        `# ${member.displayName}`,
        '',
        `Role: ${member.role}`,
        '',
        '## Group Room communication contract',
        '',
        '- Follow the output language explicitly requested by the moderator; otherwise use the language of the assigned task.',
        '- Return findings to the moderator. Do not address the end user directly or invent additional room members.',
        member.teamCharterSnapshot ? `\n## Shared team charter\n\n${member.teamCharterSnapshot}` : '',
        `\n## Member instructions\n\n${member.promptSnapshot}`,
      ].filter(Boolean).join('\n');
      await fsp.writeFile(path.join(memberDir, 'instructions.md'), `${content.trim()}\n`, { encoding: 'utf8', mode: 0o600 });
    }));
    const brief = [
      `# ${room.title}`,
      '',
      `Topic: ${room.topic}`,
      `Workspace: ${room.workspace}`,
      '',
      '## Moderator instructions',
      '',
      room.settings?.moderatorInstructions || DEFAULT_MODERATOR_INSTRUCTIONS,
      '',
      '## Fixed roster',
      '',
      ...room.members.map((member) => `- ${member.displayName} (${member.id}): ${member.role}`),
      '',
      'Members are activated lazily. The moderator must include the current request, relevant context, constraints, expected output, and response language in every member’s first assignment.',
    ].join('\n');
    await fsp.writeFile(path.join(this.#paths.resourcesDir(room.id), 'room-brief.md'), `${brief.trim()}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  async createRoom(input) {
    const workspace = String(input?.workspace || '').trim();
    let stat;
    try { stat = await fsp.stat(workspace); } catch {}
    if (!stat?.isDirectory()) throw new Error('Select an existing workspace directory.');
    const members = await this.#resolveMembers(input);
    const id = roomId();
    const session = await this.#sessions.create({
      roomId: id,
      title: input?.title || input?.topic,
      workspace,
    });
    try {
      const room = this.#store.createRoom({
        id,
        sessionId: session.id,
        title: input?.title,
        topic: input?.topic,
        workspace,
        settings: normalizeRoomSettings(input?.settings),
        members,
      });
      await this.#writeMemberInstructions(room);
      await this.#sessions.sync(room);
      this.#emit('group-room:event', { roomId: room.id, type: 'room-created', payload: this.#publicRoom(room) });
      return this.#publicRoom(room);
    } catch (error) {
      await this.#sessions.delete(session.id).catch(() => {});
      await this.#store.deleteRoom(id).catch(() => {});
      throw error;
    }
  }

  async updateRoom(id, updates, expectedRevision) {
    const current = this.#store.getRoom(id);
    if (this.#sessionIsActive(current.sessionId)) throw new Error('Cannot change room configuration while the coordinator or a member is running.');
    if (updates?.workspace !== undefined) {
      let stat;
      try { stat = await fsp.stat(String(updates.workspace || '').trim()); } catch {}
      if (!stat?.isDirectory()) throw new Error('Select an existing workspace directory.');
    }
    const safe = {};
    if (updates?.title !== undefined) safe.title = updates.title;
    if (updates?.topic !== undefined) safe.topic = updates.topic;
    if (updates?.workspace !== undefined) safe.workspace = updates.workspace;
    if (updates?.settings !== undefined) safe.settings = normalizeRoomSettings({
      ...current.settings,
      ...(updates.settings || {}),
    });
    const room = this.#store.updateRoom(id, safe, expectedRevision);
    await this.#writeMemberInstructions(room);
    await this.#sessions.sync(room);
    this.#emit('group-room:event', { roomId: room.id, type: 'room-updated', payload: this.#publicRoom(room) });
    return this.#publicRoom(room);
  }

  async updateMemberGrants(roomIdValue, memberId, grants, expectedRevision) {
    const current = this.#store.getRoom(roomIdValue);
    if (this.#sessionIsActive(current.sessionId)) throw new Error('Cannot change member resources while the coordinator or a member is running.');
    const existing = current.members.find((member) => member.id === memberId);
    if (!existing) throw new Error(`Room member not found: ${memberId}`);
    const allowedSkills = new Set(existing.resourceSnapshot?.skillCommands || []);
    const skills = [...new Set(Array.isArray(grants?.skills) ? grants.skills.map(String) : [])];
    const unknown = skills.filter((skill) => !allowedSkills.has(skill));
    if (unknown.length > 0) throw new Error(`Skills are not assigned to this room member: ${unknown.join(', ')}`);
    const room = this.#store.updateMemberGrants(roomIdValue, memberId, {
      connectors: await this.#validateConnectorGrants(grants?.connectors),
      skills,
    }, expectedRevision);
    await this.#sessions.sync(room);
    this.#emit('group-room:event', { roomId: room.id, type: 'member-resources-updated', payload: this.#publicRoom(room) });
    return this.#publicRoom(room);
  }

  async refreshMemberSource(roomIdValue, memberId, expectedRevision) {
    const current = this.#store.getRoom(roomIdValue);
    if (this.#sessionIsActive(current.sessionId)) throw new Error('Cannot refresh a member while the coordinator or a member is running.');
    const member = current.members.find((entry) => entry.id === memberId);
    if (!member) throw new Error(`Room member not found: ${memberId}`);
    const snapshot = await this.#catalog.resolveMemberSource(member);
    const availableSkills = new Set(snapshot.resourceSnapshot?.skillCommands || []);
    const room = this.#store.updateMemberSnapshot(roomIdValue, memberId, {
      ...snapshot,
      grants: {
        connectors: member.grants?.connectors || [],
        skills: (member.grants?.skills || []).filter((skill) => availableSkills.has(skill)),
      },
    }, expectedRevision);
    await this.#writeMemberInstructions(room);
    await this.#sessions.sync(room);
    this.#emit('group-room:event', { roomId: room.id, type: 'member-source-refreshed', payload: this.#publicRoom(room) });
    return this.#publicRoom(room);
  }

  async addMembers(roomIdValue, input, expectedRevision) {
    const current = this.#store.getRoom(roomIdValue);
    if (this.#sessionIsActive(current.sessionId)) throw new Error('Cannot add members while the coordinator or a member is running.');
    const resolved = await this.#resolveMembers(input);
    const existingSources = new Set(current.members.map(sourceKey));
    const additions = resolved.filter((member) => !existingSources.has(sourceKey(member)));
    if (additions.length === 0) throw new Error('All selected members are already in this Group Room.');
    ensureUniqueMembers([...current.members, ...additions]);
    const room = this.#store.addMembers(roomIdValue, additions, expectedRevision);
    await this.#writeMemberInstructions(room);
    await this.#sessions.sync(room);
    this.#emit('group-room:event', { roomId: room.id, type: 'members-added', payload: this.#publicRoom(room) });
    return this.#publicRoom(room);
  }

  async removeMember(roomIdValue, memberId, expectedRevision) {
    const current = this.#store.getRoom(roomIdValue);
    if (this.#sessionIsActive(current.sessionId)) throw new Error('Cannot remove members while the coordinator or a member is running.');
    const room = this.#store.removeMember(roomIdValue, memberId, expectedRevision);
    await fsp.rm(path.join(this.#paths.resourcesDir(room.id), 'experts', memberId), { recursive: true, force: true });
    await this.#writeMemberInstructions(room);
    await this.#sessions.sync(room);
    this.#emit('group-room:event', { roomId: room.id, type: 'member-removed', payload: this.#publicRoom(room) });
    return this.#publicRoom(room);
  }

  reorder(roomIds) {
    const rooms = this.#store.reorder(roomIds).map((room) => this.#publicRoom(this.#store.getRoom(room.id)));
    this.#emit('group-room:event', { roomId: null, type: 'rooms-reordered', payload: rooms });
    return rooms;
  }

  async deleteRoom(id) {
    const room = this.#store.getRoom(id);
    await this.#sessions.delete(room.sessionId);
    await this.#store.deleteRoom(id);
    this.#emit('group-room:event', { roomId: id, type: 'room-deleted', payload: { roomId: id } });
  }

  getRuntimeDescriptor(roomIdValue) {
    const room = this.#store.getRoom(roomIdValue);
    const connectorIds = [...new Set(room.members.flatMap((member) => (
      (member.grants?.connectors || []).map((grant) => String(grant.id || '')).filter(Boolean)
    )))];
    const addDirs = [...new Set([
      this.#paths.resourcesDir(room.id),
      ...room.members.map((member) => member.resourceSnapshot?.assistantPath),
    ]
      .filter(Boolean)
      .map((entry) => path.resolve(entry)))];
    const expertsDir = path.join(this.#paths.resourcesDir(room.id), 'experts');
    const members = room.members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      role: member.role,
      expertInstructionsPath: path.join(expertsDir, member.id, 'instructions.md'),
      connectorIds: (member.grants?.connectors || []).map((grant) => String(grant.id || '')).filter(Boolean),
      skillIds: [...new Set(member.grants?.skills || [])],
      skillDirectories: member.resourceSnapshot?.skillDirectories || {},
      assistantPath: member.resourceSnapshot?.assistantPath || '',
    }));
    return {
      room,
      roomBriefPath: path.join(this.#paths.resourcesDir(room.id), 'room-brief.md'),
      connectorIds,
      addDirs,
      members,
      permissionMode: normalizePermissionMode(room.settings?.permissionMode),
    };
  }

  dispose() {}
}
