import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { calculateFileSha256, isPathInsideDirectory } from './shared/file-path-utils.mjs';

export function createProjectAssetService({
  appendProjectEvent,
  emitToRenderer,
  ensureProjectStructure,
  getProjectAssetIndexPath,
  getProjectAssetsDir,
  getProjectDir,
  getProjectWorkspaceDir,
  normalizeProjectId,
  projectRecordQueues,
  readJsonFileAsync,
  readProject,
  runInKeyedQueue,
  writeJsonFileAtomicAsync,
  writeProject,
}) {
  const projectAssetQueues = new Map();

  function normalizeProjectAsset(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '';
    const filePath = typeof raw.path === 'string' && raw.path.trim() ? raw.path.trim() : '';
    if (!id || !name || !filePath) return null;
    return {
      id,
      name,
      fileName: typeof raw.fileName === 'string' && raw.fileName.trim() ? raw.fileName.trim() : name,
      path: filePath,
      relativePath: typeof raw.relativePath === 'string' ? raw.relativePath : '',
      size: Number.isFinite(raw.size) ? raw.size : 0,
      mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : '',
      sourceType: typeof raw.sourceType === 'string' && raw.sourceType.trim() ? raw.sourceType.trim() : 'upload',
      sourceSessionId: typeof raw.sourceSessionId === 'string' && raw.sourceSessionId.trim() ? raw.sourceSessionId.trim() : null,
      sourcePath: typeof raw.sourcePath === 'string' && raw.sourcePath.trim() ? raw.sourcePath.trim() : null,
      contentHash: typeof raw.contentHash === 'string' && /^[a-f0-9]{64}$/i.test(raw.contentHash)
        ? raw.contentHash.toLowerCase()
        : null,
      provenance: Array.isArray(raw.provenance)
        ? raw.provenance.filter((entry) => entry && typeof entry === 'object').slice(-100).map((entry) => ({
          sourceSessionId: typeof entry.sourceSessionId === 'string' && entry.sourceSessionId.trim()
            ? entry.sourceSessionId.trim()
            : null,
          sourcePath: typeof entry.sourcePath === 'string' && entry.sourcePath.trim()
            ? entry.sourcePath.trim()
            : null,
          recordedAt: Number.isFinite(entry.recordedAt) ? entry.recordedAt : Date.now(),
        }))
        : [],
      description: typeof raw.description === 'string' ? raw.description : '',
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    };
  }


  async function collectProjectWorkspaceFiles(rootDir, options = {}) {
    const root = path.resolve(rootDir);
    const files = [];
    const pending = [root];
    const maxFiles = Number.isInteger(options.maxFiles) ? options.maxFiles : 10_000;
    while (pending.length > 0 && files.length < maxFiles) {
      const current = pending.pop();
      let entries = [];
      try {
        entries = await fsp.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const target = path.join(current, entry.name);
        if (!isPathInsideDirectory(root, target)) continue;
        if (entry.isDirectory()) {
          pending.push(target);
        } else if (entry.isFile()) {
          try {
            const stat = await fsp.stat(target);
            files.push({ path: target, stat });
          } catch {}
        }
        if (files.length >= maxFiles) break;
      }
    }
    return {
      files,
      truncated: files.length >= maxFiles,
    };
  }

  async function listProjectAssetsUnlocked(projectId) {
    const id = normalizeProjectId(projectId);
    await ensureProjectStructure(id);
    const raw = await readJsonFileAsync(getProjectAssetIndexPath(id), []);
    // Results are explicit references. Old workspace-scan entries remain on disk for migration,
    // but unrelated source files are no longer presented as deliverables.
    const indexed = Array.isArray(raw) ? raw.map(normalizeProjectAsset).filter(Boolean) : [];
    return indexed.filter(asset => asset.sourceType !== 'project_workspace').sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function listProjectAssets(projectId) {
    const id = normalizeProjectId(projectId);
    return runInKeyedQueue(projectAssetQueues, id, () => listProjectAssetsUnlocked(id));
  }

  async function writeProjectAssets(projectId, assets) {
    const unique = [];
    const paths = new Set();
    for (const raw of assets) {
      const asset = normalizeProjectAsset(raw);
      if (!asset) continue;
      const resolvedPath = path.resolve(asset.path);
      if (paths.has(resolvedPath)) continue;
      paths.add(resolvedPath);
      unique.push({ ...asset, path: resolvedPath });
    }
    await writeJsonFileAtomicAsync(getProjectAssetIndexPath(projectId), unique);
  }

  async function commitActiveProjectAssets(projectId, assets, updatedAt = Date.now()) {
    const id = normalizeProjectId(projectId);
    return runInKeyedQueue(projectRecordQueues, id, async () => {
      const project = await readProject(id);
      if (!project || project.archivedAt) throw new Error('Project not found.');
      await writeProjectAssets(id, assets);
      await writeProject({
        ...project,
        updatedAt: Math.max(project.updatedAt || 0, updatedAt),
      });
    });
  }

  async function createUniqueAssetPath(projectId, fileName) {
    const safeName = String(fileName || 'asset').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'asset';
    const parsed = path.parse(safeName);
    let candidate = path.join(getProjectAssetsDir(projectId), safeName);
    let index = 1;
    while (fs.existsSync(candidate)) {
      const nextName = `${parsed.name || 'asset'}-${index}${parsed.ext || ''}`;
      candidate = path.join(getProjectAssetsDir(projectId), nextName);
      index += 1;
    }
    return candidate;
  }


  async function addProjectAssetUnlocked(projectId, payload = {}) {
    const project = await readProject(projectId);
    if (!project || project.archivedAt) {
      throw new Error('Project not found.');
    }
    const sourcePath = typeof payload.sourcePath === 'string' ? payload.sourcePath.trim() : '';
    if (!sourcePath) {
      throw new Error('Asset source path is required.');
    }
    const stat = await fsp.stat(sourcePath);
    if (!stat.isFile()) {
      throw new Error('Asset source must be a file.');
    }
    await ensureProjectStructure(project.id);
    const contentHash = await calculateFileSha256(sourcePath);
    const assets = await listProjectAssetsUnlocked(project.id);
    const now = Date.now();
    const provenanceEntry = {
      sourceSessionId: typeof payload.sourceSessionId === 'string' && payload.sourceSessionId.trim()
        ? payload.sourceSessionId.trim()
        : null,
      sourcePath,
      recordedAt: now,
    };
    let existingAsset = assets.find((asset) => asset.contentHash === contentHash && asset.size === stat.size);
    if (!existingAsset) {
      for (const candidate of assets.filter((asset) => asset.size === stat.size && !asset.contentHash)) {
        const candidateHash = await calculateFileSha256(candidate.path).catch(() => null);
        if (candidateHash === contentHash) {
          existingAsset = { ...candidate, contentHash: candidateHash };
          break;
        }
      }
    }
    if (existingAsset) {
      const currentProject = await readProject(project.id);
      if (!currentProject || currentProject.archivedAt) {
        throw new Error('项目已删除，停止添加资产。');
      }
      const provenance = [...existingAsset.provenance];
      if (!provenance.some((entry) => (
        entry.sourceSessionId === provenanceEntry.sourceSessionId &&
        entry.sourcePath === provenanceEntry.sourcePath
      ))) provenance.push(provenanceEntry);
      const updated = normalizeProjectAsset({
        ...existingAsset,
        contentHash,
        provenance: provenance.slice(-100),
        updatedAt: now,
      });
      await commitActiveProjectAssets(
        project.id,
        assets.map((asset) => asset.id === updated.id ? updated : asset),
        now,
      );
      return updated;
    }
    const destPath = await createUniqueAssetPath(project.id, payload.fileName || path.basename(sourcePath));
    await fsp.copyFile(sourcePath, destPath);
    const destStat = await fsp.stat(destPath);
    const asset = {
      id: `asset-${randomUUID().slice(0, 12)}`,
      name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : path.basename(destPath),
      fileName: path.basename(destPath),
      path: destPath,
      relativePath: path.relative(getProjectDir(project.id), destPath),
      size: destStat.size,
      mimeType: '',
      sourceType: typeof payload.sourceType === 'string' && payload.sourceType.trim()
        ? payload.sourceType.trim()
        : 'upload',
      sourceSessionId: typeof payload.sourceSessionId === 'string' && payload.sourceSessionId.trim()
        ? payload.sourceSessionId.trim()
        : null,
      sourcePath,
      contentHash,
      provenance: [provenanceEntry],
      description: typeof payload.description === 'string' ? payload.description : '',
      createdAt: now,
      updatedAt: now,
    };
    const currentProject = await readProject(project.id);
    if (!currentProject || currentProject.archivedAt) {
      await fsp.rm(destPath, { force: true });
      throw new Error('项目已删除，停止添加资产。');
    }
    try {
      await commitActiveProjectAssets(project.id, [asset, ...assets], now);
    } catch (error) {
      await fsp.rm(destPath, { force: true }).catch(() => {});
      throw error;
    }
    await appendProjectEvent(project.id, {
      type: asset.sourceType === 'session_output' ? 'asset.generated' : 'asset.uploaded',
      summary: `${asset.sourceType === 'session_output' ? '生成' : '上传'}资产：${asset.name}`,
      actor: asset.sourceType === 'session_output' ? 'agent' : 'user',
      targetType: 'asset',
      targetId: asset.id,
      metadata: { sourceSessionId: asset.sourceSessionId },
    });
    emitToRenderer('project:changed', { projectId: project.id, reason: 'assets' });
    return asset;
  }

  async function addProjectAsset(projectId, payload = {}) {
    const id = normalizeProjectId(projectId);
    return runInKeyedQueue(projectAssetQueues, id, () => addProjectAssetUnlocked(id, payload));
  }

  async function registerProjectResult(projectId, { sourcePath, sourceSessionId, name, description = '' }) {
    const id = normalizeProjectId(projectId);
    if (!sourceSessionId) throw new Error('Result source session is required.');
    return runInKeyedQueue(projectAssetQueues, id, async () => {
      const filePath = await fsp.realpath(sourcePath);
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) throw new Error('成果必须是文件。');
      const assets = await listProjectAssetsUnlocked(id);
      const contentHash = await calculateFileSha256(filePath);
      const existing = assets.find(asset => path.resolve(asset.path) === filePath);
      const now = Date.now();
      const provenance = [...(existing?.provenance || [])];
      if (!provenance.some(entry => entry.sourceSessionId === sourceSessionId && entry.sourcePath === filePath)) {
        provenance.push({ sourceSessionId, sourcePath: filePath, recordedAt: now });
      }
      const asset = normalizeProjectAsset({ ...existing, id: existing?.id || `result-${randomUUID()}`,
        name: name || path.basename(filePath), fileName: path.basename(filePath), path: filePath,
        relativePath: path.relative(getProjectDir(id), filePath), size: stat.size, contentHash,
        sourceType: 'session_output', sourceSessionId, sourcePath: filePath, provenance, description,
        createdAt: existing?.createdAt || now, updatedAt: now });
      await commitActiveProjectAssets(id, [asset, ...assets.filter(item => item.id !== asset.id)], now);
      await appendProjectEvent(id, { type: 'asset.generated', summary: `登记成果：${asset.name}`, actor: 'agent',
        targetType: 'asset', targetId: asset.id, metadata: { sourceSessionId } });
      emitToRenderer('project:changed', { projectId: id, reason: 'assets' });
      return asset;
    });
  }

  async function removeProjectAssetUnlocked(projectId, assetId) {
    const id = normalizeProjectId(projectId);
    const project = await readProject(id);
    if (!project || project.archivedAt) throw new Error('Project not found.');
    const assets = await listProjectAssetsUnlocked(id);
    const asset = assets.find((entry) => entry.id === assetId);
    if (!asset) return { ok: true };
    const next = assets.filter((entry) => entry.id !== assetId);
    const removedAt = Date.now();
    await runInKeyedQueue(projectRecordQueues, id, async () => {
      const currentProject = await readProject(id);
      if (!currentProject || currentProject.archivedAt) throw new Error('Project not found.');
      await writeProjectAssets(id, next);
      await writeProject({
        ...currentProject,
        updatedAt: Math.max(currentProject.updatedAt || 0, removedAt),
      });
    });
    if (asset) {
      await appendProjectEvent(id, {
        type: 'asset.removed',
        summary: `移除资产：${asset.name}`,
        actor: 'user',
        targetType: 'asset',
        targetId: asset.id,
      });
    }
    emitToRenderer('project:changed', { projectId: id, reason: 'assets' });
    return { ok: true };
  }

  async function removeProjectAsset(projectId, assetId) {
    const id = normalizeProjectId(projectId);
    return runInKeyedQueue(projectAssetQueues, id, () => removeProjectAssetUnlocked(id, assetId));
  }

  // A project task is a root Project Coordinator session.

  return {
    addProjectAsset,
    registerProjectResult,
    collectProjectWorkspaceFiles,
    listProjectAssets,
    // Only for callers already holding projectRecordQueues; avoids reversed queue order.
    readProjectAssetsForCommit: listProjectAssetsUnlocked,
    removeProjectAsset,
  };
}
