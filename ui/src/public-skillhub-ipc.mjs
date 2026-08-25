import electron from 'electron';
const { ipcMain, dialog } = electron;
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { downloadFileBuffer } from './download-utils.mjs';

const MOSS_HOME = path.join(os.homedir(), '.moss');
const MOSS_SKILLS_DIR = path.join(MOSS_HOME, 'skills');
const SKILL_META_FILE = '_moss_meta.json';
const DEFAULT_SKILL_HUB_API_BASE_URL = 'https://api.skillhub.cn';
const MAX_IMPORT_ZIP_BYTES = 200 * 1024 * 1024;

function normalizeApiBaseUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_SKILL_HUB_API_BASE_URL;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return DEFAULT_SKILL_HUB_API_BASE_URL;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return DEFAULT_SKILL_HUB_API_BASE_URL;
  }
}

function buildHubUrl(apiBaseUrl, pathname, params = {}) {
  const url = new URL(pathname, `${normalizeApiBaseUrl(apiBaseUrl)}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Expected JSON, got ${contentType || 'unknown content type'}`);
  }
  return response.json();
}

function normalizeVersion(version) {
  const text = String(version || '').trim();
  if (!text || text.toLowerCase() === 'unknown' || text.toLowerCase() === 'unkown') return '';
  return text;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text && text !== '[object Object]' ? text : '';
}

function textValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return cleanText(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = textValue(entry);
      if (text) return text;
    }
    return '';
  }
  if (!isRecord(value)) return '';

  const keys = [
    'zh',
    'zhCN',
    'zh-CN',
    'nameZh',
    'displayNameZh',
    'titleZh',
    'labelZh',
    'displayName',
    'display_name',
    'name',
    'title',
    'label',
    'value',
    'en',
    'enUS',
    'en-US',
    'key',
    'id',
    'slug',
  ];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const text = textValue(value[key]);
    if (text) return text;
  }
  for (const entry of Object.values(value)) {
    if (entry !== null && typeof entry === 'object') continue;
    const text = textValue(entry);
    if (text) return text;
  }
  return '';
}

function normalizeNamespace(namespace) {
  if (!isRecord(namespace)) return null;
  const handle = textValue(namespace.handle);
  const publicSlug = textValue(namespace.publicSlug);
  const canonicalName = textValue(namespace.canonicalName)
    || (handle && publicSlug ? `@${handle}/${publicSlug}` : '');
  const displayName = textValue(namespace.displayName) || textValue(namespace.name) || handle;
  if (!canonicalName && !displayName && !handle && !publicSlug) return null;
  return {
    canonicalName,
    displayName,
    handle,
    publicSlug,
  };
}

function categoryKey(category) {
  if (!isRecord(category)) return textValue(category);
  return textValue(category.key) || textValue(category.id) || textValue(category.slug) || textValue(category.name);
}

function categoryDisplayName(category) {
  if (!isRecord(category)) return textValue(category);
  return textValue(category.name)
    || textValue(category.nameZh)
    || textValue(category.displayName)
    || textValue(category.title)
    || categoryKey(category);
}

function normalizeCategoryLabels(value) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  const labels = [];
  const seen = new Set();
  for (const entry of source) {
    const label = categoryDisplayName(entry);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function sanitizeSkillDirName(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return null;
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) return null;
  if (trimmed !== path.basename(trimmed)) return null;
  return trimmed;
}

function isPathInsideDir(rootDir, targetPath) {
  const relativePath = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isUnsafeZipEntryPath(entryPath) {
  if (!entryPath || entryPath === '.') return false;
  if (/^[a-zA-Z]:[\\/]/.test(entryPath)) return true;
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) return true;
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  return normalized === '..' || normalized.startsWith('../');
}

function resolveSafeZipEntryPath(targetDir, entryPath) {
  if (isUnsafeZipEntryPath(entryPath)) return null;
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized) return null;
  const fullPath = path.resolve(targetDir, normalized);
  return isPathInsideDir(targetDir, fullPath) ? fullPath : null;
}

async function copyDirectoryRecursive(sourceDir, targetDir) {
  await fsp.mkdir(targetDir, { recursive: true });
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(sourcePath, targetPath);
    }
  }
}

async function extractSkillZip(buffer, targetDir) {
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.values(zip.files);
  const skillMdFiles = files.filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith('skill.md'));
  let stripPrefix = '';

  if (skillMdFiles.some((entry) => entry.name === 'SKILL.md' || entry.name === 'skill.md')) {
    stripPrefix = '';
  } else if (skillMdFiles.length > 0) {
    const rootPaths = [...new Set(skillMdFiles.map((entry) => path.dirname(entry.name).split('/')[0]))];
    if (rootPaths.length === 1) stripPrefix = `${rootPaths[0]}/`;
  }

  for (const entry of files) {
    if (entry.dir) continue;
    let entryName = entry.name.replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (stripPrefix && entryName.startsWith(stripPrefix)) {
      entryName = entryName.slice(stripPrefix.length);
    }
    const fullPath = resolveSafeZipEntryPath(targetDir, entryName);
    if (!fullPath) continue;
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, await entry.async('nodebuffer'));
  }
}

function parseFrontmatter(content) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(content);
  if (!match) return { frontmatter: {}, content };
  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return { frontmatter, content: match[2].trim() };
}

async function readSkillMeta(skillDir) {
  try {
    return JSON.parse(await fsp.readFile(path.join(skillDir, SKILL_META_FILE), 'utf-8'));
  } catch {
    return null;
  }
}

async function readSkillVersion(skillDir) {
  try {
    return normalizeVersion(await fsp.readFile(path.join(skillDir, 'version.txt'), 'utf-8'));
  } catch {
    return '';
  }
}

function normalizeSkillCoordinate(skill) {
  const namespace = normalizeNamespace(skill?.namespace);
  const slug = textValue(skill?.slug) || textValue(skill?.name);
  return cleanText(namespace?.canonicalName || (namespace?.handle && slug ? `@${namespace.handle}/${slug}` : '') || slug);
}

function normalizeRemoteSkill(skill) {
  if (!isRecord(skill)) return null;
  const namespace = normalizeNamespace(skill.namespace);
  const slug = textValue(skill.slug) || textValue(skill.name) || textValue(skill.id);
  const displayName = textValue(skill.displayName) || textValue(skill.display_name) || textValue(skill.name) || slug;
  if (!slug && !displayName) return null;
  const category = categoryKey(skill.category);
  const subCategories = normalizeCategoryLabels(skill.subCategories);
  const categories = Array.from(new Set([category, ...subCategories].filter(Boolean)));
  return {
    id: normalizeSkillCoordinate({ ...skill, slug, namespace }) || displayName,
    slug,
    name: slug || displayName,
    displayName,
    description: textValue(skill.summary_zh) || textValue(skill.description_zh) || textValue(skill.summary) || textValue(skill.description) || '',
    version: normalizeVersion(textValue(skill.version) || textValue(skill.latestVersion?.version)),
    icon: textValue(skill.iconUrl) || textValue(skill.icon),
    category,
    categories,
    namespace,
    ownerName: textValue(skill.ownerName) || textValue(skill.owner?.displayName) || textValue(skill.owner?.name) || textValue(namespace?.displayName) || textValue(namespace?.handle),
    source: textValue(skill.source) || 'skillhub',
    homepage: textValue(skill.homepage),
    stars: Number(skill.stars ?? skill.stats?.stars ?? 0) || 0,
    downloads: Number(skill.downloads ?? skill.stats?.downloads ?? 0) || 0,
    installs: Number(skill.installs ?? skill.stats?.installs ?? 0) || 0,
    verified: Boolean(skill.verified || skill.isAuthorVerified),
    tags: skill.tags || skill.labels || null,
  };
}

function normalizeCategory(category) {
  if (typeof category === 'string') return { key: category, name: category };
  if (!isRecord(category)) return null;
  const key = categoryKey(category);
  const name = categoryDisplayName(category);
  if (!key && !name) return null;
  return {
    key: key || name,
    name: name || key,
    level: category.level,
    active: category.active !== false,
  };
}

function normalizeInstalledSkill(meta, entryName, skillDir, version) {
  const namespace = normalizeNamespace(meta?.namespace);
  return {
    id: textValue(meta?.id),
    slug: textValue(meta?.slug),
    name: textValue(meta?.name) || entryName,
    displayName: textValue(meta?.display_name) || textValue(meta?.displayName) || textValue(meta?.name) || entryName,
    description: textValue(meta?.description),
    version: meta?.installed_version || version || '',
    icon: textValue(meta?.icon),
    emoji: textValue(meta?.emoji),
    category: categoryKey(meta?.category),
    categories: normalizeCategoryLabels(meta?.categories),
    isBuiltin: false,
    isHubInstalled: meta?.source_type === 'skillhub' || meta?.source_type === 'hub',
    isUploaded: meta?.source_type === 'upload',
    enabled: meta?.enabled !== false,
    namespace,
    ownerName: textValue(meta?.owner_name) || textValue(namespace?.displayName) || textValue(namespace?.handle),
    homepage: textValue(meta?.homepage),
    source: skillDir,
  };
}

async function getInstalledSkills() {
  const skills = [];
  try {
    await fsp.access(MOSS_SKILLS_DIR);
    const entries = await fsp.readdir(MOSS_SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(MOSS_SKILLS_DIR, entry.name);
      const meta = await readSkillMeta(skillDir);
      const version = await readSkillVersion(skillDir);
      if (meta) {
        skills.push(normalizeInstalledSkill(meta, entry.name, skillDir, version));
        continue;
      }
      try {
        const { frontmatter } = parseFrontmatter(await fsp.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8'));
        skills.push(normalizeInstalledSkill({
          name: entry.name,
          display_name: frontmatter.name || frontmatter.displayName || entry.name,
          description: frontmatter.description || '',
          icon: frontmatter.icon || '',
          emoji: frontmatter.emoji || '',
          category: frontmatter.category || '',
          categories: frontmatter.category ? [frontmatter.category] : [],
          installed_version: frontmatter.version || version,
          source_type: 'local',
          enabled: true,
        }, entry.name, skillDir, version));
      } catch {
        skills.push(normalizeInstalledSkill({ name: entry.name, enabled: true }, entry.name, skillDir, ''));
      }
    }
  } catch {
    // No local skills yet.
  }
  return skills;
}

async function installSkillFromZip(zipBuffer, skillName, skillMeta, version) {
  const safeName = sanitizeSkillDirName(skillName);
  if (!safeName) throw new Error(`Invalid skill name: ${JSON.stringify(skillName)}`);
  await fsp.mkdir(MOSS_SKILLS_DIR, { recursive: true });
  const skillDir = path.join(MOSS_SKILLS_DIR, safeName);
  await fsp.rm(skillDir, { recursive: true, force: true });
  await fsp.mkdir(skillDir, { recursive: true });
  await extractSkillZip(zipBuffer, skillDir);

  const meta = {
    id: skillMeta.id || '',
    slug: skillMeta.slug || '',
    name: skillName,
    display_name: skillMeta.displayName || skillMeta.display_name || skillName,
    description: skillMeta.description || '',
    icon: skillMeta.icon || '',
    emoji: skillMeta.emoji || null,
    category: skillMeta.category || '',
    categories: skillMeta.categories || [],
    namespace: skillMeta.namespace || null,
    homepage: skillMeta.homepage || null,
    owner_name: skillMeta.ownerName || '',
    source_type: 'skillhub',
    enabled: true,
    installed_version: version || '',
    installed_at: new Date().toISOString(),
  };
  await fsp.writeFile(path.join(skillDir, SKILL_META_FILE), JSON.stringify(meta, null, 2), 'utf-8');
  return { success: true, skillName, version: version || '' };
}

async function uninstallSkill(sourcePath) {
  const resolved = path.resolve(sourcePath || '');
  if (!resolved || resolved === path.resolve(MOSS_SKILLS_DIR) || !isPathInsideDir(MOSS_SKILLS_DIR, resolved)) {
    return { success: false, error: 'Refusing to remove path outside skills directory' };
  }
  await fsp.rm(resolved, { recursive: true, force: true });
  return { success: true };
}

async function importLocalSkill(sourcePath) {
  const stat = await fsp.stat(sourcePath);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-public-skill-import-'));
  try {
    if (stat.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, tempDir);
    } else if (stat.isFile() && path.extname(sourcePath).toLowerCase() === '.zip') {
      if (stat.size > MAX_IMPORT_ZIP_BYTES) {
        return { success: false, error: 'Zip file is too large (max 200MB)' };
      }
      await extractSkillZip(await fsp.readFile(sourcePath), tempDir);
    } else {
      return { success: false, error: 'Please select a .zip file or a skill directory' };
    }

    const entries = await fsp.readdir(tempDir, { withFileTypes: true });
    let skillDir = tempDir;
    const hasSkillMd = entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === 'skill.md');
    if (!hasSkillMd) {
      const subDirs = entries.filter((entry) => entry.isDirectory());
      if (subDirs.length > 0) skillDir = path.join(tempDir, subDirs[0].name);
    }

    const skillName = path.basename(skillDir);
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const { frontmatter } = parseFrontmatter(await fsp.readFile(skillMdPath, 'utf-8'));
    const safeName = sanitizeSkillDirName(skillName);
    if (!safeName) return { success: false, error: 'Invalid skill name' };
    const targetDir = path.join(MOSS_SKILLS_DIR, safeName);
    await fsp.mkdir(MOSS_SKILLS_DIR, { recursive: true });
    await fsp.rm(targetDir, { recursive: true, force: true });
    await fsp.mkdir(targetDir, { recursive: true });
    await copyDirectoryRecursive(skillDir, targetDir);
    const meta = {
      id: '',
      slug: '',
      name: skillName,
      display_name: frontmatter.name || frontmatter.displayName || skillName,
      description: frontmatter.description || '',
      icon: frontmatter.icon || '',
      emoji: frontmatter.emoji || null,
      category: frontmatter.category || '',
      categories: frontmatter.category ? [frontmatter.category] : [],
      source_type: 'upload',
      enabled: true,
      installed_version: frontmatter.version || '1.0.0',
      installed_at: new Date().toISOString(),
    };
    await fsp.writeFile(path.join(targetDir, SKILL_META_FILE), JSON.stringify(meta, null, 2), 'utf-8');
    return { success: true, data: { skillName, installedVersion: meta.installed_version } };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

export function registerPublicSkillHubIpcHandlers({ getDesktopSettings } = {}) {
  const getApiBaseUrl = () => normalizeApiBaseUrl(getDesktopSettings?.()?.skillHub?.apiBaseUrl);

  ipcMain.handle('public-skillhub:get-config', async () => ({
    success: true,
    data: {
      apiBaseUrl: getApiBaseUrl(),
      defaultApiBaseUrl: DEFAULT_SKILL_HUB_API_BASE_URL,
    },
  }));

  ipcMain.handle('public-skillhub:fetch-skills', async (_event, payload = {}) => {
    try {
      const page = Math.max(1, Number.parseInt(String(payload.page || 1), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(payload.pageSize || 20), 10) || 20));
      const url = buildHubUrl(getApiBaseUrl(), '/api/skills', {
        page,
        pageSize,
        sortBy: payload.sortBy,
        order: payload.order,
        keyword: payload.query || payload.keyword,
        category: payload.category,
        source: payload.source && payload.source !== 'all' ? payload.source : undefined,
      });
      const result = await fetchJson(url);
      if (result.code !== 0) {
        return { success: false, error: result.message || 'SkillHub returned an error' };
      }
      const skills = Array.isArray(result.data?.skills)
        ? result.data.skills.map(normalizeRemoteSkill).filter(Boolean)
        : [];
      return {
        success: true,
        data: {
          skills,
          total: Number(result.data?.total || skills.length) || 0,
          page,
          pageSize,
          hasMore: page * pageSize < (Number(result.data?.total || 0) || 0),
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('public-skillhub:fetch-categories', async () => {
    try {
      const result = await fetchJson(buildHubUrl(getApiBaseUrl(), '/api/v1/categories'));
      const source = Array.isArray(result.items) ? result.items : Array.isArray(result.data) ? result.data : [];
      return { success: true, data: source.map(normalizeCategory).filter(Boolean) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('public-skillhub:fetch-detail', async (_event, { slug, namespace } = {}) => {
    try {
      const normalizedSlug = String(slug || '').trim();
      if (!normalizedSlug) return { success: false, error: 'Missing skill slug' };
      const result = await fetchJson(buildHubUrl(getApiBaseUrl(), `/api/v1/skills/${encodeURIComponent(normalizedSlug)}`, { namespace }));
      return {
        success: true,
        data: {
          ...result,
          skill: normalizeRemoteSkill({
            ...(result.skill || {}),
            namespace: result.namespace || result.skill?.namespace,
            version: result.latestVersion?.version || result.skill?.version,
          }),
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('public-skillhub:get-installed-skills', async () => {
    try {
      return { success: true, data: await getInstalledSkills() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('public-skillhub:install-skill', async (_event, { skill } = {}) => {
    try {
      const remoteSkill = normalizeRemoteSkill(skill);
      if (!remoteSkill?.slug) return { success: false, error: 'Missing skill slug' };
      const version = remoteSkill.version || '';
      const downloadUrl = buildHubUrl(getApiBaseUrl(), '/api/v1/download', {
        slug: remoteSkill.slug,
        version,
        namespace: remoteSkill.namespace?.handle,
      });
      const zipBuffer = await downloadFileBuffer(downloadUrl, { userAgent: 'Moss-PublicSkillHub/1.0' });
      if (skill?.sha256 || skill?.checksum) {
        const actual = crypto.createHash('sha256').update(zipBuffer).digest('hex');
        const expected = String(skill.sha256 || skill.checksum);
        if (actual !== expected) return { success: false, error: 'Checksum verification failed' };
      }
      const installName = remoteSkill.slug || remoteSkill.name || remoteSkill.displayName;
      return await installSkillFromZip(zipBuffer, installName, remoteSkill, version);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('public-skillhub:uninstall-skill', async (_event, { sourcePath } = {}) => {
    try {
      return await uninstallSkill(sourcePath);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('public-skillhub:open-import-dialog', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'openDirectory'],
        filters: [{ name: 'Skill', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePaths[0]) {
        return { success: false, error: 'Canceled' };
      }
      return { success: true, data: { filePath: result.filePaths[0] } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('public-skillhub:import-local', async (_event, { sourcePath } = {}) => {
    try {
      return await importLocalSkill(sourcePath);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
