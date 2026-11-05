import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { parseFileReference } from '../shared/file-reference.mjs';
import { splitDocumentReference } from '../shared/document-location.mjs';
import { isAppResourceUri } from '../shared/app-resource-uri.mjs';
import { parseRemoteWorkspaceUrl } from '../remote-workspace-protocol.mjs';
import { readInteractiveAppResource } from '../apps/app-resources.mjs';
import { allowMediaFile } from '../media-protocol.mjs';

const inside = (root, target) => { const relative = path.relative(root, target); return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)); };
const revision = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');

function distanceWithin(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]));
    if (Math.min(...current) > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

async function nearbyFile(candidate, root) {
  const parent = await fs.realpath(path.dirname(candidate)).catch(() => null);
  if (!parent || !inside(root, parent)) return null;
  const extension = path.extname(candidate).toLowerCase();
  const stem = path.basename(candidate, path.extname(candidate));
  if (stem.length < 8 || stem.length > 80 || !extension) return null;
  const entries = await fs.readdir(parent, { withFileTypes: true }).catch(() => []);
  if (entries.length > 200) return null;
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== extension) continue;
    const other = entry.name.slice(0, -extension.length);
    let prefix = 0;
    while (prefix < Math.min(stem.length, other.length) && stem[prefix] === other[prefix]) prefix++;
    if (prefix < Math.max(4, Math.ceil(Math.min(stem.length, other.length) * 0.75))) continue;
    if ((stem.match(/\d+/g) || []).join(':') !== (other.match(/\d+/g) || []).join(':')) continue;
    const distance = distanceWithin(stem, other, 3);
    if (distance <= 3 && distance / Math.max(stem.length, other.length) <= 0.25) matches.push({ path: path.join(parent, entry.name), distance });
  }
  matches.sort((a, b) => a.distance - b.distance);
  if (!matches.length || matches[1]?.distance <= matches[0].distance + 1) return null;
  const resolved = await fs.realpath(matches[0].path).catch(() => null);
  return resolved && inside(root, resolved) ? resolved : null;
}

export function createPresentationResolver({ readWorkspaceFile, resolveResourceFile }) {
  async function resolveItem(session, item, context = {}) {
    const located = splitDocumentReference(item.resource_uri || item.path);
    if (item.resource_uri) {
      if (!isAppResourceUri(located.reference)) throw new Error('Unsupported resource provider');
      const file = await resolveResourceFile(located.reference, context.origin === 'manual' ? null : session);
      const stat = await fs.stat(file.path);
      return { kind: 'file', title: file.name || path.basename(file.path), revision: revision(stat), source: { type: 'provider', uri: located.reference }, location: located.location,
        ...(file.creation ? { creation: file.creation } : {}),
        owner: { providerId: file.appId }, availability: 'ready', persistence: 'durable', capabilities: { preview: true, edit: false, popout: true } };
    }
    let rawPath = located.reference;
    if (rawPath?.startsWith('moss-remote-workspace://')) {
      const remote = parseRemoteWorkspaceUrl(rawPath);
      if (remote.sessionId !== session.id || session.agentMode !== 'remote-direct') throw new Error('File belongs to another session');
      rawPath = remote.filePath;
    }
    const reference = parseFileReference(rawPath);
    if (!reference) throw new Error('Invalid file reference');
    if (session.agentMode === 'remote-direct') {
      const preview = await readWorkspaceFile(session, reference.path);
      return { kind: 'file', title: preview.relativePath, source: { type: 'file', path: preview.path, remote: true },
        revision: String(preview.metadata?.modifiedAt || '') + ':' + preview.size,
        location: located.location || (reference.line ? { line: reference.line, column: reference.column } : undefined),
        availability: 'ready', persistence: 'durable', capabilities: { preview: true, edit: false, popout: true } };
    }
    if (process.platform !== 'win32' && /^[A-Za-z]:[\\/]/.test(reference.path)) throw new Error('This path belongs to a different host platform');
    const root = session.workspace ? await fs.realpath(session.workspace) : null;
    const absolute = value => path.isAbsolute(value) ? value : /^[~～][\\/]/.test(value) ? path.join(os.homedir(), value.slice(2)) : root ? path.resolve(root, value) : null;
    // A literal filename ending in :digits wins over interpreting the suffix as a location.
    const literal = !/^file:/i.test(item.path) ? absolute(item.path) : null;
    const literalExists = literal && await fs.lstat(literal).then(() => true, () => false);
    const candidate = literalExists ? literal : absolute(reference.path);
    if (!candidate) throw new Error('A workspace is required for relative file references');
    let resolved;
    try { resolved = await fs.realpath(candidate); }
    catch (error) {
      if (context.origin !== 'manual' || error.code !== 'ENOENT' || !root) throw error;
      resolved = await nearbyFile(candidate, root);
      if (!resolved) throw error;
    }
    const stat = await fs.stat(resolved);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error('Only regular files and directories can be displayed');
    const within = root && inside(root, resolved);
    if (!within && context.origin !== 'manual') throw new Error('This file is outside the session workspace; use an authorized App resource or open it manually');
    return { kind: stat.isDirectory() ? 'directory' : 'file', title: path.basename(resolved), source: { type: 'file', path: resolved, ...(stat.isDirectory() && root && inside(root, resolved) ? { workspacePath: path.resolve(session.workspace, path.relative(root, resolved)) } : {}) },
      owner: { hostId: 'local', workspaceId: root || undefined }, revision: revision(stat),
      location: !literalExists ? located.location || (reference.line ? { line: reference.line, column: reference.column } : undefined) : undefined,
      availability: 'ready', persistence: 'durable', capabilities: { preview: true, edit: Boolean(within && stat.isFile()), popout: stat.isFile() } };
  }
  async function loadResource(session, resource) {
    if (resource.source.type === 'inline') return resource.source.file;
    if (!['file', 'provider'].includes(resource.source.type) || resource.kind === 'directory') return null;
    let target = resource.source.path, providerFile;
    if (resource.source.type === 'provider') { providerFile = await resolveResourceFile(resource.source.uri, null); target = providerFile.path; }
    let file;
    if (session.agentMode === 'remote-direct' && resource.source.type === 'file') file = await readWorkspaceFile(session, target);
    else {
      const root = session.workspace ? await fs.realpath(session.workspace).catch(() => null) : null;
      const resolved = await fs.realpath(target);
      const inWorkspace = root && inside(root, resolved) && resource.source.type === 'file';
      const before = await fs.stat(resolved);
      if (revision(before) !== resource.revision) throw new Error('文件在读取前发生变化，请重新打开');
      file = await readInteractiveAppResource(providerFile) || await readWorkspaceFile(inWorkspace ? { ...session, workspace: root } : { agentMode: 'local', workspace: path.dirname(resolved) }, resolved);
      if (revision(await fs.stat(resolved)) !== revision(before)) throw new Error('文件在读取期间发生变化，请重新打开');
      if (!inWorkspace) file.metadata = { ...file.metadata, previewEditable: false, previewSaveable: false };
    }
    let creation = providerFile?.creation;
    if (/^[a-f0-9]{64}$/.test(creation?.sourceSha256 || '')) {
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(target)) digest.update(chunk);
      if (digest.digest('hex') !== creation.sourceSha256) creation = { ...creation, quality: { ...creation.quality, state: 'stale', reviewedPages: 0, checks: [{ message: '文件已在外部修改，需要重新读取并核验当前版本。' }] } };
    }
    const previewPdfPath = creation?.quality?.state !== 'stale' && /^[a-f0-9]{64}$/.test(creation?.sourceSha256 || '') && typeof creation?.previewPdfPath === 'string' && path.extname(creation.previewPdfPath).toLowerCase() === '.pdf' && await fs.stat(creation.previewPdfPath).then(s => s.isFile(), () => false) ? creation.previewPdfPath : undefined;
    if (previewPdfPath) allowMediaFile(previewPdfPath);
    return { ...file, ...(resource.view === 'source' && file.content ? { contentType: 'code' } : {}), metadata: {
      ...file.metadata, ...(providerFile ? { resourceUri: resource.source.uri } : {}), sessionId: session.id, workspace: session.workspace, originalContent: file.content, dirty: false,
      ...(providerFile?.presentation?.type === 'interactive-html' && file.contentType === 'html' ? { interactiveVisualization: true, resourceUri: resource.source.uri } : {}),
      artifactId: resource.id, presentationRevision: resource.revision, line: resource.location?.line, column: resource.location?.column,
      documentLocation: resource.location, locationRequest: resource.sequence,
      ...(creation ? { creation } : {}),
      ...(previewPdfPath ? { officePreviewPdfPath: previewPdfPath } : {}),
      ...(providerFile?.presentation?.type === 'document-comparison' ? { documentComparison: true } : {}),
    } };
  }
  return { resolveItem, loadResource };
}
