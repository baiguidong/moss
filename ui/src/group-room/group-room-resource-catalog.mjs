import path from 'node:path';
import fsp from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

import {
  readAssistantContext,
  readAssistantMeta,
  readAssistantRelativeMarkdown,
} from '../assistant-context-utils.mjs';

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function stringValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))];
}

function boundedText(value, label, max) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > max) throw new Error(`${label} is too long.`);
  return text;
}

function memberIdentity(member) {
  return stringValue(member?.id, member?.agentName, member?.name, member?.displayName);
}

function memberPromptFile(member) {
  return stringValue(member?.localPromptFile, member?.promptFile, member?.runtimePromptFile);
}

function skillCommand(identifier) {
  const normalized = String(identifier || '').trim().replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized) return '';
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) || normalized;
}

async function readFirstAvailable(paths) {
  for (const candidate of paths) {
    try { return await fsp.readFile(candidate, 'utf-8'); } catch {}
  }
  return '';
}

function isForkedSkillMarkdown(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(content || ''));
  return Boolean(match && /^context\s*:\s*["']?fork["']?\s*$/im.test(match[1]));
}

async function inlineSkillCommands(assistantPath, identifiers, installedSkills = []) {
  const installedByKey = new Map();
  for (const skill of installedSkills) {
    for (const key of [skill?.id, skill?.name, skill?.slug, skill?.displayName]) {
      if (key) installedByKey.set(String(key).toLowerCase(), skill);
    }
  }
  const commands = [];
  for (const identifier of identifiers) {
    const command = skillCommand(identifier);
    if (!command) continue;
    const installed = installedByKey.get(String(identifier).toLowerCase())
      || installedByKey.get(command.toLowerCase());
    const markdown = await readFirstAvailable([
      path.join(assistantPath, 'skills', command, 'SKILL.md'),
      path.join(assistantPath, '.moss', 'skills', command, 'SKILL.md'),
      installed?.source ? path.join(installed.source, 'SKILL.md') : '',
    ].filter(Boolean));
    if (isForkedSkillMarkdown(markdown)) continue;
    commands.push(command);
  }
  return [...new Set(commands)];
}

function sanitizeConnector(connector) {
  return {
    id: String(connector.id || ''),
    name: String(connector.name || connector.id || ''),
    description: String(connector.description || ''),
    type: String(connector.type || 'unknown'),
    icon: String(connector.icon || ''),
    connected: connector.connected === true,
    enabled: connector.enabled !== false,
    hasMcp: Boolean(connector.hasMcp),
    hasCli: Boolean(connector.hasCli),
    hasSkills: Boolean(connector.hasSkills),
    mcpServerNames: stringList(connector.mcpServerNames),
  };
}

export class GroupRoomResourceCatalog {
  #deps;

  constructor(dependencies) {
    this.#deps = dependencies || {};
    if (typeof this.#deps.listAssistants !== 'function') {
      throw new Error('Group Room assistant catalog is unavailable.');
    }
  }

  async #assistantRecords() {
    const records = await this.#deps.listAssistants();
    const seen = new Set();
    return (Array.isArray(records) ? records : []).filter((entry) => {
      const key = String(entry?.name || '').trim();
      if (entry?.enabled === false || !entry?.source || !key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async #skillRecords() {
    const installed = typeof this.#deps.listSkills === 'function'
      ? await this.#deps.listSkills()
      : [];
    const skills = [];
    for (const skill of Array.isArray(installed) ? installed : []) {
      if (skill?.enabled === false || !skill?.source) continue;
      const command = skillCommand(skill.name || skill.slug || path.basename(skill.source));
      if (!command) continue;
      const markdown = await readFirstAvailable([path.join(skill.source, 'SKILL.md')]);
      if (isForkedSkillMarkdown(markdown)) continue;
      skills.push({
        id: String(skill.id || skill.slug || skill.name || command),
        command,
        name: String(skill.displayName || skill.name || command),
        description: String(skill.description || ''),
        source: path.resolve(skill.source),
      });
    }
    const seen = new Set();
    return skills
      .filter((skill) => !seen.has(skill.command) && seen.add(skill.command))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  async listInviteables() {
    const assistants = await this.#assistantRecords();
    const inviteables = [];
    for (const assistant of assistants) {
      const meta = await readAssistantMeta(assistant.source);
      const isTeam = String(meta?.expert_type || meta?.expertType || '').toLowerCase() === 'team';
      const members = isTeam && Array.isArray(meta?.members)
        ? meta.members.map((member) => ({
            id: memberIdentity(member),
            displayName: stringValue(member?.displayName, member?.name, member?.id),
            role: stringValue(member?.role, member?.profession, member?.description),
          })).filter((member) => member.id)
        : [];
      let resolvedMembers = [];
      try { resolvedMembers = await this.#resolveAssistant(assistant); } catch {}
      if (resolvedMembers.length === 0) continue;
      const currentByMemberId = new Map(resolvedMembers.map((member) => [member.source.memberId || '', member]));
      inviteables.push({
        id: String(assistant.name || meta?.name || path.basename(assistant.source)),
        displayName: String(assistant.displayName || meta?.display_name || assistant.name || ''),
        description: String(assistant.description || meta?.description || ''),
        avatar: String(assistant.avatar || meta?.avatar || ''),
        category: String(assistant.category || meta?.category || ''),
        type: isTeam ? 'team' : 'agent',
        sourceHash: isTeam ? '' : resolvedMembers[0]?.source?.hash || '',
        members: members.map((member) => ({
          ...member,
          sourceHash: currentByMemberId.get(member.id)?.source?.hash || '',
        })),
        skills: stringList(meta?.enabledSkills?.length ? meta.enabledSkills : meta?.skills),
      });
    }
    return inviteables.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'));
  }

  async listConnectors() {
    if (typeof this.#deps.listConnectors !== 'function') return [];
    const connectors = await this.#deps.listConnectors();
    return (Array.isArray(connectors) ? connectors : [])
      .filter((connector) => connector?.enabled !== false && connector?.connected === true)
      .map(sanitizeConnector)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  async listSkills() {
    return (await this.#skillRecords()).map(({ source: _source, ...skill }) => skill);
  }

  async resolveCustomMembers(value) {
    const inputs = Array.isArray(value) ? value : [];
    if (inputs.length > 32) throw new Error('A Group Room supports at most 32 custom members.');
    const skills = await this.#skillRecords();
    const skillsById = new Map();
    for (const skill of skills) {
      skillsById.set(skill.id, skill);
      skillsById.set(skill.command, skill);
    }
    return inputs.map((input) => {
      const displayName = boundedText(input?.displayName, 'Custom member name', 120);
      const role = boundedText(input?.role || displayName, 'Custom member role', 500);
      const promptSnapshot = boundedText(input?.prompt, 'Custom member prompt', 500_000);
      const selected = stringList(input?.skillIds).map((id) => skillsById.get(id));
      if (selected.some((skill) => !skill)) throw new Error(`Custom member has an unavailable skill: ${displayName}`);
      const skillCommands = [...new Set(selected.map((skill) => skill.command))];
      const sourceId = `custom_${randomUUID().replaceAll('-', '')}`;
      const sourceHash = hashJson({ displayName, role, promptSnapshot, skillCommands });
      return {
        displayName,
        role,
        source: { kind: 'custom', id: sourceId, memberId: null, hash: sourceHash },
        promptSnapshot,
        teamCharterSnapshot: '',
        resourceSnapshot: {
          assistantName: displayName,
          assistantPath: '',
          enabledSkills: selected.map((skill) => skill.id),
          skillCommands,
          skillDirectories: Object.fromEntries(selected.map((skill) => [skill.command, [skill.source]])),
          sourceType: 'custom',
          sourceHash,
        },
        grants: { connectors: [], skills: skillCommands },
      };
    });
  }

  async resolveInvitations(invitationIds) {
    const requested = stringList(invitationIds);
    if (requested.length === 0) throw new Error('Select at least one assistant or expert.');
    const assistants = await this.#assistantRecords();
    const byName = new Map();
    for (const assistant of assistants) {
      for (const key of [assistant.name, assistant.displayName, path.basename(assistant.source)]) {
        if (key) byName.set(String(key), assistant);
      }
    }

    const resolved = [];
    for (const invitationId of requested) {
      const assistant = byName.get(invitationId);
      if (!assistant) throw new Error(`Installed assistant is unavailable: ${invitationId}`);
      resolved.push(...await this.#resolveAssistant(assistant));
    }
    const sourceKeys = new Set();
    for (const member of resolved) {
      const key = `${member.source.kind}:${member.source.id}:${member.source.memberId || ''}`;
      if (sourceKeys.has(key)) throw new Error(`Duplicate room member source: ${member.displayName}`);
      sourceKeys.add(key);
    }
    return resolved;
  }

  async resolveMemberSource(member) {
    const assistants = await this.#assistantRecords();
    const assistant = assistants.find((entry) => String(entry.name) === String(member?.source?.id));
    if (!assistant) throw new Error(`Installed assistant is unavailable: ${member?.source?.id || 'unknown'}`);
    const candidates = await this.#resolveAssistant(assistant);
    const matched = candidates.find((candidate) => (
      candidate.source.kind === member.source.kind
      && candidate.source.id === member.source.id
      && (candidate.source.memberId || null) === (member.source.memberId || null)
    ));
    if (!matched) throw new Error(`Installed expert member is unavailable: ${member.displayName}`);
    return matched;
  }

  async #resolveAssistant(assistant) {
    const context = await readAssistantContext(assistant.source, assistant.name);
    if (!context?.rules?.trim()) throw new Error(`Assistant prompt is missing: ${assistant.displayName || assistant.name}`);
    const meta = context.meta || {};
    const isTeam = String(meta.expert_type || meta.expertType || '').toLowerCase() === 'team';
    const enabledSkills = stringList(context.enabledSkillIdentifiers);
    const installedSkills = typeof this.#deps.listSkills === 'function'
      ? await this.#deps.listSkills()
      : [];
    const skillCommands = await inlineSkillCommands(assistant.source, enabledSkills, installedSkills);
    const installedSkillDirectories = new Map();
    for (const skill of Array.isArray(installedSkills) ? installedSkills : []) {
      if (skill?.enabled === false || !skill?.source) continue;
      const command = skillCommand(skill.name || skill.slug || path.basename(skill.source));
      if (command) installedSkillDirectories.set(command, path.resolve(skill.source));
    }
    const skillDirectories = {};
    for (const command of skillCommands) {
      const candidates = [
        path.join(assistant.source, 'skills', command),
        path.join(assistant.source, '.moss', 'skills', command),
        installedSkillDirectories.get(command),
      ].filter(Boolean);
      const directories = [];
      for (const candidate of candidates) {
        try {
          if ((await fsp.stat(candidate)).isDirectory()) directories.push(path.resolve(candidate));
        } catch {}
      }
      skillDirectories[command] = [...new Set(directories)];
    }
    const commonSnapshot = {
      assistantName: String(assistant.name),
      assistantPath: path.resolve(assistant.source),
      enabledSkills,
      skillCommands,
      skillDirectories,
      sourceType: String(meta.source_type || assistant.tag || 'local'),
    };

    if (!isTeam) {
      const sourceHash = hashJson({ rules: context.rules, meta, enabledSkills });
      return [{
        displayName: String(assistant.displayName || assistant.name),
        role: stringValue(meta.profession, meta.description, assistant.description, assistant.displayName),
        source: { kind: 'assistant', id: String(assistant.name), memberId: null, hash: sourceHash },
        promptSnapshot: context.rules,
        teamCharterSnapshot: '',
        resourceSnapshot: { ...commonSnapshot, sourceHash },
        grants: { connectors: [], skills: skillCommands },
      }];
    }

    const members = Array.isArray(meta.members) ? meta.members : [];
    if (members.length === 0) throw new Error(`Expert team has no installed members: ${assistant.displayName}`);
    const resolved = [];
    for (const member of members) {
      const sourceMemberId = memberIdentity(member);
      if (!sourceMemberId) throw new Error(`Expert team contains a member without an id: ${assistant.displayName}`);
      const promptFile = memberPromptFile(member);
      if (!promptFile) throw new Error(`Expert team member prompt is missing: ${sourceMemberId}`);
      let prompt;
      try {
        prompt = await readAssistantRelativeMarkdown(assistant.source, promptFile);
      } catch (error) {
        throw new Error(`Expert team member prompt is unavailable (${sourceMemberId}): ${error.message || error}`);
      }
      const sourceHash = hashJson({
        charter: context.rules,
        prompt: prompt.content,
        member,
        enabledSkills,
      });
      resolved.push({
        displayName: stringValue(member.displayName, member.name, member.id, sourceMemberId),
        role: stringValue(member.role, member.profession, member.description, member.displayName, sourceMemberId),
        source: {
          kind: 'expert-team',
          id: String(assistant.name),
          memberId: sourceMemberId,
          hash: sourceHash,
        },
        promptSnapshot: prompt.content,
        teamCharterSnapshot: context.rules,
        resourceSnapshot: {
          ...commonSnapshot,
          memberPromptFile: prompt.relativePath,
          sourceHash,
        },
        grants: { connectors: [], skills: skillCommands },
      });
    }
    return resolved;
  }

}
