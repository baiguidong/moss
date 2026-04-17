import { ipcMain, dialog } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import JSZip from 'jszip';

const MOSS_HOME = path.join(os.homedir(), '.moss');
const MOSS_ASSISTANTS_DIR = path.join(MOSS_HOME, 'assistants');
const ASSISTANT_HUB_DIR = path.join(MOSS_ASSISTANTS_DIR, '_hub');
const ASSISTANT_SYSTEM_DIR = path.join(MOSS_ASSISTANTS_DIR, '_system');
const ASSISTANT_CUSTOM_DIR = path.join(MOSS_ASSISTANTS_DIR, '_my-custom-assistant');
const ASSISTANT_HUB_BASE_URL = 'https://sudoclawhub.sudoprivacy.com/api/assistants';
const ASSISTANT_HUB_CURSOR_URL = 'https://sudoclawhub.sudoprivacy.com/api/assistants/cursor';
const ASSISTANT_CATEGORY_URL = 'https://sudoclawhub.sudoprivacy.com/api/categories';
const ASSISTANT_HUB_AUTHORIZATION = 'sud0@sudo';
const ASSISTANT_META_FILE = '_moss_meta.json';

async function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: { 'User-Agent': 'Moss-AssistantHub/1.0' },
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

function normalizeZipEntryPath(entryPath) {
  return path.posix.normalize(entryPath.replaceAll('\\', '/').replace(/^\.\/+/, ''));
}

function resolveZipAssistantLayout(zip) {
  const fileEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => normalizeZipEntryPath(entry.name))
    .filter((entryPath) => !entryPath.includes('__MACOSX') && !entryPath.endsWith('.DS_Store'))
    .filter(Boolean);

  for (const entryPath of fileEntries) {
    if (isUnsafeZipEntryPath(entryPath)) {
      throw new Error(`Unsafe zip entry path: ${entryPath}`);
    }
  }

  const topLevelParts = fileEntries.map((entryPath) => entryPath.split('/')[0]);
  const uniqueTopLevel = Array.from(new Set(topLevelParts));

  if (uniqueTopLevel.length === 1 && fileEntries.every((e) => e.includes('/'))) {
    return { stripPrefix: `${uniqueTopLevel[0]}/` };
  }

  return { stripPrefix: '' };
}

async function extractAssistantZip(buffer, targetDir) {
  const zip = await JSZip.loadAsync(buffer);
  const { stripPrefix } = resolveZipAssistantLayout(zip);

  await fsp.mkdir(targetDir, { recursive: true });

  for (const zipEntry of Object.values(zip.files)) {
    if (zipEntry.dir) continue;
    if (isUnsafeZipEntryPath(zipEntry.name)) {
      throw new Error(`Unsafe zip entry path: ${zipEntry.name}`);
    }

    const normalizedPath = normalizeZipEntryPath(zipEntry.name);
    if (normalizedPath.includes('__MACOSX') || normalizedPath.endsWith('.DS_Store')) continue;

    let targetPath = normalizedPath;

    if (stripPrefix) {
      if (!normalizedPath.startsWith(stripPrefix)) continue;
      targetPath = normalizedPath.slice(stripPrefix.length);
    }

    if (!targetPath) continue;

    const fullPath = path.join(targetDir, targetPath);
    const fullDir = path.dirname(fullPath);
    await fsp.mkdir(fullDir, { recursive: true });

    const content = await zipEntry.async('nodebuffer');
    await fsp.writeFile(fullPath, content);
  }
}

async function selectRuleFile(assistantDir, assistantName) {
  try {
    const files = await fsp.readdir(assistantDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    if (mdFiles.length === 0) return undefined;

    const primaryRuleFile = mdFiles.find((f) => f === `${assistantName}.md`);
    if (primaryRuleFile) return primaryRuleFile;

    return mdFiles[0];
  } catch {
    return undefined;
  }
}

async function scanAssistantDirs(baseDir) {
  const dirs = [];
  try {
    await fsp.access(baseDir);
  } catch {
    return dirs;
  }
  const entries = await fsp.readdir(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_')) continue;
    dirs.push(path.join(baseDir, entry.name));
  }
  return dirs;
}

function findAssistantDir(name) {
  const searchDirs = [
    { dir: ASSISTANT_CUSTOM_DIR, category: 'custom' },
    { dir: ASSISTANT_HUB_DIR, category: 'hub' },
    { dir: ASSISTANT_SYSTEM_DIR, category: 'system' },
  ];

  for (const { dir, category } of searchDirs) {
    const assistantDir = path.join(dir, name);
    try {
      fs.accessSync(assistantDir);
      return { dir: assistantDir, category };
    } catch {
      // Not found in this directory
    }
  }

  // Try stripping 'builtin-' prefix for system dir lookup
  if (name.startsWith('builtin-')) {
    const stripped = name.slice('builtin-'.length);
    const systemPath = path.join(ASSISTANT_SYSTEM_DIR, stripped);
    try {
      fs.accessSync(systemPath);
      return { dir: systemPath, category: 'system' };
    } catch {
      // Not found
    }
  }

  return null;
}

async function getInstalledAssistants() {
  const assistants = [];

  for (const baseDir of [ASSISTANT_SYSTEM_DIR, ASSISTANT_HUB_DIR, ASSISTANT_CUSTOM_DIR]) {
    const dirs = await scanAssistantDirs(baseDir);
    for (const assistantDir of dirs) {
      const dirName = path.basename(assistantDir);
      let category = 'custom';
      if (assistantDir.startsWith(ASSISTANT_SYSTEM_DIR)) category = 'system';
      else if (assistantDir.startsWith(ASSISTANT_HUB_DIR)) category = 'hub';

      const metaPath = path.join(assistantDir, ASSISTANT_META_FILE);
      try {
        const metaContent = await fsp.readFile(metaPath, 'utf-8');
        const meta = JSON.parse(metaContent);
        assistants.push({
          name: dirName,
          displayName: meta.display_name || meta.name || dirName,
          description: meta.description || '',
          avatar: meta.avatar || '',
          emoji: meta.emoji || '',
          category: meta.category || '',
          categories: meta.categories || [],
          version: meta.installed_version || '',
          source: assistantDir,
          isBuiltin: meta.is_builtin === true,
          isHubInstalled: meta.source_type === 'hub',
          tag: meta.tag || category,
          enabled: meta.enabled !== false,
          skills: meta.skills || [],
          enabledSkills: meta.enabledSkills || [],
        });
      } catch {
        assistants.push({
          name: dirName,
          displayName: dirName,
          description: '',
          avatar: '',
          emoji: '',
          category: '',
          categories: [],
          version: '',
          source: assistantDir,
          isBuiltin: false,
          isHubInstalled: category === 'hub',
          tag: category,
          enabled: true,
          skills: [],
          enabledSkills: [],
        });
      }
    }
  }

  return assistants;
}

export function registerAgentIpcHandlers() {
  // Fetch assistants from Hub with pagination
  ipcMain.handle('agent:fetchAssistants', async (_event, { cursor, limit = 20, query = '', category = '' } = {}) => {
    try {
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      if (limit) params.set('limit', String(limit));
      if (query) params.set('query', query);
      if (category) params.set('category', category);

      const url = `${ASSISTANT_HUB_CURSOR_URL}?${params}`;

      const response = await fetch(url, {
        headers: { Authorization: ASSISTANT_HUB_AUTHORIZATION },
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const result = await response.json();

      if (result.success && result.data) {
        const rawAssistants = result.data.assistants || [];
        const assistants = rawAssistants.map((a) => ({
          id: a.id,
          name: a.name,
          display_name: a.profession || a.name,
          description: a.description || '',
          avatar: a.avatar || '',
          emoji: null,
          categories: a.categories || [],
          category: (a.categories || [])[0] || '',
          _sourceUrl: a.sourceUrl || '',
        }));

        return {
          success: true,
          data: {
            assistants,
            next_cursor: result.data.next_cursor || null,
            has_more: result.data.has_more || false,
          },
        };
      }
      return { success: false, error: result.message || 'Failed to fetch assistants' };
    } catch (err) {
      console.error('[AgentStore] Fetch error:', err);
      return { success: false, error: err.message };
    }
  });

  // Fetch categories
  ipcMain.handle('agent:fetchCategories', async () => {
    try {
      const response = await fetch(`${ASSISTANT_CATEGORY_URL}?type=1`, {
        headers: { Authorization: ASSISTANT_HUB_AUTHORIZATION },
      });
      const result = await response.json();
      return { success: true, data: result.data || [] };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Fetch assistant detail
  ipcMain.handle('agent:fetchAssistantDetail', async (_event, { assistantId }) => {
    try {
      const response = await fetch(`${ASSISTANT_HUB_BASE_URL}/${assistantId}`, {
        headers: { Authorization: ASSISTANT_HUB_AUTHORIZATION },
      });
      const result = await response.json();
      return { success: true, data: result.data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Get installed assistants
  ipcMain.handle('agent:getInstalledAssistants', async () => {
    try {
      const assistants = await getInstalledAssistants();
      return { success: true, data: assistants };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Download and install assistant
  ipcMain.handle('agent:downloadAndInstall', async (_event, { assistantName, sourceUrl, version, checksum, assistantMeta, selectedSkillIds = [] }) => {
    try {
      console.log('[AgentStore IPC] downloadAndInstall:', { assistantName, sourceUrl, selectedSkillIds });
      if (!sourceUrl) {
        return { success: false, error: `sourceUrl is undefined for assistant ${assistantName}` };
      }

      const zipBuffer = await downloadFile(sourceUrl);
      console.log('[AgentStore IPC] Downloaded bytes:', zipBuffer.length);

      if (checksum) {
        const isValid = await verifyChecksum(zipBuffer, checksum);
        if (!isValid) {
          console.warn('[AgentStore IPC] Checksum mismatch, continuing anyway');
        }
      }

      await fsp.mkdir(ASSISTANT_HUB_DIR, { recursive: true });

      const assistantDir = path.join(ASSISTANT_HUB_DIR, assistantName);
      await fsp.rm(assistantDir, { recursive: true, force: true });
      await fsp.mkdir(assistantDir, { recursive: true });

      await extractAssistantZip(zipBuffer, assistantDir);

      const ruleFile = await selectRuleFile(assistantDir, assistantName);

      // Install associated skills
      const installedSkillNames = [];
      const failedSkillIds = [];
      const allAssociatedSkillIds = [];

      if (selectedSkillIds && selectedSkillIds.length > 0) {
        // Get current installed skills
        const installedSkills = await getInstalledSkills();
        const installedSkillNamesSet = new Set(installedSkills.map(s => s.name));

        for (const skillId of selectedSkillIds) {
          allAssociatedSkillIds.push(skillId);

          // Check if skill is already installed (by name)
          // Try to find skill in installed list
          const skillDetailRes = await fetch(`https://sudoclawhub.sudoprivacy.com/api/skills/${skillId}`, {
            headers: { Authorization: ASSISTANT_HUB_AUTHORIZATION },
          });
          const skillDetailData = await skillDetailRes.json();

          if (skillDetailData.success && skillDetailData.data?.skill) {
            const skillInfo = skillDetailData.data.skill;
            const skillName = skillInfo.name;

            if (installedSkillNamesSet.has(skillName)) {
              continue; // Already installed
            }

            // Install the skill
            const versions = skillDetailData.data.versions || [];
            if (!versions || versions.length === 0) {
              console.warn('[AgentStore IPC] Skill has no versions:', skillName);
              failedSkillIds.push(skillId);
              continue;
            }

            const latestVersion = versions[0];
            if (!latestVersion?.source_url) {
              console.warn('[AgentStore IPC] Skill has no source_url:', skillName);
              failedSkillIds.push(skillId);
              continue;
            }

            try {
              const skillZipBuffer = await downloadFile(latestVersion.source_url);
              if (latestVersion.checksum) {
                const isValid = await verifyChecksum(skillZipBuffer, latestVersion.checksum);
                if (!isValid) {
                  console.warn('[AgentStore IPC] Skill checksum mismatch:', skillName);
                }
              }

              const MOSS_SKILLS_DIR = path.join(MOSS_HOME, 'skills', 'hub');
              const skillDir = path.join(MOSS_SKILLS_DIR, skillName);
              await fsp.mkdir(skillDir, { recursive: true });

              // Extract skill - use simplified extraction
              const skillZip = await JSZip.loadAsync(skillZipBuffer);
              for (const zipEntry of Object.values(skillZip.files)) {
                if (zipEntry.dir) continue;
                const normalizedPath = normalizeZipEntryPath(zipEntry.name);
                let targetPath = normalizedPath;
                if (normalizedPath.includes('/')) {
                  targetPath = normalizedPath.split('/').slice(1).join('/');
                }
                if (!targetPath) continue;
                const fullPath = path.join(skillDir, targetPath);
                await fsp.mkdir(path.dirname(fullPath), { recursive: true });
                const content = await zipEntry.async('nodebuffer');
                await fsp.writeFile(fullPath, content);
              }

              // Write skill meta
              const skillMeta = {
                id: skillInfo.id,
                name: skillName,
                display_name: skillInfo.display_name,
                description: skillInfo.description,
                icon: skillInfo.icon,
                emoji: skillInfo.emoji,
                category: skillInfo.category,
                categories: skillInfo.categories,
                source_type: 'hub',
                is_builtin: false,
                enabled: true,
                installed_version: latestVersion.version,
                installed_at: new Date().toISOString(),
              };
              await fsp.writeFile(path.join(skillDir, '_moss_meta.json'), JSON.stringify(skillMeta, null, 2), 'utf-8');
              installedSkillNames.push(skillName);
              installedSkillNamesSet.add(skillName);
            } catch (skillErr) {
              console.warn('[AgentStore IPC] Failed to install skill:', skillId, skillErr);
              failedSkillIds.push(skillId);
            }
          } else {
            failedSkillIds.push(skillId);
          }
        }
      }

      const meta = {
        id: assistantMeta?.id || '',
        name: assistantName,
        display_name: assistantMeta?.display_name || assistantMeta?.name || assistantName,
        description: assistantMeta?.description || '',
        avatar: assistantMeta?.avatar || '',
        emoji: assistantMeta?.emoji || null,
        category: assistantMeta?.category || '',
        categories: assistantMeta?.categories || [],
        source_type: 'hub',
        tag: 'hub',
        is_builtin: false,
        enabled: true,
        installed_version: version,
        installed_at: new Date().toISOString(),
        ruleFile: ruleFile,
        skills: allAssociatedSkillIds,
        enabledSkills: allAssociatedSkillIds,
      };

      await fsp.writeFile(path.join(assistantDir, ASSISTANT_META_FILE), JSON.stringify(meta, null, 2), 'utf-8');

      return {
        success: true,
        assistantName,
        version,
        installedSkills: installedSkillNames,
        failedSkills: failedSkillIds,
      };
    } catch (err) {
      console.error('[AgentStore IPC] Install error:', err);
      return { success: false, error: err.message };
    }
  });

  // Uninstall assistant
  ipcMain.handle('agent:uninstall', async (_event, { assistantName, sourcePath }) => {
    try {
      const result = sourcePath
        ? { dir: sourcePath }
        : findAssistantDir(assistantName);

      if (!result) {
        return { success: false, error: 'Assistant not found' };
      }

      // Check if builtin
      const metaPath = path.join(result.dir, ASSISTANT_META_FILE);
      try {
        const metaContent = await fsp.readFile(metaPath, 'utf-8');
        const meta = JSON.parse(metaContent);
        if (meta.is_builtin === true) {
          return { success: false, error: 'Builtin assistants cannot be uninstalled' };
        }
      } catch {
        // No meta file, allow uninstall
      }

      await fsp.rm(result.dir, { recursive: true, force: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Update assistant meta
  ipcMain.handle('agent:updateAssistantMeta', async (_event, { assistantName, updates }) => {
    try {
      const result = findAssistantDir(assistantName);
      if (!result) {
        return { success: false, error: 'Assistant not found' };
      }

      const metaPath = path.join(result.dir, ASSISTANT_META_FILE);
      let meta = {};
      try {
        const raw = await fsp.readFile(metaPath, 'utf-8');
        meta = JSON.parse(raw);
      } catch {
        // Start fresh if no meta
      }

      const merged = { ...meta, ...updates };
      await fsp.writeFile(metaPath, JSON.stringify(merged, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Fetch skill details by IDs
  ipcMain.handle('agent:fetchSkillDetailsByIds', async (_event, { skillIds }) => {
    try {
      if (!skillIds || skillIds.length === 0) {
        return { success: true, data: [] };
      }

      const results = await Promise.all(
        skillIds.map(async (id) => {
          try {
            const response = await fetch(`https://sudoclawhub.sudoprivacy.com/api/skills/${id}`, {
              headers: { Authorization: ASSISTANT_HUB_AUTHORIZATION },
            });
            const data = await response.json();
            if (data.success && data.data?.skill) {
              return data.data.skill;
            }
            return null;
          } catch {
            return null;
          }
        })
      );

      return { success: true, data: results.filter(Boolean) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Read assistant rule file content
  ipcMain.handle('agent:getAssistantContext', async (_event, { assistantName }) => {
    try {
      const result = findAssistantDir(assistantName);
      if (!result) {
        return { success: false, error: 'Assistant not found' };
      }

      const metaPath = path.join(result.dir, ASSISTANT_META_FILE);
      let ruleFile;
      try {
        const metaContent = await fsp.readFile(metaPath, 'utf-8');
        const meta = JSON.parse(metaContent);
        ruleFile = meta.ruleFile;
      } catch {
        // No meta
      }

      let content = '';
      if (ruleFile) {
        try {
          content = await fsp.readFile(path.join(result.dir, ruleFile), 'utf-8');
        } catch {
          // Try common rule file names
        }
      }
      if (!content) {
        const files = await fsp.readdir(result.dir);
        const mdFile = files.find(f => f.endsWith('.md') && f !== ASSISTANT_META_FILE);
        if (mdFile) {
          content = await fsp.readFile(path.join(result.dir, mdFile), 'utf-8');
        }
      }
      return { success: true, data: content };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}
