import electron from 'electron';
const { ipcMain } = electron;
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const MOSS_HOME = path.join(os.homedir(), '.moss');
const MOSS_ASSISTANTS_DIR = path.join(MOSS_HOME, 'assistants');
const LEGACY_MOSS_EXPERTS_DIR = path.join(MOSS_HOME, 'experts');
const EXPERT_HUB_DIR = path.join(MOSS_HOME, 'expert-hub');
const EXPERT_CACHE_DIR = path.join(EXPERT_HUB_DIR, 'cache');
const EXPERT_CACHE_MANIFEST_DIR = path.join(EXPERT_CACHE_DIR, 'manifests');
const EXPERT_CACHE_PROMPT_DIR = path.join(EXPERT_CACHE_DIR, 'prompts');
const EXPERT_CACHE_BUNDLE_DIR = path.join(EXPERT_CACHE_DIR, 'bundles');
const EXPERT_META_FILE = '_moss_meta.json';
const ASSISTANT_RULE_FILE = 'assistant.md';
const EXPERT_SOURCE_TYPE = 'workbuddy-expert-marketplace';
const RESERVED_ASSISTANT_ROOT_NAMES = ['hub', 'system', '_my-custom-assistant'];
const DEFAULT_EXPERT_HUB_BASE_URL = 'https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace';
const PUBLIC_MANIFEST_FILES = ['expert_center.json', 'externalExpert.json'];
const FEATURED_SCENES_FILE = 'featuredScenes.json';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30000;
const expertInstallPromises = new Map();

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeBaseUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_EXPERT_HUB_BASE_URL;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return DEFAULT_EXPERT_HUB_BASE_URL;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return DEFAULT_EXPERT_HUB_BASE_URL;
  }
}

function buildHubUrl(baseUrl, relativePath) {
  const rawPath = String(relativePath || '').trim();
  if (/^https?:\/\//i.test(rawPath)) return rawPath;
  const normalizedPath = rawPath.replace(/^\/+/, '');
  return new URL(normalizedPath, `${normalizeBaseUrl(baseUrl)}/`).toString();
}

function textValue(value, locale = 'zh') {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!isRecord(value)) return '';
  const candidates = [
    value[locale],
    value[locale === 'zh' ? 'zh-CN' : locale],
    value.zh,
    value['zh-CN'],
    value.en,
    value['en-US'],
    value.default,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeDirName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return null;
  return trimmed
    .replace(/[\0<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || null;
}

function isPathInsideDir(rootDir, targetPath) {
  const relativePath = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isStrictPathInsideDir(rootDir, targetPath) {
  const relativePath = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function isReservedAssistantRootDir(targetPath) {
  const resolvedTarget = path.resolve(targetPath);
  return RESERVED_ASSISTANT_ROOT_NAMES.some(
    (name) => path.resolve(MOSS_ASSISTANTS_DIR, name) === resolvedTarget,
  );
}

function isExpertMeta(meta) {
  return meta?.kind === 'expert' || meta?.source_type === EXPERT_SOURCE_TYPE || meta?.sourceType === EXPERT_SOURCE_TYPE;
}

function safeRelativePath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\/+/, '');
  if (!normalized || normalized === '.' || normalized === '..') return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) return null;
  if (normalized.startsWith('../') || /^[a-zA-Z]:\//.test(normalized)) return null;
  return normalized;
}

function resolvePromptCachePath(relativePath) {
  const safePath = safeRelativePath(relativePath);
  if (!safePath) return null;
  const targetPath = path.resolve(EXPERT_CACHE_PROMPT_DIR, safePath);
  return isPathInsideDir(EXPERT_CACHE_PROMPT_DIR, targetPath) ? targetPath : null;
}

function resolveBundleCachePath(pluginName) {
  const safeName = sanitizeDirName(pluginName);
  if (!safeName) return null;
  const targetPath = path.resolve(EXPERT_CACHE_BUNDLE_DIR, `${safeName}.tar.gz`);
  return isPathInsideDir(EXPERT_CACHE_BUNDLE_DIR, targetPath) ? targetPath : null;
}

function normalizeTarPath(entryPath) {
  return String(entryPath || '')
    .replace(/\0.*$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
}

function readTarString(buffer, start, length) {
  return buffer.subarray(start, start + length).toString('utf-8').replace(/\0.*$/g, '').trim();
}

function readTarNumber(buffer, start, length) {
  const raw = readTarString(buffer, start, length);
  if (!raw) return 0;
  return Number.parseInt(raw, 8) || 0;
}

function parseTarFiles(buffer) {
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const typeFlag = readTarString(header, 156, 1) || '0';
    const size = readTarNumber(header, 124, 12);
    const fullName = normalizeTarPath(prefix ? `${prefix}/${name}` : name);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if ((typeFlag === '0' || typeFlag === '') && fullName && safeRelativePath(fullName) && dataEnd <= buffer.length) {
      files.set(fullName, buffer.subarray(dataStart, dataEnd));
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

function gunzip(buffer) {
  return new Promise((resolve, reject) => {
    zlib.gunzip(buffer, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

async function readJsonFile(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf-8'));
}

async function tryStat(filePath) {
  try {
    return await fsp.stat(filePath);
  } catch {
    return null;
  }
}

function isFresh(stat, maxAgeMs = CACHE_TTL_MS) {
  return Boolean(stat && Date.now() - stat.mtimeMs < maxAgeMs);
}

async function fetchBuffer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/markdown,text/plain,*/*',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCachedJson(baseUrl, fileName, { forceRefresh = false, maxAgeMs = CACHE_TTL_MS, optional = false } = {}) {
  const safeFileName = safeRelativePath(fileName);
  if (!safeFileName) throw new Error(`Invalid manifest path: ${fileName}`);
  const cachePath = path.join(EXPERT_CACHE_MANIFEST_DIR, safeFileName);
  const stat = await tryStat(cachePath);
  if (!forceRefresh && isFresh(stat, maxAgeMs)) {
    return {
      data: await readJsonFile(cachePath),
      source: 'cache',
      cachePath,
      updatedAt: stat.mtimeMs,
    };
  }

  const url = buildHubUrl(baseUrl, safeFileName);
  try {
    const buffer = await fetchBuffer(url);
    const text = buffer.toString('utf-8');
    const data = JSON.parse(text);
    await fsp.mkdir(path.dirname(cachePath), { recursive: true });
    await fsp.writeFile(cachePath, JSON.stringify(data, null, 2), 'utf-8');
    const nextStat = await tryStat(cachePath);
    return {
      data,
      source: 'network',
      cachePath,
      updatedAt: nextStat?.mtimeMs || Date.now(),
    };
  } catch (error) {
    if (stat) {
      return {
        data: await readJsonFile(cachePath),
        source: 'stale-cache',
        cachePath,
        updatedAt: stat.mtimeMs,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
    if (optional) {
      return {
        data: null,
        source: 'missing',
        cachePath,
        updatedAt: 0,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }
}

async function fetchCachedText(baseUrl, relativePath, { forceRefresh = false } = {}) {
  const safePath = safeRelativePath(relativePath);
  if (!safePath) throw new Error(`Invalid prompt path: ${relativePath}`);
  const cachePath = resolvePromptCachePath(safePath);
  if (!cachePath) throw new Error(`Invalid prompt path: ${relativePath}`);
  const stat = await tryStat(cachePath);
  if (!forceRefresh && isFresh(stat)) {
    return {
      text: await fsp.readFile(cachePath, 'utf-8'),
      source: 'cache',
      cachePath,
      updatedAt: stat.mtimeMs,
    };
  }

  try {
    const buffer = await fetchBuffer(buildHubUrl(baseUrl, safePath));
    const text = buffer.toString('utf-8');
    await fsp.mkdir(path.dirname(cachePath), { recursive: true });
    await fsp.writeFile(cachePath, text, 'utf-8');
    const nextStat = await tryStat(cachePath);
    return {
      text,
      source: 'network',
      cachePath,
      updatedAt: nextStat?.mtimeMs || Date.now(),
    };
  } catch (error) {
    if (stat) {
      return {
        text: await fsp.readFile(cachePath, 'utf-8'),
        source: 'stale-cache',
        cachePath,
        updatedAt: stat.mtimeMs,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }
}

async function fetchCachedBundle(baseUrl, pluginName, { forceRefresh = false } = {}) {
  const safeName = sanitizeDirName(pluginName);
  if (!safeName) throw new Error(`Invalid plugin name: ${pluginName}`);
  const cachePath = resolveBundleCachePath(safeName);
  if (!cachePath) throw new Error(`Invalid plugin name: ${pluginName}`);
  const stat = await tryStat(cachePath);
  if (!forceRefresh && isFresh(stat)) {
    return {
      buffer: await fsp.readFile(cachePath),
      source: 'cache',
      cachePath,
      updatedAt: stat.mtimeMs,
    };
  }

  try {
    const buffer = await fetchBuffer(buildHubUrl(baseUrl, `bundles/${safeName}.tar.gz`));
    await fsp.mkdir(path.dirname(cachePath), { recursive: true });
    await fsp.writeFile(cachePath, buffer);
    const nextStat = await tryStat(cachePath);
    return {
      buffer,
      source: 'network',
      cachePath,
      updatedAt: nextStat?.mtimeMs || Date.now(),
    };
  } catch (error) {
    if (stat) {
      return {
        buffer: await fsp.readFile(cachePath),
        source: 'stale-cache',
        cachePath,
        updatedAt: stat.mtimeMs,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }
}

async function loadPluginBundleFiles(baseUrl, pluginName, { forceRefresh = false } = {}) {
  const loaded = await fetchCachedBundle(baseUrl, pluginName, { forceRefresh });
  const tarBuffer = await gunzip(loaded.buffer);
  return {
    files: parseTarFiles(tarBuffer),
    source: loaded.source,
    cachePath: loaded.cachePath,
    updatedAt: loaded.updatedAt,
    warning: loaded.warning || '',
  };
}

function bundleRelativePromptPath(promptFile, pluginName) {
  const safePrompt = safeRelativePath(promptFile);
  if (!safePrompt) return null;
  const safePlugin = safeRelativePath(pluginName);
  if (safePlugin) {
    const pluginPrefix = `plugins/${safePlugin}/`;
    if (safePrompt.startsWith(pluginPrefix)) return safePrompt.slice(pluginPrefix.length);
  }
  const agentsIndex = safePrompt.indexOf('agents/');
  if (agentsIndex >= 0) return safePrompt.slice(agentsIndex);
  return safePrompt;
}

function readBundlePrompt(pluginBundle, promptFile, pluginName) {
  if (!pluginBundle) return null;
  const relativePath = bundleRelativePromptPath(promptFile, pluginName);
  if (!relativePath) return null;
  const candidates = Array.from(new Set([
    relativePath,
    normalizeTarPath(relativePath),
    path.posix.basename(relativePath) ? `agents/${path.posix.basename(relativePath)}` : '',
  ].filter(Boolean)));
  for (const candidate of candidates) {
    const buffer = pluginBundle.files.get(candidate);
    if (buffer) {
      return {
        text: buffer.toString('utf-8'),
        source: pluginBundle.source,
        cachePath: `${pluginBundle.cachePath}:${candidate}`,
        updatedAt: pluginBundle.updatedAt,
        warning: pluginBundle.warning || '',
      };
    }
  }
  return null;
}

function inferMemberPromptFile(member) {
  const promptFile = String(member?.promptFile || member?.prompt || '').trim();
  if (promptFile) return promptFile;
  const id = String(member?.id || member?.agentName || member?.name || '').trim();
  if (!id) return '';
  return `agents/${id}.md`;
}

async function fetchExpertPrompt(baseUrl, promptFile, { forceRefresh = false, pluginName = '', pluginBundle = null } = {}) {
  const fromBundle = readBundlePrompt(pluginBundle, promptFile, pluginName);
  if (fromBundle) return fromBundle;
  return fetchCachedText(baseUrl, promptFile, { forceRefresh });
}

function hasMarkdownFrontmatter(text) {
  return /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.test(String(text || ''));
}

function buildInstallMarkdown(expert, promptText) {
  const text = String(promptText || '').trim();
  if (hasMarkdownFrontmatter(text)) return `${text}\n`;
  return buildExpertMarkdown(expert, text);
}

function getBundleFilesUnder(pluginBundle, prefix) {
  const normalizedPrefix = normalizeTarPath(prefix).replace(/\/?$/, '/');
  return [...pluginBundle.files.entries()]
    .filter(([entryPath]) => entryPath.startsWith(normalizedPrefix) && !entryPath.endsWith('/'))
    .map(([entryPath, buffer]) => ({
      entryPath,
      relativePath: entryPath.slice(normalizedPrefix.length),
      buffer,
    }))
    .filter((entry) => Boolean(safeRelativePath(entry.relativePath)));
}

async function writeBundleFiles(pluginBundle, targetDir) {
  const copied = [];
  for (const [entryPath, buffer] of pluginBundle.files.entries()) {
    const safePath = safeRelativePath(entryPath);
    if (!safePath) continue;
    const targetPath = path.resolve(targetDir, safePath);
    if (!isPathInsideDir(targetDir, targetPath)) continue;
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, buffer);
    copied.push(safePath);
  }
  return copied;
}

async function writeBundleSubdirAsMossConfig(pluginBundle, sourceSubdir, targetRoot) {
  const copied = [];
  const targetDir = path.join(targetRoot, '.moss', sourceSubdir);
  for (const entry of getBundleFilesUnder(pluginBundle, sourceSubdir)) {
    const safePath = safeRelativePath(entry.relativePath);
    if (!safePath) continue;
    const targetPath = path.resolve(targetDir, safePath);
    if (!isPathInsideDir(targetDir, targetPath)) continue;
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, entry.buffer);
    copied.push(path.posix.join('.moss', sourceSubdir, safePath));
  }
  return copied;
}

function getBundleAgentNames(pluginBundle) {
  if (!pluginBundle) return [];
  return getBundleFilesUnder(pluginBundle, 'agents')
    .filter((entry) => entry.relativePath.toLowerCase().endsWith('.md'))
    .map((entry) => sanitizeDirName(path.posix.basename(entry.relativePath, '.md')))
    .filter(Boolean);
}

function normalizeInstalledRelativePath(value) {
  const safePath = safeRelativePath(value);
  if (!safePath) return '';
  return safePath.replace(/^\.\/+/, '');
}

function getBundleSkillDirs(pluginBundle) {
  if (!pluginBundle) return [];
  const dirs = new Set();
  for (const entry of getBundleFilesUnder(pluginBundle, 'skills')) {
    const parts = entry.relativePath.split('/').filter(Boolean);
    if (parts.length > 0) dirs.add(`skills/${parts[0]}`);
  }
  return [...dirs].sort((a, b) => a.localeCompare(b));
}

function readBundlePluginJson(pluginBundle) {
  if (!pluginBundle) return null;
  const buffer = pluginBundle.files.get('.codebuddy-plugin/plugin.json') || pluginBundle.files.get('plugin.json');
  if (!buffer) return null;
  try {
    return JSON.parse(buffer.toString('utf-8'));
  } catch {
    return null;
  }
}

function getInstalledSkillDirsFromPluginBundle(pluginBundle) {
  const pluginJson = readBundlePluginJson(pluginBundle);
  const fromPluginJson = Array.isArray(pluginJson?.skills)
    ? pluginJson.skills
        .map((entry) => normalizeInstalledRelativePath(entry))
        .filter((entry) => entry.startsWith('skills/'))
        .map((entry) => entry.split('/').slice(0, 2).join('/'))
    : [];
  return Array.from(new Set([
    ...fromPluginJson,
    ...getBundleSkillDirs(pluginBundle),
  ])).sort((a, b) => a.localeCompare(b));
}

function toRuntimeSkillDirs(skillDirs) {
  return Array.from(new Set((skillDirs || [])
    .map((entry) => normalizeInstalledRelativePath(entry))
    .filter(Boolean)
    .map((entry) => {
      if (entry.startsWith('.moss/skills/')) return entry;
      if (entry.startsWith('skills/')) return path.posix.join('.moss', entry);
      return '';
    })
    .filter(Boolean)));
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return value;
  }
  return '';
}

function memberLookupKeys(member) {
  if (!isRecord(member)) return [];
  const keys = new Set();
  for (const value of [member.id, member.agentName, member.name, member.displayName]) {
    const key = sanitizeDirName(value);
    if (key) keys.add(key);
  }
  for (const value of [member.promptFile, member.localPromptFile, member.remotePromptFile]) {
    const normalized = String(value || '').trim().replace(/\\/g, '/');
    if (!normalized) continue;
    const key = sanitizeDirName(path.posix.basename(normalized, '.md'));
    if (key) keys.add(key);
  }
  return [...keys];
}

function buildMemberLookup(members) {
  const lookup = new Map();
  if (!Array.isArray(members)) return lookup;
  for (const member of members) {
    if (!isRecord(member)) continue;
    for (const key of memberLookupKeys(member)) {
      if (!lookup.has(key)) lookup.set(key, member);
    }
  }
  return lookup;
}

function findMatchingMember(member, lookup) {
  for (const key of memberLookupKeys(member)) {
    const matched = lookup.get(key);
    if (matched) return matched;
  }
  return null;
}

function mergeInstalledMembersFromBundle(expert, installedMembers, pluginBundle) {
  const byId = new Map(installedMembers.map((member) => [
    sanitizeDirName(member.id || member.agentName || member.name),
    member,
  ]));
  const allAgentNames = getBundleAgentNames(pluginBundle);
  const availableAgentNames = new Set(allAgentNames);
  const merged = [];
  const seen = new Set();

  for (const member of expert.members || []) {
    const promptFile = inferMemberPromptFile(member);
    const promptName = sanitizeDirName(path.posix.basename(bundleRelativePromptPath(promptFile, expert.plugin) || '', '.md'));
    const agentName = sanitizeDirName(member.id || member.agentName || member.name) || promptName;
    if (!agentName || (!availableAgentNames.has(agentName) && !byId.has(agentName))) continue;
    const installedMember = byId.get(agentName);
    const localPromptFile = installedMember?.localPromptFile || path.join('agents', `${agentName}.md`);
    merged.push({
      ...member,
      ...(installedMember || {}),
      id: member.id || installedMember?.id || agentName,
      name: firstNonEmpty(member.name, installedMember?.name, agentName),
      displayName: firstNonEmpty(member.displayName, installedMember?.displayName, member.name, agentName),
      profession: firstNonEmpty(member.profession, installedMember?.profession),
      role: firstNonEmpty(member.role, installedMember?.role),
      remotePromptFile: firstNonEmpty(member.promptFile, installedMember?.remotePromptFile, installedMember?.promptFile),
      promptFile: localPromptFile,
      localPromptFile,
      runtimePromptFile: path.posix.join('.moss', 'agents', `${agentName}.md`),
    });
    seen.add(agentName);
  }

  for (const agentName of allAgentNames) {
    if (seen.has(agentName)) continue;
    const manifestMember = (expert.members || []).find((member) => (
      sanitizeDirName(member.id || member.agentName || member.name) === agentName
    ));
    const localPromptFile = path.join('agents', `${agentName}.md`);
    merged.push({
      ...(manifestMember || {}),
      id: manifestMember?.id || agentName,
      name: firstNonEmpty(manifestMember?.name, agentName),
      displayName: firstNonEmpty(manifestMember?.displayName, manifestMember?.name, agentName),
      profession: firstNonEmpty(manifestMember?.profession),
      role: firstNonEmpty(manifestMember?.role),
      remotePromptFile: firstNonEmpty(manifestMember?.promptFile),
      promptFile: localPromptFile,
      localPromptFile,
      runtimePromptFile: path.posix.join('.moss', 'agents', `${agentName}.md`),
    });
  }
  return merged;
}

function extractArray(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeTagList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => textValue(entry) || String(entry || '').trim()).filter(Boolean)));
}

function normalizeVisibility(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  const text = String(value || '').trim();
  return text ? [text] : [];
}

function isVisibleExpert(expert) {
  const visibility = normalizeVisibility(expert?.visibility);
  if (visibility.includes('none')) return false;
  if (visibility.some((entry) => ['internal', 'private'].includes(entry))) {
    return visibility.some((entry) => ['all', 'external', 'public'].includes(entry));
  }
  return true;
}

function getExpertId(expert) {
  return String(expert?.id || expert?.agentName || expert?.name || expert?.displayName || '').trim();
}

function normalizeMember(member, categoryMap, baseUrl) {
  if (!isRecord(member)) return null;
  const id = getExpertId(member);
  const displayName = textValue(member.displayName) || textValue(member.name) || id;
  if (!id && !displayName) return null;
  const categoryId = String(member.categoryId || member.category || '').trim();
  const promptFile = String(member.promptFile || member.prompt || '').trim();
  return {
    id: id || displayName,
    name: textValue(member.name) || displayName,
    displayName,
    profession: textValue(member.profession) || textValue(member.title) || '',
    description: textValue(member.description) || '',
    role: String(member.role || '').trim(),
    categoryId,
    categoryName: categoryMap.get(categoryId)?.name || '',
    avatar: member.avatar ? buildHubUrl(baseUrl, member.avatar) : '',
    promptFile,
    agentName: String(member.agentName || '').trim(),
    plugin: String(member.plugin || '').trim(),
  };
}

function normalizeCategory(category, count = 0) {
  if (!isRecord(category)) return null;
  const id = String(category.id || category.categoryId || category.key || category.name || '').trim();
  const name = textValue(category.displayName) || textValue(category.name) || textValue(category.title) || id;
  if (!id && !name) return null;
  return {
    id: id || name,
    key: id || name,
    name,
    description: textValue(category.description) || '',
    count,
  };
}

function normalizeExpert(expert, categoryMap, baseUrl, sourceManifest, manifestUpdatedAt = 0) {
  if (!isRecord(expert) || !isVisibleExpert(expert)) return null;
  const id = getExpertId(expert);
  const displayName = textValue(expert.displayName) || textValue(expert.name) || id;
  if (!id && !displayName) return null;
  const categoryId = String(expert.categoryId || expert.category || '').trim();
  const promptFile = String(expert.promptFile || expert.prompt || '').trim();
  const type = String(expert.expertType || expert.type || '').trim().toLowerCase() === 'team' ? 'team' : 'agent';
  const members = Array.isArray(expert.members)
    ? expert.members.map((member) => normalizeMember(member, categoryMap, baseUrl)).filter(Boolean)
    : [];
  return {
    id: id || displayName,
    type,
    name: textValue(expert.name) || displayName,
    displayName,
    profession: textValue(expert.profession) || textValue(expert.title) || '',
    description: textValue(expert.description) || textValue(expert.defaultInitPrompt) || '',
    categoryId,
    categoryName: categoryMap.get(categoryId)?.name || '',
    avatar: expert.avatar ? buildHubUrl(baseUrl, expert.avatar) : '',
    promptFile,
    plugin: String(expert.plugin || '').trim(),
    agentName: String(expert.agentName || '').trim(),
    tags: normalizeTagList(expert.tags),
    quickPrompts: Array.isArray(expert.quickPrompts) ? expert.quickPrompts : [],
    members,
    isOPC: Boolean(expert.isOPC),
    sourceManifest,
    manifestUpdatedAt,
    createdAt: String(expert.createdAt || '').trim(),
    updatedAt: String(expert.updatedAt || '').trim(),
    ranking: numberValue(expert.ranking ?? expert.rank, 0),
  };
}

function getSceneExpertIds(scene) {
  const ids = [];
  const directId = String(scene?.expertId || '').trim();
  if (directId) ids.push(directId);
  const expertIds = Array.isArray(scene?.expertIds) ? scene.expertIds : [];
  for (const expertId of expertIds) {
    const id = String(expertId || '').trim();
    if (id) ids.push(id);
  }
  const experts = Array.isArray(scene?.experts) ? scene.experts : [];
  for (const expert of experts) {
    const id = typeof expert === 'string' ? expert : String(expert?.expertId || expert?.id || '').trim();
    if (id) ids.push(id);
  }
  return Array.from(new Set(ids));
}

function normalizeScene(scene, baseUrl, expertById) {
  if (!isRecord(scene)) return null;
  const id = String(scene.id || scene.sceneId || '').trim();
  const name = textValue(scene.displayName) || textValue(scene.name) || id;
  if (!id && !name) return null;
  const expertIds = getSceneExpertIds(scene);
  const expertDisplayNames = isRecord(scene.expertDisplayNames) ? scene.expertDisplayNames : {};
  const expertAvatars = isRecord(scene.expertAvatars) ? scene.expertAvatars : {};
  const experts = expertIds.map((expertId) => {
    const expert = expertById.get(expertId);
    if (expert) {
      return {
        id: expert.id,
        displayName: expert.displayName,
        profession: expert.profession,
        avatar: expert.avatar,
        type: expert.type,
      };
    }
    return {
      id: expertId,
      displayName: textValue(expertDisplayNames[expertId]) || expertId,
      profession: '',
      avatar: expertAvatars[expertId] ? buildHubUrl(baseUrl, expertAvatars[expertId]) : '',
      type: 'agent',
    };
  });
  return {
    id: id || name,
    name,
    description: textValue(scene.description) || '',
    image: scene.image ? buildHubUrl(baseUrl, scene.image) : '',
    darkImage: scene.darkImage ? buildHubUrl(baseUrl, scene.darkImage) : '',
    expertIds,
    experts,
  };
}

function getExpertTimestamp(expert) {
  return Date.parse(expert.updatedAt || expert.createdAt || '') || 0;
}

function getExpertHotScore(expert) {
  return numberValue(expert.ranking)
    || (expert.isOPC ? 100 : 0)
    + (Array.isArray(expert.members) ? expert.members.length * 12 : 0)
    + (Array.isArray(expert.quickPrompts) ? expert.quickPrompts.length * 2 : 0)
    + (Array.isArray(expert.tags) ? expert.tags.length : 0);
}

function sortExperts(experts, sortBy = 'comprehensive') {
  const next = [...experts];
  const mode = String(sortBy || 'comprehensive');
  if (mode === 'name') {
    next.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'));
  } else if (mode === 'latest' || mode === 'updated' || mode === 'updated_at') {
    next.sort((a, b) => getExpertTimestamp(b) - getExpertTimestamp(a) || a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'));
  } else if (mode === 'hot') {
    next.sort((a, b) => getExpertHotScore(b) - getExpertHotScore(a) || getExpertTimestamp(b) - getExpertTimestamp(a));
  } else {
    next.sort((a, b) => {
      const scoreDiff = getExpertHotScore(b) - getExpertHotScore(a);
      if (scoreDiff) return scoreDiff;
      return getExpertTimestamp(b) - getExpertTimestamp(a) || a.displayName.localeCompare(b.displayName, 'zh-Hans-CN');
    });
  }
  return next;
}

function filterExperts(experts, { query = '', category = '', type = 'all', sortBy = 'updated' } = {}) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  return sortExperts(experts.filter((expert) => {
    if (category && expert.categoryId !== category && expert.categoryName !== category) return false;
    if (type && type !== 'all' && expert.type !== type) return false;
    if (!normalizedQuery) return true;
    return [
      expert.id,
      expert.name,
      expert.displayName,
      expert.profession,
      expert.description,
      expert.categoryName,
      expert.plugin,
      expert.agentName,
      ...(expert.tags || []),
    ].join(' ').toLowerCase().includes(normalizedQuery);
  }), sortBy);
}

function paginate(items, page, pageSize) {
  const safePage = Math.max(1, Number.parseInt(String(page || 1), 10) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number.parseInt(String(pageSize || 20), 10) || 20));
  const start = (safePage - 1) * safePageSize;
  return {
    items: items.slice(start, start + safePageSize),
    total: items.length,
    page: safePage,
    pageSize: safePageSize,
    hasMore: start + safePageSize < items.length,
  };
}

function getManifestCategories(manifest) {
  return extractArray(manifest, ['categories', 'categoryList', 'expertCategories']);
}

function getManifestExperts(manifest) {
  return extractArray(manifest, ['experts', 'expertList', 'items', 'list']);
}

async function loadExpertBundle(baseUrl, { forceRefresh = false } = {}) {
  const manifests = [];
  for (const fileName of PUBLIC_MANIFEST_FILES) {
    try {
      const loaded = await fetchCachedJson(baseUrl, fileName, {
        forceRefresh,
        optional: fileName !== 'expert_center.json',
      });
      if (loaded.data) manifests.push({ fileName, ...loaded });
    } catch (error) {
      if (fileName === 'expert_center.json') throw error;
    }
  }

  const categoryMap = new Map();
  const rawExperts = new Map();
  const sourceById = new Map();
  const manifestUpdatedById = new Map();

  for (const manifest of manifests) {
    for (const category of getManifestCategories(manifest.data)) {
      const normalized = normalizeCategory(category);
      if (normalized && !categoryMap.has(normalized.id)) categoryMap.set(normalized.id, normalized);
    }
    for (const expert of getManifestExperts(manifest.data)) {
      const id = getExpertId(expert);
      if (!id) continue;
      rawExperts.set(id, expert);
      sourceById.set(id, manifest.fileName);
      manifestUpdatedById.set(id, manifest.updatedAt);
    }
  }

  const expertList = [];
  const categoryCounts = new Map();
  for (const [id, expert] of rawExperts) {
    const normalized = normalizeExpert(
      expert,
      categoryMap,
      baseUrl,
      sourceById.get(id) || 'expert_center.json',
      manifestUpdatedById.get(id) || 0,
    );
    if (!normalized) continue;
    expertList.push(normalized);
    if (normalized.categoryId) {
      categoryCounts.set(normalized.categoryId, (categoryCounts.get(normalized.categoryId) || 0) + 1);
    }
  }

  const categories = [...categoryMap.values()]
    .map((category) => ({ ...category, count: categoryCounts.get(category.id) || 0 }))
    .filter((category) => category.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'));

  return {
    categories,
    experts: sortExperts(expertList),
    rawExperts,
    sourceById,
    manifestUpdatedById,
    manifests: manifests.map((manifest) => ({
      fileName: manifest.fileName,
      source: manifest.source,
      cachePath: manifest.cachePath,
      updatedAt: manifest.updatedAt,
      warning: manifest.warning || '',
    })),
  };
}

async function getFeaturedExpertIds(baseUrl, { forceRefresh = false } = {}) {
  try {
    const loaded = await fetchCachedJson(baseUrl, FEATURED_SCENES_FILE, { forceRefresh, optional: true });
    const scenes = Array.isArray(loaded.data) ? loaded.data : extractArray(loaded.data, ['scenes', 'items', 'featuredScenes']);
    const ids = [];
    for (const scene of scenes) {
      ids.push(...getSceneExpertIds(scene));
    }
    return Array.from(new Set(ids));
  } catch {
    return [];
  }
}

async function readExpertMeta(expertDir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(expertDir, EXPERT_META_FILE), 'utf-8'));
  } catch {
    return null;
  }
}

function normalizeInstalledMember(member, rawMemberLookup = new Map()) {
  if (!isRecord(member)) return null;
  const rawMember = findMatchingMember(member, rawMemberLookup);
  const id = String(member.id || member.agentName || member.name || '').trim();
  const fileName = `${sanitizeDirName(id) || 'member'}.md`;
  const existingPromptFile = String(member.promptFile || '').trim();
  const existingLocalPromptFile = String(member.localPromptFile || '').trim();
  const looksRemotePrompt =
    existingPromptFile.startsWith('/') ||
    existingPromptFile.startsWith('plugins/') ||
    /^https?:\/\//i.test(existingPromptFile);
  const localPromptFile = existingLocalPromptFile || (looksRemotePrompt ? path.join('agents', fileName) : existingPromptFile || path.join('agents', fileName));
  const remotePromptFile = String(member.remotePromptFile || (looksRemotePrompt ? existingPromptFile : '')).trim();
  return {
    ...member,
    role: firstNonEmpty(member.role, rawMember?.role),
    ...(remotePromptFile ? { remotePromptFile } : {}),
    promptFile: localPromptFile,
    localPromptFile,
    runtimePromptFile: String(member.runtimePromptFile || path.posix.join('.moss', 'agents', path.posix.basename(localPromptFile))).trim(),
  };
}

function normalizeInstalledMembersForMeta(meta) {
  if (!Array.isArray(meta?.members)) return [];
  const rawMemberLookup = buildMemberLookup(meta.raw_members);
  return meta.members.map((member) => normalizeInstalledMember(member, rawMemberLookup)).filter(Boolean);
}

async function getInstalledSkillDirsFromDisk(expertDir) {
  const dirs = new Set();
  for (const root of ['skills', path.join('.moss', 'skills')]) {
    const rootPath = path.join(expertDir, root);
    let entries = [];
    try {
      entries = await fsp.readdir(rootPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const skillPath = path.join(rootPath, entry.name, 'SKILL.md');
        const stat = await fsp.stat(skillPath);
        if (stat.isFile()) dirs.add(path.posix.join('skills', entry.name));
      } catch {
        // Ignore incomplete skill folders.
      }
    }
  }
  return [...dirs].sort((a, b) => a.localeCompare(b));
}

function normalizeInstalledExpert(meta, entryName, expertDir) {
  const expertType = meta?.expert_type || meta?.expertType || meta?.type;
  const members = normalizeInstalledMembersForMeta(meta);
  const skills = Array.isArray(meta?.skills)
    ? meta.skills.map((entry) => normalizeInstalledRelativePath(entry)).filter(Boolean)
    : [];
  const topLevelPromptFile = String(meta?.prompt_file || ASSISTANT_RULE_FILE).trim();
  return {
    id: meta?.id || entryName,
    type: expertType === 'team' ? 'team' : 'agent',
    name: meta?.name || meta?.id || entryName,
    displayName: meta?.display_name || meta?.displayName || meta?.name || entryName,
    profession: meta?.profession || '',
    description: meta?.description || '',
    categoryId: meta?.category_id || meta?.categoryId || '',
    categoryName: meta?.category_name || meta?.categoryName || '',
    avatar: meta?.avatar || '',
    promptFile: topLevelPromptFile || ASSISTANT_RULE_FILE,
    remotePromptFile: meta?.remote_prompt_file || meta?.remotePromptFile || '',
    plugin: meta?.plugin || '',
    agentName: meta?.agent_name || meta?.agentName || '',
    tags: Array.isArray(meta?.tags) ? meta.tags : [],
    members,
    skills,
    enabledSkills: Array.isArray(meta?.enabledSkills)
      ? meta.enabledSkills.map((entry) => normalizeInstalledRelativePath(entry)).filter(Boolean)
      : skills,
    runtimeSkills: Array.isArray(meta?.runtimeSkills)
      ? meta.runtimeSkills.map((entry) => normalizeInstalledRelativePath(entry)).filter(Boolean)
      : toRuntimeSkillDirs(skills),
    sourceType: meta?.source_type || 'local',
    sourceManifest: meta?.source_manifest || '',
    sourceBaseUrl: meta?.source_base_url || '',
    installedAt: meta?.installed_at || '',
    enabled: meta?.enabled !== false,
    source: expertDir,
  };
}

async function repairInstalledExpertMetaIfNeeded(expertDir, meta) {
  if (!isExpertMeta(meta)) return meta;
  const normalizedMembers = normalizeInstalledMembersForMeta(meta);
  const existingPromptFile = String(meta.prompt_file || meta.promptFile || '').trim();
  const existingLocalPromptFile = String(meta.local_prompt_file || meta.localPromptFile || meta.ruleFile || ASSISTANT_RULE_FILE).trim();
  const promptLooksRemote =
    existingPromptFile.startsWith('/') ||
    existingPromptFile.startsWith('plugins/') ||
    /^https?:\/\//i.test(existingPromptFile);
  const normalizedPromptFile = promptLooksRemote ? existingLocalPromptFile : existingPromptFile || existingLocalPromptFile;
  const remotePromptFile = firstNonEmpty(meta.remote_prompt_file, meta.remotePromptFile, promptLooksRemote ? existingPromptFile : '');
  const existingSkills = Array.isArray(meta.skills)
    ? meta.skills.map((entry) => normalizeInstalledRelativePath(entry)).filter(Boolean)
    : [];
  const normalizedSkills = existingSkills.length > 0 ? existingSkills : await getInstalledSkillDirsFromDisk(expertDir);
  const normalizedRuntimeSkills = toRuntimeSkillDirs(normalizedSkills);
  const before = JSON.stringify({
    prompt_file: meta.prompt_file || '',
    remote_prompt_file: meta.remote_prompt_file || '',
    members: meta.members || [],
    skills: meta.skills || [],
    enabledSkills: meta.enabledSkills || [],
    runtimeSkills: meta.runtimeSkills || [],
  });
  const after = JSON.stringify({
    prompt_file: normalizedPromptFile,
    remote_prompt_file: remotePromptFile || '',
    members: normalizedMembers,
    skills: normalizedSkills,
    enabledSkills: normalizedSkills,
    runtimeSkills: normalizedRuntimeSkills,
  });
  if (before === after) return meta;
  const repaired = {
    ...meta,
    prompt_file: normalizedPromptFile,
    remote_prompt_file: remotePromptFile || meta.remote_prompt_file,
    local_prompt_file: existingLocalPromptFile,
    ruleFile: meta.ruleFile || existingLocalPromptFile,
    members: normalizedMembers,
    skills: normalizedSkills,
    enabledSkills: normalizedSkills,
    runtimeSkills: normalizedRuntimeSkills,
    repaired_at: new Date().toISOString(),
  };
  await fsp.writeFile(path.join(expertDir, EXPERT_META_FILE), JSON.stringify(repaired, null, 2), 'utf-8');
  return repaired;
}

async function migrateLegacyExpertDir(legacyDir, entryName) {
  const legacyMeta = await readExpertMeta(legacyDir);
  const dirName = sanitizeDirName(legacyMeta?.id || legacyMeta?.name || entryName);
  if (!dirName || RESERVED_ASSISTANT_ROOT_NAMES.includes(dirName)) return null;

  await fsp.mkdir(MOSS_ASSISTANTS_DIR, { recursive: true });
  const assistantDir = path.join(MOSS_ASSISTANTS_DIR, dirName);
  if (await tryStat(assistantDir)) return null;

  await fsp.cp(legacyDir, assistantDir, { recursive: true });

  const legacyRuleFile = String(legacyMeta?.ruleFile || legacyMeta?.local_prompt_file || 'expert.md').trim();
  const nextRuleFile = ASSISTANT_RULE_FILE;
  try {
    await fsp.access(path.join(assistantDir, nextRuleFile));
  } catch {
    try {
      await fsp.copyFile(path.join(assistantDir, legacyRuleFile), path.join(assistantDir, nextRuleFile));
    } catch {
      try {
        await fsp.copyFile(path.join(assistantDir, 'expert.md'), path.join(assistantDir, nextRuleFile));
      } catch {
        // Keep the migrated directory even if a legacy prompt file is missing.
      }
    }
  }

  const nextMeta = {
    ...(legacyMeta || {}),
    id: legacyMeta?.id || entryName,
    name: legacyMeta?.id || legacyMeta?.name || entryName,
    display_name: legacyMeta?.display_name || legacyMeta?.displayName || legacyMeta?.name || entryName,
    kind: 'expert',
    expert_type: legacyMeta?.expert_type || legacyMeta?.type || 'agent',
    source_type: EXPERT_SOURCE_TYPE,
    tag: 'expert',
    is_builtin: false,
    enabled: legacyMeta?.enabled !== false,
    ruleFile: nextRuleFile,
    migrated_from: legacyDir,
    migrated_at: new Date().toISOString(),
  };
  await fsp.writeFile(path.join(assistantDir, EXPERT_META_FILE), JSON.stringify(nextMeta, null, 2), 'utf-8');
  return assistantDir;
}

async function migrateLegacyExperts() {
  let migratedCount = 0;
  try {
    const entries = await fsp.readdir(LEGACY_MOSS_EXPERTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      try {
        const migrated = await migrateLegacyExpertDir(path.join(LEGACY_MOSS_EXPERTS_DIR, entry.name), entry.name);
        if (migrated) migratedCount += 1;
      } catch {
        // A broken legacy expert should not prevent the app from starting.
      }
    }
  } catch {
    // No legacy experts directory.
  }
  return migratedCount;
}

export async function migrateLegacyExpertInstallations() {
  return migrateLegacyExperts();
}

async function getInstalledExperts() {
  const experts = [];
  await migrateLegacyExperts();
  try {
    await fsp.access(MOSS_ASSISTANTS_DIR);
    const entries = await fsp.readdir(MOSS_ASSISTANTS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_') || RESERVED_ASSISTANT_ROOT_NAMES.includes(entry.name)) continue;
      const expertDir = path.join(MOSS_ASSISTANTS_DIR, entry.name);
      let meta = await readExpertMeta(expertDir);
      if (!isExpertMeta(meta)) continue;
      meta = await repairInstalledExpertMetaIfNeeded(expertDir, meta);
      experts.push(normalizeInstalledExpert(meta, entry.name, expertDir));
    }
  } catch {
    // No local experts yet.
  }
  return experts.sort((a, b) => {
    const bTime = Date.parse(b.installedAt || '') || 0;
    const aTime = Date.parse(a.installedAt || '') || 0;
    return bTime - aTime || a.displayName.localeCompare(b.displayName, 'zh-Hans-CN');
  });
}

function installedExpertKeys(expert) {
  return [
    expert.id,
    expert.name,
    expert.displayName,
    expert.agentName,
    expert.plugin,
  ].map((entry) => String(entry || '').trim()).filter(Boolean);
}

function buildExpertMarkdown(expert, promptText) {
  const title = expert.displayName || expert.name || expert.id;
  const description = expert.description || expert.profession || '';
  return [
    '---',
    `name: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    `type: ${JSON.stringify(expert.type)}`,
    `source: ${JSON.stringify(EXPERT_SOURCE_TYPE)}`,
    '---',
    '',
    promptText.trim(),
    '',
  ].join('\n');
}

async function installExpert(baseUrl, expertId, { forceRefresh = false } = {}) {
  const installKey = `${normalizeBaseUrl(baseUrl)}:${String(expertId || '').trim()}`;
  if (!forceRefresh && expertInstallPromises.has(installKey)) {
    return expertInstallPromises.get(installKey);
  }

  const promise = installExpertOnce(baseUrl, expertId, { forceRefresh });
  expertInstallPromises.set(installKey, promise);
  try {
    return await promise;
  } finally {
    expertInstallPromises.delete(installKey);
  }
}

async function installExpertOnce(baseUrl, expertId, { forceRefresh = false } = {}) {
  const normalizedExpertId = String(expertId || '').trim();
  if (!normalizedExpertId) throw new Error('Missing expert id');
  const bundle = await loadExpertBundle(baseUrl, { forceRefresh });
  const expert = bundle.experts.find((entry) => entry.id === normalizedExpertId);
  const rawExpert = bundle.rawExperts.get(normalizedExpertId);
  if (!expert || !rawExpert) throw new Error(`Expert not found: ${normalizedExpertId}`);
  if (!expert.promptFile) throw new Error(`${expert.displayName || expert.id} does not provide a prompt file`);

  let pluginBundle = null;
  let bundleLoadError = null;
  if (expert.plugin) {
    try {
      pluginBundle = await loadPluginBundleFiles(baseUrl, expert.plugin, { forceRefresh });
    } catch (error) {
      bundleLoadError = error;
    }
  }

  let mainPrompt;
  try {
    mainPrompt = await fetchExpertPrompt(baseUrl, expert.promptFile, {
      forceRefresh,
      pluginName: expert.plugin,
      pluginBundle,
    });
  } catch (error) {
    if (bundleLoadError) {
      throw new Error(
        `${expert.displayName || expert.id} Prompt 下载失败：bundle ${expert.plugin || ''} 不可用（${bundleLoadError instanceof Error ? bundleLoadError.message : String(bundleLoadError)}），散文件也不可用（${error instanceof Error ? error.message : String(error)}）`,
      );
    }
    throw error;
  }
  const memberPrompts = [];
  if (expert.type === 'team') {
    const mainPromptFile = safeRelativePath(expert.promptFile);
    for (const member of expert.members || []) {
      const memberPromptFileRaw = inferMemberPromptFile(member);
      if (!memberPromptFileRaw) {
        throw new Error(`专家团资源不完整：成员「${member.displayName || member.name || member.id || 'unknown'}」缺少 Prompt 文件`);
      }
      const memberPromptFile = safeRelativePath(memberPromptFileRaw);
      if (mainPromptFile && memberPromptFile === mainPromptFile) continue;
      try {
        const prompt = await fetchExpertPrompt(baseUrl, memberPromptFileRaw, {
          forceRefresh,
          pluginName: expert.plugin,
          pluginBundle,
        });
        memberPrompts.push({ member, prompt });
      } catch (error) {
        throw new Error(
          `专家团资源不完整：成员「${member.displayName || member.name || member.id || 'unknown'}」Prompt 下载失败（${memberPromptFileRaw}）：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const dirName = sanitizeDirName(expert.id || expert.agentName || expert.name);
  if (!dirName) throw new Error('Invalid expert id');
  if (RESERVED_ASSISTANT_ROOT_NAMES.includes(dirName)) throw new Error(`Expert id is reserved: ${dirName}`);
  await fsp.mkdir(MOSS_ASSISTANTS_DIR, { recursive: true });
  const expertDir = path.join(MOSS_ASSISTANTS_DIR, dirName);
  const existingStat = await tryStat(expertDir);
  if (existingStat && !existingStat.isDirectory()) {
    throw new Error(`Assistant path already exists: ${dirName}`);
  }
  if (existingStat?.isDirectory()) {
    const existingMeta = await readExpertMeta(expertDir);
    if (existingMeta?.is_builtin === true || !isExpertMeta(existingMeta)) {
      throw new Error(`Assistant already exists: ${dirName}`);
    }
  }
  const tempExpertDir = path.join(MOSS_ASSISTANTS_DIR, `.${dirName}.installing-${Date.now()}`);
  try {
    await fsp.rm(tempExpertDir, { recursive: true, force: true });
    await fsp.mkdir(tempExpertDir, { recursive: true });
    const copiedBundleFiles = pluginBundle ? await writeBundleFiles(pluginBundle, tempExpertDir) : [];
    const scopedAgentFiles = pluginBundle ? await writeBundleSubdirAsMossConfig(pluginBundle, 'agents', tempExpertDir) : [];
    const scopedSkillFiles = pluginBundle ? await writeBundleSubdirAsMossConfig(pluginBundle, 'skills', tempExpertDir) : [];
    const installedSkillDirs = pluginBundle ? getInstalledSkillDirsFromPluginBundle(pluginBundle) : [];
    const runtimeSkillDirs = toRuntimeSkillDirs(installedSkillDirs);
    await fsp.writeFile(path.join(tempExpertDir, ASSISTANT_RULE_FILE), buildInstallMarkdown(expert, mainPrompt.text), 'utf-8');

    const installedMembers = [];
    if (memberPrompts.length > 0) {
      const agentsDir = path.join(tempExpertDir, 'agents');
      const scopedAgentsDir = path.join(tempExpertDir, '.moss', 'agents');
      await fsp.mkdir(agentsDir, { recursive: true });
      await fsp.mkdir(scopedAgentsDir, { recursive: true });
      for (const { member, prompt } of memberPrompts) {
        const memberFileName = `${sanitizeDirName(member.id || member.agentName || member.name) || 'member'}.md`;
        const memberMarkdown = buildInstallMarkdown({ ...member, type: 'agent' }, prompt.text);
        await fsp.writeFile(path.join(agentsDir, memberFileName), memberMarkdown, 'utf-8');
        const scopedMemberPath = path.join(scopedAgentsDir, memberFileName);
        if (!await tryStat(scopedMemberPath)) {
          await fsp.writeFile(scopedMemberPath, memberMarkdown, 'utf-8');
        }
        installedMembers.push({
          ...member,
          remotePromptFile: member.promptFile || '',
          promptFile: path.join('agents', memberFileName),
          localPromptFile: path.join('agents', memberFileName),
          runtimePromptFile: path.posix.join('.moss', 'agents', memberFileName),
        });
      }
    }
    const normalizedInstalledMembers = pluginBundle
      ? mergeInstalledMembersFromBundle(expert, installedMembers, pluginBundle)
      : installedMembers;

    const meta = {
      id: expert.id,
      name: expert.id,
      display_name: expert.displayName,
      profession: expert.profession,
      description: expert.description,
      kind: 'expert',
      expert_type: expert.type,
      type: 'assistant',
      category_id: expert.categoryId,
      category_name: expert.categoryName,
      category: expert.categoryName || expert.categoryId || '',
      categories: [expert.categoryName || expert.categoryId].filter(Boolean),
      avatar: expert.avatar,
      prompt_file: ASSISTANT_RULE_FILE,
      remote_prompt_file: expert.promptFile,
      plugin: expert.plugin,
      agent_name: expert.agentName,
      tags: expert.tags || [],
      quick_prompts: expert.quickPrompts || [],
      members: normalizedInstalledMembers,
      skills: installedSkillDirs,
      enabledSkills: installedSkillDirs,
      runtimeSkills: runtimeSkillDirs,
      raw_members: Array.isArray(rawExpert.members) ? rawExpert.members : [],
      source_type: EXPERT_SOURCE_TYPE,
      tag: 'expert',
      is_builtin: false,
      source_manifest: expert.sourceManifest,
      source_base_url: normalizeBaseUrl(baseUrl),
      manifest_last_updated: expert.manifestUpdatedAt || 0,
      prompt_cache_path: mainPrompt.cachePath,
      bundle_cache_path: pluginBundle?.cachePath || '',
      bundle_files: copiedBundleFiles,
      scoped_agent_files: scopedAgentFiles,
      scoped_skill_files: scopedSkillFiles,
      enabled: true,
      installed_at: new Date().toISOString(),
    };
    await fsp.writeFile(path.join(tempExpertDir, EXPERT_META_FILE), JSON.stringify(meta, null, 2), 'utf-8');
    await fsp.rm(expertDir, { recursive: true, force: true });
    await fsp.rename(tempExpertDir, expertDir);
    return { success: true, data: normalizeInstalledExpert(meta, dirName, expertDir) };
  } catch (error) {
    await fsp.rm(tempExpertDir, { recursive: true, force: true });
    throw error;
  }
}

async function uninstallExpert(sourcePath) {
  const resolved = path.resolve(String(sourcePath || ''));
  const insideAssistants = isStrictPathInsideDir(MOSS_ASSISTANTS_DIR, resolved);
  const insideLegacyExperts = isStrictPathInsideDir(LEGACY_MOSS_EXPERTS_DIR, resolved);
  if (!resolved || (!insideAssistants && !insideLegacyExperts) || isReservedAssistantRootDir(resolved)) {
    return { success: false, error: 'Refusing to remove path outside assistant directories' };
  }
  const meta = await readExpertMeta(resolved);
  if (!isExpertMeta(meta)) {
    return { success: false, error: 'Refusing to remove non-expert assistant' };
  }
  await fsp.rm(resolved, { recursive: true, force: true });
  return { success: true };
}

export function registerPublicExpertHubIpcHandlers({ getDesktopSettings, notifyAssistantsChanged } = {}) {
  const getBaseUrl = () => normalizeBaseUrl(getDesktopSettings?.()?.expertHub?.baseUrl);

  ipcMain.handle('public-experthub:get-config', async () => ({
    success: true,
    data: {
      baseUrl: getBaseUrl(),
      defaultBaseUrl: DEFAULT_EXPERT_HUB_BASE_URL,
      cacheDir: EXPERT_CACHE_DIR,
      manifestCacheDir: EXPERT_CACHE_MANIFEST_DIR,
      installedDir: MOSS_ASSISTANTS_DIR,
      legacyInstalledDir: LEGACY_MOSS_EXPERTS_DIR,
    },
  }));

  ipcMain.handle('public-experthub:fetch-categories', async (_event, payload = {}) => {
    try {
      const bundle = await loadExpertBundle(getBaseUrl(), { forceRefresh: Boolean(payload.forceRefresh) });
      return {
        success: true,
        data: {
          categories: bundle.categories,
          manifests: bundle.manifests,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('public-experthub:fetch-experts', async (_event, payload = {}) => {
    try {
      const bundle = await loadExpertBundle(getBaseUrl(), { forceRefresh: Boolean(payload.forceRefresh) });
      const filtered = filterExperts(bundle.experts, {
        query: payload.query,
        category: payload.category,
        type: payload.type,
        sortBy: payload.sortBy,
      });
      const pageData = paginate(filtered, payload.page, payload.pageSize);
      return {
        success: true,
        data: {
          experts: pageData.items,
          total: pageData.total,
          page: pageData.page,
          pageSize: pageData.pageSize,
          hasMore: pageData.hasMore,
          manifests: bundle.manifests,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('public-experthub:fetch-featured-experts', async (_event, payload = {}) => {
    try {
      const bundle = await loadExpertBundle(getBaseUrl(), { forceRefresh: Boolean(payload.forceRefresh) });
      const featuredIds = await getFeaturedExpertIds(getBaseUrl(), { forceRefresh: Boolean(payload.forceRefresh) });
      const idSet = new Set(featuredIds);
      const featuredExperts = idSet.size > 0 ? bundle.experts.filter((expert) => idSet.has(expert.id)) : [];
      const source = featuredExperts.length > 0 ? featuredExperts : bundle.experts;
      const filtered = filterExperts(source, {
        query: payload.query,
        category: payload.category,
        type: payload.type,
        sortBy: payload.sortBy || 'updated',
      });
      const pageData = paginate(filtered, payload.page, payload.pageSize);
      return {
        success: true,
        data: {
          experts: pageData.items,
          total: pageData.total,
          page: pageData.page,
          pageSize: pageData.pageSize,
          hasMore: pageData.hasMore,
          manifests: bundle.manifests,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('public-experthub:fetch-scenes', async (_event, payload = {}) => {
    try {
      const bundle = await loadExpertBundle(getBaseUrl(), { forceRefresh: Boolean(payload.forceRefresh) });
      const loaded = await fetchCachedJson(getBaseUrl(), FEATURED_SCENES_FILE, {
        forceRefresh: Boolean(payload.forceRefresh),
        optional: true,
      });
      const rawScenes = Array.isArray(loaded.data) ? loaded.data : extractArray(loaded.data, ['scenes', 'items', 'featuredScenes']);
      const expertById = new Map(bundle.experts.map((expert) => [expert.id, expert]));
      const scenes = rawScenes.map((scene) => normalizeScene(scene, getBaseUrl(), expertById)).filter(Boolean);
      const pageData = paginate(scenes, payload.page, payload.pageSize);
      return {
        success: true,
        data: {
          scenes: pageData.items,
          total: pageData.total,
          page: pageData.page,
          pageSize: pageData.pageSize,
          hasMore: pageData.hasMore,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('public-experthub:fetch-detail', async (_event, payload = {}) => {
    try {
      const expertId = String(payload.expertId || payload.id || '').trim();
      if (!expertId) return { success: false, error: 'Missing expert id' };
      const bundle = await loadExpertBundle(getBaseUrl(), { forceRefresh: Boolean(payload.forceRefresh) });
      const expert = bundle.experts.find((entry) => entry.id === expertId);
      if (!expert) return { success: false, error: 'Expert not found' };
      return { success: true, data: expert };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('public-experthub:get-installed-experts', async () => {
    try {
      return { success: true, data: await getInstalledExperts() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('public-experthub:install-expert', async (_event, payload = {}) => {
    try {
      const result = await installExpert(getBaseUrl(), payload.expertId, { forceRefresh: Boolean(payload.forceRefresh) });
      if (result?.success) {
        notifyAssistantsChanged?.({ reason: 'expert-installed', expertId: result.data?.id || payload.expertId });
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('public-experthub:uninstall-expert', async (_event, payload = {}) => {
    try {
      const result = await uninstallExpert(payload.sourcePath);
      if (result?.success) {
        notifyAssistantsChanged?.({ reason: 'expert-uninstalled', sourcePath: payload.sourcePath });
      }
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

export { DEFAULT_EXPERT_HUB_BASE_URL };
