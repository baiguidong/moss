import electron from 'electron';
const { ipcMain, dialog } = electron;
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import JSZip from 'jszip';

const MOSS_HOME = path.join(os.homedir(), '.moss');
const MOSS_SKILLS_DIR = path.join(MOSS_HOME, 'skills');
const USER_SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

const SKILL_HUB_BASE_URL = 'https://sudoclawhub.sudoprivacy.com/api/skills';
const SKILL_HUB_CURSOR_URL = 'https://sudoclawhub.sudoprivacy.com/api/skills/cursor';
const SKILL_HUB_CATEGORIES_URL = 'https://sudoclawhub.sudoprivacy.com/api/categories';
const SKILL_HUB_AUTHORIZATION = 'sud0@sudo';

const SKILL_HUB_META_FILE = '_moss_meta.json';

function normalizeSkillVersion(version) {
  const normalized = (version || '').trim();
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  if (lower === 'unknown' || lower === 'unkown') return '';
  return normalized;
}

function parseFrontmatter(content) {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
  const match = content.match(frontmatterRegex);
  if (!match) return { frontmatter: {}, content };

  const frontmatter = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return { frontmatter, content: match[2].trim() };
}

async function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: { 'User-Agent': 'Moss-SkillHub/1.0' },
    };

    const request = client.request(options, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadFile(redirectUrl).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });

    request.setTimeout(60000, () => {
      request.destroy(new Error('Download timeout'));
    });
    request.on('error', reject);
    request.end();
  });
}

async function verifyChecksum(buffer, expectedChecksum) {
  const actualChecksum = crypto.createHash('sha256').update(buffer).digest('hex');
  return actualChecksum === expectedChecksum;
}

function isUnsafeZipEntryPath(entryPath) {
  if (!entryPath || entryPath === '.') return false;
  if (/^[a-zA-Z]:[\\/]/.test(entryPath)) return true;
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) return true;
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  return normalized === '..' || normalized.startsWith('../');
}

async function extractSkillZip(buffer, targetDir) {
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.values(zip.files);

  // Find root SKILL.md path
  const skillMdFiles = files.filter(f => !f.dir && f.name.toLowerCase().endsWith('skill.md'));
  let stripPrefix = '';

  if (skillMdFiles.some(f => f.name === 'SKILL.md' || f.name === 'skill.md')) {
    stripPrefix = '';
  } else if (skillMdFiles.length > 0) {
    const rootPaths = [...new Set(skillMdFiles.map(f => path.dirname(f.name).split('/')[0]))];
    if (rootPaths.length === 1) {
      stripPrefix = rootPaths[0] + '/';
    }
  }

  for (const entry of files) {
    if (entry.dir) continue;

    let entryName = entry.name.replace(/\\/g, '/').replace(/^\.\/+/, '');

    if (stripPrefix && entryName.startsWith(stripPrefix)) {
      entryName = entryName.slice(stripPrefix.length);
    }

    if (!entryName || isUnsafeZipEntryPath(entryName)) continue;

    const fullPath = path.join(targetDir, entryName);
    const fullDir = path.dirname(fullPath);

    await fsp.mkdir(fullDir, { recursive: true });
    const content = await entry.async('nodebuffer');
    await fsp.writeFile(fullPath, content);
  }
}

async function readSkillMeta(skillDir) {
  try {
    const raw = await fsp.readFile(path.join(skillDir, SKILL_HUB_META_FILE), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readSkillVersion(skillDir) {
  try {
    return normalizeSkillVersion(await fsp.readFile(path.join(skillDir, 'version.txt'), 'utf-8'));
  } catch {
    return '';
  }
}

async function getInstalledSkills() {
  const skills = [];

  // Check user skills directory
  try {
    await fsp.access(USER_SKILLS_DIR);
    const entries = await fsp.readdir(USER_SKILLS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillDir = path.join(USER_SKILLS_DIR, entry.name);
        const meta = await readSkillMeta(skillDir);
        const version = await readSkillVersion(skillDir);

        if (meta) {
          skills.push({
            name: meta.name || entry.name,
            displayName: meta.display_name || meta.name || entry.name,
            description: meta.description || '',
            version: meta.installed_version || version,
            icon: meta.icon || '',
            emoji: meta.emoji || '',
            category: meta.category || '',
            categories: meta.categories || [],
            isBuiltin: false,
            isHubInstalled: meta.source_type === 'hub',
            isUploaded: meta.source_type === 'upload',
            enabled: meta.enabled !== false,
            source: skillDir,
          });
        } else {
          // Try to read SKILL.md for info
          try {
            const skillMdPath = path.join(skillDir, 'SKILL.md');
            const content = await fsp.readFile(skillMdPath, 'utf-8');
            const { frontmatter } = parseFrontmatter(content);
            skills.push({
              name: entry.name,
              displayName: frontmatter.name || frontmatter.displayName || entry.name,
              description: frontmatter.description || '',
              version: frontmatter.version || version,
              icon: frontmatter.icon || '',
              emoji: frontmatter.emoji || '',
              category: frontmatter.category || '',
              categories: frontmatter.category ? [frontmatter.category] : [],
              isBuiltin: false,
              isHubInstalled: false,
              isUploaded: false,
              enabled: true,
              source: skillDir,
            });
          } catch {
            skills.push({
              name: entry.name,
              displayName: entry.name,
              description: '',
              version: '',
              icon: '',
              emoji: '',
              category: '',
              categories: [],
              isBuiltin: false,
              isHubInstalled: false,
              isUploaded: false,
              enabled: true,
              source: skillDir,
            });
          }
        }
      }
    }
  } catch {
    // User skills dir doesn't exist
  }

  // Check moss managed skills (hub subdirectory)
  try {
    const hubDir = path.join(MOSS_SKILLS_DIR, 'hub');
    await fsp.access(hubDir);
    const entries = await fsp.readdir(hubDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillDir = path.join(hubDir, entry.name);
        const meta = await readSkillMeta(skillDir);
        const version = await readSkillVersion(skillDir);

        if (meta) {
          skills.push({
            name: meta.name || entry.name,
            displayName: meta.display_name || meta.name || entry.name,
            description: meta.description || '',
            version: meta.installed_version || version,
            icon: meta.icon || '',
            emoji: meta.emoji || '',
            category: meta.category || '',
            categories: meta.categories || [],
            isBuiltin: meta.is_builtin || false,
            isHubInstalled: meta.source_type === 'hub',
            isUploaded: meta.source_type === 'upload',
            enabled: meta.enabled !== false,
            source: skillDir,
          });
        }
      }
    }
  } catch {
    // Moss hub dir doesn't exist
  }

  // Check moss managed skills (system subdirectory)
  try {
    const systemDir = path.join(MOSS_SKILLS_DIR, 'system');
    await fsp.access(systemDir);
    const entries = await fsp.readdir(systemDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillDir = path.join(systemDir, entry.name);
        const meta = await readSkillMeta(skillDir);
        const version = await readSkillVersion(skillDir);

        if (meta) {
          skills.push({
            name: meta.name || entry.name,
            displayName: meta.display_name || meta.name || entry.name,
            description: meta.description || '',
            version: meta.installed_version || version,
            icon: meta.icon || '',
            emoji: meta.emoji || '',
            category: meta.category || '',
            categories: meta.categories || [],
            isBuiltin: meta.is_builtin || false,
            isHubInstalled: false,
            isUploaded: false,
            enabled: meta.enabled !== false,
            source: skillDir,
          });
        }
      }
    }
  } catch {
    // Moss system dir doesn't exist
  }

  // Check moss managed skills (custom subdirectory)
  try {
    const customDir = path.join(MOSS_SKILLS_DIR, 'custom');
    await fsp.access(customDir);
    const entries = await fsp.readdir(customDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillDir = path.join(customDir, entry.name);
        const meta = await readSkillMeta(skillDir);
        const version = await readSkillVersion(skillDir);

        if (meta) {
          skills.push({
            name: meta.name || entry.name,
            displayName: meta.display_name || meta.name || entry.name,
            description: meta.description || '',
            version: meta.installed_version || version,
            icon: meta.icon || '',
            emoji: meta.emoji || '',
            category: meta.category || '',
            categories: meta.categories || [],
            isBuiltin: meta.is_builtin || false,
            isHubInstalled: false,
            isUploaded: meta.source_type === 'upload',
            enabled: meta.enabled !== false,
            source: skillDir,
          });
        }
      }
    }
  } catch {
    // Moss custom dir doesn't exist
  }

  return skills;
}

async function uninstallSkill(skillName, sourcePath) {
  try {
    await fsp.rm(sourcePath, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function installSkillFromZip(zipBuffer, skillName, skillMeta, version) {
  console.log('[SkillStore IPC] installSkillFromZip called:', { skillName, version });
  try {
    if (!skillName || typeof skillName !== 'string') {
      throw new Error(`skillName is invalid: ${JSON.stringify(skillName)}`);
    }

    const hubSkillsDir = path.join(MOSS_HOME, 'skills', 'hub');
    console.log('[SkillStore IPC] hubSkillsDir:', hubSkillsDir);
    await fsp.mkdir(hubSkillsDir, { recursive: true });

    const skillDir = path.join(hubSkillsDir, skillName);
    console.log('[SkillStore IPC] skillDir:', skillDir);
    await fsp.rm(skillDir, { recursive: true, force: true });
    await fsp.mkdir(skillDir, { recursive: true });

    await extractSkillZip(zipBuffer, skillDir);

    // Write metadata
    const meta = {
      id: skillMeta?.id || '',
      name: skillName,
      display_name: skillMeta?.display_name || skillMeta?.name || skillName,
      description: skillMeta?.description || '',
      icon: skillMeta?.icon || '',
      emoji: skillMeta?.emoji || null,
      category: skillMeta?.category || '',
      categories: skillMeta?.categories || [],
      applicable_scenarios: skillMeta?.applicable_scenarios || null,
      core_features: skillMeta?.core_features || null,
      homepage: skillMeta?.homepage || null,
      author_id: skillMeta?.author_id || '',
      source_type: 'hub',
      is_builtin: false,
      enabled: true,
      installed_version: version,
      installed_at: new Date().toISOString(),
    };

    await fsp.writeFile(path.join(skillDir, SKILL_HUB_META_FILE), JSON.stringify(meta, null, 2), 'utf-8');

    return { success: true, skillName, version };
  } catch (err) {
    console.error('[SkillStore IPC] installSkillFromZip error:', err);
    throw err;
  }
}

export function registerSkillStoreIpcHandlers() {
  // Fetch skills from Hub with pagination
  ipcMain.handle('skill-store:fetchSkills', async (_event, { cursor, limit = 20, query = '', category = '' } = {}) => {
    try {
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      if (limit) params.set('limit', String(limit));
      if (query) params.set('query', query);
      if (category) params.set('categories', category);

      const url = `${SKILL_HUB_CURSOR_URL}?${params}`;

      const response = await fetch(url, {
        headers: { Authorization: SKILL_HUB_AUTHORIZATION },
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const result = await response.json();

      if (result.success && result.data) {
        return {
          success: true,
          data: {
            skills: result.data.skills || [],
            next_cursor: result.data.next_cursor || null,
            has_more: result.data.has_more || false,
          },
        };
      }
      return { success: false, error: result.message || 'Failed to fetch skills' };
    } catch (err) {
      console.error('[SkillStore] Fetch error:', err);
      return { success: false, error: err.message };
    }
  });

  // Fetch categories
  ipcMain.handle('skill-store:fetchCategories', async () => {
    try {
      const response = await fetch(SKILL_HUB_CATEGORIES_URL, {
        headers: { Authorization: SKILL_HUB_AUTHORIZATION },
      });
      const result = await response.json();
      return { success: true, data: result.data || [] };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Fetch skill detail
  ipcMain.handle('skill-store:fetchSkillDetail', async (_event, { skillId }) => {
    try {
      const response = await fetch(`${SKILL_HUB_BASE_URL}/${skillId}`, {
        headers: { Authorization: SKILL_HUB_AUTHORIZATION },
      });
      const result = await response.json();
      return { success: true, data: result.data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Get installed skills
  ipcMain.handle('skill-store:getInstalledSkills', async () => {
    try {
      const skills = await getInstalledSkills();
      return { success: true, data: skills };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Download and install skill
  ipcMain.handle('skill-store:downloadAndInstall', async (_event, { skillName, sourceUrl, version, checksum, skillMeta }) => {
    try {
      console.log('[SkillStore IPC] downloadAndInstall:', { skillName, sourceUrl, version: version ? 'yes' : 'no', checksum: checksum ? 'yes' : 'no' });
      if (!sourceUrl) {
        return { success: false, error: `sourceUrl is undefined for skill ${skillName}` };
      }
      console.log('[SkillStore IPC] Downloading from:', sourceUrl);
      const zipBuffer = await downloadFile(sourceUrl);
      console.log('[SkillStore IPC] Downloaded bytes:', zipBuffer.length);

      if (checksum) {
        const isValid = await verifyChecksum(zipBuffer, checksum);
        if (!isValid) {
          console.warn('[SkillStore IPC] Checksum mismatch, continuing anyway');
        }
      }

      const result = await installSkillFromZip(zipBuffer, skillName, skillMeta, version);
      console.log('[SkillStore IPC] Install result:', result);
      return result;
    } catch (err) {
      console.error('[SkillStore IPC] Install error:', err);
      return { success: false, error: err.message };
    }
  });

  // Uninstall skill
  ipcMain.handle('skill-store:uninstall', async (_event, { skillName, sourcePath }) => {
    try {
      // If sourcePath not provided, find it in hub directory
      const actualPath = sourcePath || path.join(MOSS_HOME, 'skills', 'hub', skillName);
      const result = await uninstallSkill(skillName, actualPath);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Import local skill (zip or directory)
  ipcMain.handle('skill-store:importLocal', async (_event, { sourcePath }) => {
    try {
      const stat = await fsp.stat(sourcePath);
      const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-skill-import-'));

      try {
        if (stat.isDirectory()) {
          // Copy directory contents
          const entries = await fsp.readdir(sourcePath, { withFileTypes: true });
          for (const entry of entries) {
            const src = path.join(sourcePath, entry.name);
            const dst = path.join(tempDir, entry.name);
            if (entry.isDirectory()) {
              await fsp.mkdir(dst, { recursive: true });
              // TODO: recursive copy
            } else {
              await fsp.copyFile(src, dst);
            }
          }
        } else if (stat.isFile() && path.extname(sourcePath).toLowerCase() === '.zip') {
          const buffer = await fsp.readFile(sourcePath);
          await extractSkillZip(buffer, tempDir);
        } else {
          return { success: false, error: 'Please select a .zip file or a skill directory' };
        }

        // Install to user skills
        const userSkillsDir = path.join(USER_SKILLS_DIR);
        await fsp.mkdir(userSkillsDir, { recursive: true });

        // Find skill name from temp dir
        const entries = await fsp.readdir(tempDir, { withFileTypes: true });
        let skillDir = tempDir;

        // Check if temp dir has SKILL.md directly or in subdirectory
        const hasSkillMd = entries.some(e => e.isFile() && e.name.toLowerCase() === 'skill.md');
        if (!hasSkillMd) {
          const subDirs = entries.filter(e => e.isDirectory());
          if (subDirs.length > 0) {
            skillDir = path.join(tempDir, subDirs[0].name);
          }
        }

        const skillName = path.basename(skillDir);

        // Read skill info
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        const content = await fsp.readFile(skillMdPath, 'utf-8');
        const { frontmatter } = parseFrontmatter(content);

        const targetDir = path.join(userSkillsDir, skillName);
        await fsp.rm(targetDir, { recursive: true, force: true });
        await fsp.mkdir(targetDir, { recursive: true });

        // Copy all files
        const copyRecursive = async (src, dst) => {
          const entries = await fsp.readdir(src, { withFileTypes: true });
          for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const dstPath = path.join(dst, entry.name);
            if (entry.isDirectory()) {
              await fsp.mkdir(dstPath, { recursive: true });
              await copyRecursive(srcPath, dstPath);
            } else {
              await fsp.copyFile(srcPath, dstPath);
            }
          }
        };

        await copyRecursive(skillDir, targetDir);

        // Write meta file
        const meta = {
          id: '',
          name: skillName,
          display_name: frontmatter.name || frontmatter.displayName || skillName,
          description: frontmatter.description || '',
          icon: frontmatter.icon || '',
          emoji: frontmatter.emoji || null,
          category: frontmatter.category || '',
          categories: frontmatter.category ? [frontmatter.category] : [],
          source_type: 'upload',
          is_builtin: false,
          enabled: true,
          installed_version: frontmatter.version || '1.0.0',
          installed_at: new Date().toISOString(),
        };

        await fsp.writeFile(path.join(targetDir, SKILL_HUB_META_FILE), JSON.stringify(meta, null, 2), 'utf-8');

        return { success: true, data: { skillName, installedVersion: meta.installed_version } };
      } finally {
        await fsp.rm(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Open file dialog for local import
  ipcMain.handle('skill-store:openImportDialog', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'openDirectory'],
        filters: [{ name: 'Skill', extensions: ['zip'] }],
      });

      if (result.canceled || !result.filePaths[0]) {
        return { success: false, error: 'Canceled' };
      }

      return { success: true, data: { filePath: result.filePaths[0] } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
