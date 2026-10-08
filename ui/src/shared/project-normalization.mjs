import { randomUUID } from 'node:crypto';
import { DESKTOP_PROJECT_KIND, DESKTOP_PROJECT_LAYOUT_VERSION, isDesktopProjectRecord } from '../desktop-data-layout.mjs';
import { normalizeProjectDecisionPolicy } from './project-decisions.mjs';
import { normalizeStringList } from './string-list.mjs';

export const PROJECT_TASK_STATUSES = new Set(['working', 'waiting_for_user', 'completed', 'failed', 'stopped']);

export function normalizeProjectId(projectId) {
  const id = typeof projectId === 'string' ? projectId.trim() : '';
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) {
    throw new Error('Invalid project id.');
  }
  return id;
}

export function normalizeOptionalProjectId(projectId) {
  if (projectId === null || projectId === undefined || projectId === '') return null;
  try {
    return normalizeProjectId(projectId);
  } catch {
    return null;
  }
}

function slugifyProjectName(name) {
  const slug = String(name || 'project')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'project';
}

export function createProjectId(name) {
  return `${slugifyProjectName(name)}-${randomUUID().slice(0, 8)}`;
}

export function normalizeProjectRecord(raw, fallbackId = '') {
  if (!isDesktopProjectRecord(raw)) return null;
  let id;
  try {
    id = normalizeProjectId(raw.id || fallbackId);
  } catch {
    return null;
  }
  const name = typeof raw.name === 'string' && raw.name.trim()
    ? raw.name.trim()
    : '未命名项目';
  const now = Date.now();
  return {
    kind: DESKTOP_PROJECT_KIND,
    layoutVersion: DESKTOP_PROJECT_LAYOUT_VERSION,
    id,
    name,
    instructions: typeof raw.instructions === 'string' ? raw.instructions : '',
    templateId: typeof raw.templateId === 'string' && raw.templateId.trim() ? raw.templateId.trim() : null,
    connectorIds: normalizeStringList(raw.connectorIds),
    expertIds: normalizeStringList(raw.expertIds),
    skillIds: normalizeStringList(raw.skillIds),
    decisionPolicy: normalizeProjectDecisionPolicy(raw.decisionPolicy),
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
    archivedAt: Number.isFinite(raw.archivedAt) ? raw.archivedAt : null,
  };
}

export function normalizeProjectMemoryIndex(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    version: Number.isFinite(source.version) ? Math.max(0, Math.floor(source.version)) : 0,
    updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : null,
    lastSessionId: typeof source.lastSessionId === 'string' ? source.lastSessionId : null,
    finalizedSessionCount: Number.isFinite(source.finalizedSessionCount)
      ? Math.max(0, Math.floor(source.finalizedSessionCount))
      : 0,
  };
}
