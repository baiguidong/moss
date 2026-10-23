import path from 'node:path';
import { normalizeStringList } from './string-list.mjs';
import { normalizePermissionMode } from '../permission-modes.mjs';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export function normalizeProjectDefaults(raw = {}) {
  const workspaces = normalizeStringList(raw.workspaces).filter(directory => path.isAbsolute(directory)).map(directory => path.resolve(directory));
  const requestedDefault = typeof raw.defaultWorkspace === 'string' && path.isAbsolute(raw.defaultWorkspace) ? path.resolve(raw.defaultWorkspace) : null;
  return {
    appIds: normalizeStringList(raw.appIds),
    appServiceIds: normalizeStringList(raw.appServiceIds),
    assistantName: typeof raw.assistantName === 'string' ? raw.assistantName.trim() : null,
    permissionMode: raw.permissionMode ? normalizePermissionMode(raw.permissionMode) : null,
    mode: raw.mode === 'chat' ? 'chat' : 'boss',
    agentTeamsEnabled: raw.agentTeamsEnabled !== false,
    workspaces,
    defaultWorkspace: workspaces.includes(requestedDefault) ? requestedDefault : workspaces[0] || null,
  };
}

/** Creation-time inheritance. Explicit false and empty arrays are user choices. */
export function resolveProjectSessionDefaults(project, input, global, fallbackWorkspace) {
  const defaults = normalizeProjectDefaults(project);
  const workspaces = defaults.workspaces.length ? defaults.workspaces : [fallbackWorkspace];
  const workspace = input.workspace || defaults.defaultWorkspace || workspaces[0];
  if (!workspaces.some(directory => path.resolve(directory) === path.resolve(workspace))) throw new Error('请选择项目配置中的工作目录。');
  const pickList = key => normalizeStringList(own(input, key) ? input[key] : project[key]);
  const assistantName = own(input, 'assistant_name') ? input.assistant_name : defaults.assistantName ?? (project.expertIds?.length === 1 ? project.expertIds[0] : null);
  return {
    ...input,
    projectId: project.id,
    workspace,
    agentMode: 'local',
    assistant_name: assistantName || '',
    connectorIds: pickList('connectorIds'), appIds: pickList('appIds'), appServiceIds: pickList('appServiceIds'),
    skillIds: pickList('skillIds'),
    permissionMode: normalizePermissionMode(input.permissionMode ?? defaults.permissionMode, global.permissionMode),
    mode: own(input, 'mode') ? (input.mode === 'boss' ? 'boss' : 'chat') : defaults.mode,
    projectDefaults: {
      version: 1, instructions: project.instructions || '', skillIds: pickList('skillIds'),
      expertIds: assistantName ? [assistantName] : own(input, 'assistant_name') || defaults.assistantName !== null
        ? [] : normalizeStringList(project.expertIds),
      agentTeamsEnabled: typeof input.agentTeamsEnabled === 'boolean' ? input.agentTeamsEnabled : defaults.agentTeamsEnabled,
    },
  };
}
