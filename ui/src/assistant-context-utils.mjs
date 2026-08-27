import fsp from 'node:fs/promises';
import path from 'node:path';

export const ASSISTANT_META_FILE = '_moss_meta.json';

const DEFAULT_ASSISTANT_PROMPT_FILE = 'assistant.md';

function normalizeAssistantRelativePath(filePath) {
  if (typeof filePath !== 'string') return '';
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized) return '';
  if (/^[a-zA-Z]:\//.test(normalized)) return '';
  if (normalized.startsWith('/')) return '';

  const safePath = path.posix.normalize(normalized);
  if (safePath === '.' || safePath === '..' || safePath.startsWith('../')) return '';
  return safePath;
}

async function fileExists(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function readAssistantMeta(assistantDir) {
  try {
    const metaContent = await fsp.readFile(path.join(assistantDir, ASSISTANT_META_FILE), 'utf-8');
    return JSON.parse(metaContent);
  } catch {
    return null;
  }
}

export async function findAssistantDirByName(assistantName, searchDirs) {
  const normalizedAssistantName = String(assistantName || '').trim();
  if (!normalizedAssistantName) {
    return null;
  }

  const directories = searchDirs
    .map((entry) => ({
      dir: typeof entry === 'string' ? entry : entry?.dir,
      reservedNames: new Set(
        Array.isArray(entry?.reservedNames)
          ? entry.reservedNames.map((name) => String(name || ''))
          : [],
      ),
    }))
    .filter((entry) => entry.dir);

  const candidateNames = [normalizedAssistantName];
  if (normalizedAssistantName.startsWith('builtin-')) {
    candidateNames.push(normalizedAssistantName.slice('builtin-'.length));
  }

  for (const { dir, reservedNames } of directories) {
    for (const candidateName of candidateNames) {
      if (reservedNames.has(candidateName)) continue;
      const assistantDir = path.join(dir, candidateName);
      try {
        const stat = await fsp.stat(assistantDir);
        if (stat.isDirectory()) {
          return assistantDir;
        }
      } catch {
        // Continue searching.
      }
    }
  }

  for (const { dir, reservedNames } of directories) {
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
        if (reservedNames.has(entry.name)) continue;
        const candidateDir = path.join(dir, entry.name);
        const meta = await readAssistantMeta(candidateDir);
        const metaNames = [
          meta?.id,
          meta?.name,
          meta?.display_name,
          meta?.displayName,
          meta?.agent_name,
          meta?.agentName,
        ].map((value) => String(value || '').trim()).filter(Boolean);
        if (metaNames.includes(normalizedAssistantName)) {
          return candidateDir;
        }
      }
    } catch {
      // Ignore missing or unreadable directories.
    }
  }

  return null;
}

export function getAssistantEnabledSkillIdentifiers(meta) {
  if (Array.isArray(meta?.enabledSkills) && meta.enabledSkills.length > 0) {
    return meta.enabledSkills;
  }
  return Array.isArray(meta?.skills) ? meta.skills : [];
}

function getAssistantPromptFileFromMeta(meta) {
  const promptFile = typeof meta?.prompt_file === 'string' ? meta.prompt_file.trim() : '';
  return promptFile || DEFAULT_ASSISTANT_PROMPT_FILE;
}

export async function resolveAssistantRuleFile(assistantDir, _assistantName, preferredRuleFile = DEFAULT_ASSISTANT_PROMPT_FILE) {
  const candidate = normalizeAssistantRelativePath(preferredRuleFile || DEFAULT_ASSISTANT_PROMPT_FILE);
  if (!candidate || !candidate.toLowerCase().endsWith('.md')) {
    return undefined;
  }
  const fullPath = path.resolve(assistantDir, candidate);
  if (await fileExists(fullPath)) {
    return candidate;
  }
  return undefined;
}

export async function readAssistantContext(assistantDir, assistantName) {
  const meta = await readAssistantMeta(assistantDir);
  const ruleFile = await resolveAssistantRuleFile(
    assistantDir,
    assistantName,
    getAssistantPromptFileFromMeta(meta),
  );

  let rules = '';
  if (ruleFile) {
    try {
      rules = await fsp.readFile(path.resolve(assistantDir, ruleFile), 'utf-8');
    } catch {
      rules = '';
    }
  }

  return {
    meta,
    ruleFile,
    rules,
    enabledSkillIdentifiers: getAssistantEnabledSkillIdentifiers(meta),
  };
}

export function buildInstalledSkillLookup(installedSkills = []) {
  const lookup = new Map();

  for (const skill of installedSkills) {
    if (!skill || !skill.source || skill.enabled === false) continue;

    const namespace = skill.namespace && typeof skill.namespace === 'object'
      ? skill.namespace
      : null;
    const namespaceHandle = String(namespace?.handle || '').trim();
    const slug = String(skill.slug || '').trim();
    const keys = [
      skill.id,
      skill.slug,
      skill.name,
      skill.displayName,
      namespace?.canonicalName,
      namespaceHandle && slug ? `@${namespaceHandle}/${slug}` : '',
      path.basename(skill.source),
    ]
      .map((value) => String(value || '').trim().toLocaleLowerCase('en-US'))
      .filter(Boolean);

    for (const key of keys) {
      if (!lookup.has(key)) {
        lookup.set(key, skill);
      }
    }
  }

  return lookup;
}

export function resolveInstalledSkillInfos(identifiers = [], installedSkills = []) {
  const lookup = buildInstalledSkillLookup(installedSkills);
  const resolvedSkills = [];
  const seenSources = new Set();

  for (const identifier of identifiers) {
    const normalizedIdentifier = String(identifier || '').trim();
    const skill = lookup.get(normalizedIdentifier.toLocaleLowerCase('en-US'));
    if (!skill?.source || seenSources.has(skill.source)) continue;
    seenSources.add(skill.source);
    resolvedSkills.push({
      id: normalizedIdentifier,
      name: skill.name || path.basename(skill.source),
      path: skill.source,
    });
  }

  return resolvedSkills;
}
