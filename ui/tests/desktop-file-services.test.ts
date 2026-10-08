import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkspaceFileService } from '../src/workspace-files.mjs';
import { createSessionPromptPreparation } from '../src/session-prompt-preparation.mjs';
import { createProjectAssetService } from '../src/project-assets.mjs';
import { createSessionTaskService } from '../src/session-task-service.mjs';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-main-services-'));
  roots.push(root);
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  return { root, workspace, record: { id: 'desktop-id', workspace, agentMode: 'local' } };
}

describe('extracted workspace and prompt services', () => {
  it('reads local files and rejects paths and symlinks outside the workspace', async () => {
    const { root, workspace, record } = await fixture();
    const file = path.join(workspace, 'notes.txt');
    const outside = path.join(root, 'outside.txt');
    await writeFile(file, 'inside');
    await writeFile(outside, 'outside');
    const link = path.join(workspace, 'link.txt');
    await symlink(outside, link);
    const service = createWorkspaceFileService({ allowMediaRoot() {}, MAX_IMAGE_BASE64_BYTES: 1024 });
    expect((await service.readWorkspaceFile(record, file)).content).toBe('inside');
    await expect(service.readWorkspaceFile(record, outside)).rejects.toThrow('outside');
    await expect(service.readWorkspaceFile(record, link)).rejects.toThrow('outside');
  });

  it('uploads using the server ID but returns the desktop URI and consumes attachment data once', async () => {
    const { record } = await fixture();
    Object.assign(record, { agentMode: 'remote-direct', underlyingSessionId: 'server-id' });
    const requests: any[] = [];
    const changes: any[] = [];
    const service = createWorkspaceFileService({
      ensureRuntime: async () => ({ ensureSession: async () => ({ config: { sessionId: 'server-id' } }) }),
      uploadRemoteDirectWorkspaceData: async (request: any) => {
        requests.push(request);
        return { relativePath: 'uploads/a.png', path: '/workspace/uploads/a.png' };
      },
      emitWorkspaceChanged: (...args: any[]) => changes.push(args),
    });
    const data = Buffer.from('image');
    const uploaded = await service.uploadFileToRemoteSessionWorkspace(record, { fileName: 'a.png', data });
    expect(requests[0].sessionId).toBe('server-id');
    expect(uploaded.path).toContain('desktop-id');
    expect(uploaded.remotePath).toBe('/workspace/uploads/a.png');
    expect(service.takeRemoteAttachmentSource(record, uploaded.path).data).toEqual(data);
    expect(service.takeRemoteAttachmentSource(record, uploaded.path)).toBeUndefined();
    expect(changes).toHaveLength(1);
  });

  it('localizes project attachments without overwriting a different file with the same name', async () => {
    const { root, workspace, record } = await fixture();
    Object.assign(record, { projectId: 'project' });
    await mkdir(path.join(workspace, 'inputs'));
    await writeFile(path.join(workspace, 'inputs', 'notes.txt'), 'old');
    const source = path.join(root, 'notes.txt');
    await writeFile(source, 'new');
    const preparation = createSessionPromptPreparation({});
    const [localized] = await preparation.localizeProjectSessionAttachments(record, [source]);
    expect(localized).toBe(path.join(workspace, 'inputs', 'notes-1.txt'));
    expect(await readFile(localized, 'utf8')).toBe('new');
    expect(await preparation.localizeProjectSessionAttachments(record, [source])).toEqual([localized]);
    expect(await readFile(path.join(workspace, 'inputs', 'notes.txt'), 'utf8')).toBe('old');
  });

  it('uses the project root task scope for a child and excludes internal checklist items', async () => {
    const { root, record } = await fixture();
    Object.assign(record, { projectId: 'project' });
    const child = { id: 'child', parentSessionId: record.id };
    const dir = path.join(root, 'tasks', 'project-project__session-desktop-id');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, '1.json'), JSON.stringify({ id: '1', subject: 'visible', status: 'pending' }));
    await writeFile(path.join(dir, '2.json'), JSON.stringify({ id: '2', subject: 'private', status: 'pending', metadata: { _internal: true } }));
    const service = createSessionTaskService({ MOSS_HOME: root, sessions: new Map([[record.id, record]]), subAgentSessions: new Map() });
    expect(service.snapshotSessionTasks(child).map(task => task.subject)).toEqual(['visible']);
  });
});

describe('extracted project assets', () => {
  it('serializes concurrent uploads and keeps both files and their index entries', async () => {
    const { root, workspace } = await fixture();
    const assetDir = workspace;
    let project = { id: 'project', updatedAt: 0, archivedAt: null };
    const index = path.join(root, 'assets.json');
    const first = path.join(root, 'a.txt');
    const second = path.join(root, 'b.txt');
    await writeFile(first, 'first');
    await writeFile(second, 'second');
    const service = createProjectAssetService({
      normalizeProjectId: (id: string) => id,
      readProject: async () => project,
      writeProject: async (next: typeof project) => { project = next; },
      getProjectDir: () => root, getProjectWorkspaceDir: () => workspace,
      getProjectAssetsDir: () => assetDir, getProjectAssetIndexPath: () => index,
      ensureProjectStructure: async () => {},
      readJsonFileAsync: async (file: string, fallback: unknown) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } },
      writeJsonFileAtomicAsync: (file: string, data: unknown) => writeFile(file, JSON.stringify(data)),
      projectRecordQueues: new Map(),
      runInKeyedQueue: async (queue: Map<string, Promise<unknown>>, id: string, operation: () => Promise<unknown>) => {
        const pending = (queue.get(id) || Promise.resolve()).catch(() => {}).then(operation);
        queue.set(id, pending);
        try { return await pending; } finally { if (queue.get(id) === pending) queue.delete(id); }
      },
      appendProjectEvent: async () => {}, invalidateProjectSessionRuntimes() {}, emitToRenderer() {},
    });
    await Promise.all([
      service.addProjectAsset('project', { sourcePath: first, fileName: 'same.txt' }),
      service.addProjectAsset('project', { sourcePath: second, fileName: 'same.txt' }),
    ]);
    expect((await readdir(assetDir)).sort()).toEqual(['same-1.txt', 'same.txt']);
    const assets = await service.listProjectAssets('project');
    expect(assets).toHaveLength(2);
    const duplicate = await service.addProjectAsset('project', { sourcePath: first });
    expect(assets.map(asset => asset.id)).toContain(duplicate.id);
    expect(await service.listProjectAssets('project')).toHaveLength(2);
  });
});
