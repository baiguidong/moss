import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import JSZip from 'jszip';

export const MAX_REMOTE_SKILL_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_REMOTE_SKILL_EXPANDED_BYTES = 256 * 1024 * 1024;
export const MAX_REMOTE_SKILL_FILES = 10_000;

const ZIP_EPOCH = new Date('1980-01-01T00:00:00.000Z');
const SKIPPED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', '__pycache__']);
const SKIPPED_FILE_NAMES = new Set(['.DS_Store']);

function normalizedArchiveSegment(value) {
  const segment = String(value || '').normalize('NFC');
  if (!segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')) {
    throw new Error(`Invalid skill path segment: ${JSON.stringify(value)}`);
  }
  return segment;
}

async function collectSkillFiles(skillsDir) {
  const files = [];
  let expandedBytes = 0;
  let skillEntries = [];
  try {
    skillEntries = await fsp.readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return files;
    throw error;
  }

  const skills = skillEntries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
    .sort((left, right) => left.name.localeCompare(right.name));

  async function walk(root, directory, archivePrefix) {
    const entries = (await fsp.readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
      if (entry.isFile() && SKIPPED_FILE_NAMES.has(entry.name)) continue;
      const segment = normalizedArchiveSegment(entry.name);
      const sourcePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, sourcePath);
      const archivePath = `${archivePrefix}/${relativePath.split(path.sep).map(normalizedArchiveSegment).join('/')}`;
      if (entry.isDirectory()) {
        await walk(root, sourcePath, archivePrefix);
        continue;
      }
      if (!entry.isFile()) continue;
      const metadata = await fsp.stat(sourcePath);
      expandedBytes += metadata.size;
      if (expandedBytes > MAX_REMOTE_SKILL_EXPANDED_BYTES) {
        throw new Error('Installed skills are too large to synchronize (expanded size exceeds 256 MB).');
      }
      files.push({ sourcePath, archivePath, mode: metadata.mode & 0o777 });
      if (files.length > MAX_REMOTE_SKILL_FILES) {
        throw new Error('Installed skills contain too many files to synchronize.');
      }
    }
  }

  for (const skill of skills) {
    const skillName = normalizedArchiveSegment(skill.name);
    const skillRoot = path.join(skillsDir, skill.name);
    await walk(skillRoot, skillRoot, skillName);
  }
  return files;
}

export async function buildRemoteSkillArchive(skillsDir) {
  const files = await collectSkillFiles(path.resolve(skillsDir));
  const archive = new JSZip();
  for (const file of files) {
    archive.file(file.archivePath, await fsp.readFile(file.sourcePath), {
      date: ZIP_EPOCH,
      createFolders: false,
      unixPermissions: file.mode || 0o600,
    });
  }
  const buffer = await archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'UNIX',
  });
  if (buffer.byteLength > MAX_REMOTE_SKILL_ARCHIVE_BYTES) {
    throw new Error('Installed skills are too large to synchronize (archive exceeds 64 MB).');
  }
  return {
    archive: buffer,
    revision: `sha256:${createHash('sha256').update(buffer).digest('hex')}`,
    fileCount: files.length,
  };
}

export async function synchronizeRemoteSkills({
  skillsDir,
  connection,
  fetchStatus,
  uploadArchive,
}) {
  const local = await buildRemoteSkillArchive(skillsDir);
  const remote = await fetchStatus(connection);
  if (remote?.revision === local.revision) {
    return { revision: local.revision, fileCount: local.fileCount, unchanged: true };
  }
  return uploadArchive({
    ...connection,
    archive: local.archive,
    revision: local.revision,
  });
}
