import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dump, load } from 'js-yaml';
import { MOSS_HOME } from './moss-home.mjs';

const MAX_AGENT_FILE_BYTES = 1024 * 1024;
const AGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function assertAgentName(value, field = 'Agent 名称') {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!AGENT_NAME_PATTERN.test(name)) {
    throw new Error(`${field}只能包含字母、数字、连字符和下划线，且不能超过 64 个字符。`);
  }
  return name;
}

function assertScope(value) {
  if (value !== 'user' && value !== 'project') {
    throw new Error('Agent 来源只能是用户或项目。');
  }
  return value;
}

function normalizeWorkspace(value) {
  const workspace = typeof value === 'string' ? value.trim() : '';
  return path.resolve(workspace || process.cwd());
}

function findProjectBoundary(workspace) {
  let current = normalizeWorkspace(workspace);
  while (true) {
    try {
      if (fs.existsSync(path.join(current, '.git'))) return current;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current || current === path.parse(current).root) return normalizeWorkspace(workspace);
    current = parent;
  }
}

function isPathInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function ensureRealRoot(root) {
  await fsp.mkdir(root, { recursive: true });
  return fsp.realpath(root);
}

async function resolveAgentFile(root, fileName, { createRoot = false } = {}) {
  const normalizedFileName = String(fileName || '').trim();
  if (
    !normalizedFileName.endsWith('.md')
    || normalizedFileName !== path.basename(normalizedFileName)
    || !AGENT_NAME_PATTERN.test(normalizedFileName.slice(0, -3))
  ) {
    throw new Error('Agent 文件名无效。');
  }

  const realRoot = createRoot
    ? await ensureRealRoot(root)
    : await fsp.realpath(root);
  const target = path.resolve(realRoot, normalizedFileName);
  if (!isPathInside(realRoot, target)) {
    throw new Error('Agent 文件必须位于 Agents 目录内。');
  }
  try {
    const stat = await fsp.lstat(target);
    if (stat.isSymbolicLink()) throw new Error('不能编辑符号链接 Agent 文件。');
    if (!stat.isFile()) throw new Error('Agent 路径不是普通文件。');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return target;
}

function parseAgentDocument(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('Agent 文件缺少有效的 YAML frontmatter。');
  const metadata = load(match[1]) || {};
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Agent frontmatter 必须是对象。');
  }
  return { metadata, prompt: match[2].trim() };
}

function normalizeStringList(value) {
  if (typeof value === 'string') {
    value = value.split(',');
  }
  if (!Array.isArray(value)) return undefined;
  const values = [...new Set(value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean))];
  return values.length > 0 ? values : undefined;
}

function validateDraftStringList(value, field) {
  const items = normalizeStringList(value);
  if (!items) return undefined;
  if (items.length > 256 || items.some((item) => item.length > 256)) {
    throw new Error(`${field}最多包含 256 项，且每项不能超过 256 个字符。`);
  }
  return items;
}

function assertUtf8Size(value, maximum, message) {
  if (Buffer.byteLength(value, 'utf8') > maximum) throw new Error(message);
}

function normalizeDraft(input) {
  const scope = assertScope(input?.scope);
  const name = assertAgentName(input?.name);
  const description = typeof input?.description === 'string' ? input.description.trim() : '';
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  if (!description) throw new Error('请填写 Agent 的使用场景。');
  if (!prompt) throw new Error('请填写 Agent 的系统提示。');
  if (description.length > 2_000) throw new Error('使用场景不能超过 2,000 个字符。');
  assertUtf8Size(prompt, MAX_AGENT_FILE_BYTES, '系统提示内容过大。');
  const model = typeof input?.model === 'string' ? input.model.trim() : '';
  if (model.length > 256 || /[\r\n]/.test(model)) throw new Error('模型名称无效。');
  const tools = validateDraftStringList(input?.tools, '工具列表');
  return {
    scope,
    name,
    description,
    prompt,
    ...(model ? { model } : {}),
    ...(tools ? { tools } : {}),
    ...(input?.background === true ? { background: true } : {}),
  };
}

function serializeAgentDocument(draft, previousMetadata = {}) {
  const metadata = { ...previousMetadata };
  metadata.name = draft.name;
  metadata.description = draft.description;
  if (draft.model) metadata.model = draft.model;
  else delete metadata.model;
  if (draft.tools) metadata.tools = draft.tools;
  else delete metadata.tools;
  if (draft.background) metadata.background = true;
  else delete metadata.background;
  const yaml = dump(metadata, {
    noRefs: true,
    lineWidth: -1,
    sortKeys: false,
  }).trimEnd();
  return `---\n${yaml}\n---\n\n${draft.prompt.trim()}\n`;
}

async function writeTextAtomic(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(temporaryPath, filePath);
  } finally {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

export function createDesktopAgentStore({
  userAgentsDir = path.join(MOSS_HOME, 'agents'),
} = {}) {
  const getRoots = (workspace) => ({
    user: path.resolve(userAgentsDir),
    project: path.join(findProjectBoundary(workspace), '.moss', 'agents'),
  });

  const getRoot = (scope, workspace) => getRoots(workspace)[assertScope(scope)];

  const read = async ({ scope, fileName, workspace }) => {
    const root = getRoot(scope, workspace);
    const target = await resolveAgentFile(root, fileName);
    const stat = await fsp.stat(target);
    if (stat.size > MAX_AGENT_FILE_BYTES) throw new Error('Agent 文件过大，无法在桌面端编辑。');
    const { metadata, prompt } = parseAgentDocument(await fsp.readFile(target, 'utf8'));
    return {
      scope,
      fileName,
      name: assertAgentName(metadata.name),
      description: typeof metadata.description === 'string' ? metadata.description : '',
      prompt,
      model: typeof metadata.model === 'string' ? metadata.model : '',
      tools: normalizeStringList(metadata.tools) || [],
      background: metadata.background === true || metadata.background === 'true',
    };
  };

  const create = async ({ workspace, ...input }) => {
    const draft = normalizeDraft(input);
    const root = getRoot(draft.scope, workspace);
    const target = await resolveAgentFile(root, `${draft.name}.md`, { createRoot: true });
    if (fs.existsSync(target)) throw new Error(`Agent “${draft.name}”已存在。`);
    const content = serializeAgentDocument(draft);
    assertUtf8Size(content, MAX_AGENT_FILE_BYTES, 'Agent 文件过大，无法保存。');
    await writeTextAtomic(target, content);
    return { scope: draft.scope, fileName: `${draft.name}.md`, path: target };
  };

  const update = async ({ workspace, previousScope, previousFileName, ...input }) => {
    const draft = normalizeDraft(input);
    const oldRoot = getRoot(previousScope, workspace);
    const oldTarget = await resolveAgentFile(oldRoot, previousFileName);
    const oldRaw = await fsp.readFile(oldTarget, 'utf8');
    if (Buffer.byteLength(oldRaw) > MAX_AGENT_FILE_BYTES) {
      throw new Error('Agent 文件过大，无法在桌面端编辑。');
    }
    const { metadata } = parseAgentDocument(oldRaw);
    const newRoot = getRoot(draft.scope, workspace);
    const newTarget = await resolveAgentFile(newRoot, `${draft.name}.md`, { createRoot: true });
    if (newTarget !== oldTarget && fs.existsSync(newTarget)) {
      throw new Error(`Agent “${draft.name}”已存在。`);
    }
    const content = serializeAgentDocument(draft, metadata);
    assertUtf8Size(content, MAX_AGENT_FILE_BYTES, 'Agent 文件过大，无法保存。');
    await writeTextAtomic(newTarget, content);
    if (newTarget !== oldTarget) await fsp.rm(oldTarget, { force: true });
    return { scope: draft.scope, fileName: `${draft.name}.md`, path: newTarget };
  };

  const remove = async ({ scope, fileName, workspace }) => {
    const root = getRoot(scope, workspace);
    const target = await resolveAgentFile(root, fileName);
    await fsp.rm(target, { force: true });
    return { deleted: true, path: target };
  };

  const canManage = async (entry, workspace) => {
    if (entry?.source !== 'user' && entry?.source !== 'project') return false;
    if (!entry.location || !entry.fileName) return false;
    try {
      const root = getRoot(entry.source, workspace);
      const stem = entry.fileName.endsWith('.md')
        ? entry.fileName.slice(0, -3)
        : entry.fileName;
      assertAgentName(stem);
      const expected = await resolveAgentFile(root, `${stem}.md`);
      const actual = await fsp.realpath(entry.location);
      return actual === expected;
    } catch {
      return false;
    }
  };

  return {
    getRoots,
    read,
    create,
    update,
    remove,
    canManage,
  };
}

export function buildExplicitAgentDispatchInstruction(agentType) {
  const name = typeof agentType === 'string' ? agentType.trim() : '';
  if (!name) throw new Error('缺少 Agent 名称。');
  const quotedName = JSON.stringify(name);
  return [
    '<system-reminder>',
    `The user explicitly selected the worker Agent ${quotedName} for this turn.`,
    `You MUST call the Agent tool with subagent_type=${quotedName} before doing substantive work yourself.`,
    'Pass the complete user request and relevant attachment context to that Agent, then use its result to answer the user.',
    'Do not silently substitute another Agent type.',
    '</system-reminder>',
  ].join('\n');
}

export { AGENT_NAME_PATTERN, findProjectBoundary, parseAgentDocument };
