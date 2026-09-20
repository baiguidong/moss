import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createMemoryCatalog,
  parseMemoryDocumentHead,
  parseMemoryIndexPaths,
} from '../src/memory-catalog.mjs';

let tempDir = '';

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-memory-catalog-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('memory catalog', () => {
  it('parses typed memory metadata without exposing frontmatter as the title', () => {
    expect(parseMemoryDocumentHead([
      '---',
      'name: Preferred collaboration style',
      'description: Keep answers concise.',
      'type: feedback',
      '---',
      '# Internal heading',
    ].join('\n'), 'preferences.md')).toEqual({
      title: 'Preferred collaboration style',
      description: 'Keep answers concise.',
      type: 'feedback',
      isIndex: false,
    });
  });

  it('parses active memory paths from the MEMORY index', () => {
    expect(Array.from(parseMemoryIndexPaths([
      '- [Preference](preference.md) — active',
      '- [Nested](<topics/nested.md>)',
      '- [Titled](./with-title.md "More detail")',
      '- [External](https://example.com/memory.md)',
    ].join('\n')))).toEqual([
      'preference.md',
      'topics/nested.md',
      'with-title.md',
    ]);
  });

  it('catalogs global, project, and local session memory by their real scopes', async () => {
    await fs.mkdir(path.join(tempDir, 'memory'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'memory', 'MEMORY.md'), '- [Preference](preference.md)');
    await fs.writeFile(path.join(tempDir, 'memory', 'preference.md'), [
      '---',
      'name: Answer style',
      'description: Preferred response format',
      'type: feedback',
      '---',
      'Keep answers concise.',
    ].join('\n'));
    await fs.writeFile(path.join(tempDir, 'memory', 'stale.md'), [
      '---',
      'name: Old task state',
      'description: No longer indexed',
      'type: project',
      '---',
      'Historical details.',
    ].join('\n'));

    const projectId = 'project-1';
    const projectMemoryDir = path.join(tempDir, 'projects', projectId, 'memory');
    await fs.mkdir(path.join(projectMemoryDir, 'sessions'), { recursive: true });
    await fs.writeFile(path.join(projectMemoryDir, 'overview.md'), '# 项目记忆\n\n当前结论');
    await fs.writeFile(path.join(projectMemoryDir, 'sessions', 'session-1.md'), '# 项目会话总结');

    const engineDir = path.join(tempDir, 'sessions', 'session-1', 'runtime', 'engine', 'engine-1');
    await fs.mkdir(path.join(engineDir, 'session-memory'), { recursive: true });
    await fs.writeFile(path.join(engineDir, 'session-memory', 'summary.md'), '# 会话摘要\n\n正在处理');

    const sessions = [{
      id: 'session-1',
      sessionId: 'engine-1',
      title: '设计记忆中心',
      agentMode: 'local',
      projectId,
      projectName: 'Moss',
      projectConclusion: '已完成设计',
      createdAt: 1,
      updatedAt: 2,
      busy: false,
    }];
    const service = createMemoryCatalog({
      mossHome: tempDir,
      listProjects: () => [{ id: projectId, name: 'Moss', updatedAt: 2 }],
      getProjectMemory: async () => ({
        version: 3,
        updatedAt: 3,
        finalizedSessionCount: 1,
        overview: '# 项目记忆\n\n当前结论',
      }),
      listSessions: () => sessions,
    });

    const catalog = await service.getCatalog();
    expect(catalog.global.files.map((entry) => entry.title)).toEqual([
      '记忆索引',
      'Answer style',
      'Old task state',
    ]);
    expect(catalog.global.files.map((entry) => entry.indexed)).toEqual([true, true, false]);
    expect(catalog.projects[0]).toMatchObject({
      id: projectId,
      name: 'Moss',
      finalizedSessionCount: 1,
      hasOverview: true,
    });
    expect(catalog.projects[0].history[0]).toMatchObject({
      sessionId: 'session-1',
      title: '设计记忆中心',
    });
    expect(catalog.sessions[0]).toMatchObject({
      id: 'session-1',
      hasSummary: true,
      projectName: 'Moss',
    });
    await expect(service.readEntry({ scope: 'global', path: 'preference.md' }))
      .resolves.toMatchObject({ content: expect.stringContaining('Keep answers concise.') });
    await expect(service.readEntry({ scope: 'project', projectId, kind: 'overview' }))
      .resolves.toMatchObject({ content: expect.stringContaining('当前结论') });
    await expect(service.readEntry({ scope: 'project', projectId, kind: 'history', sessionId: 'session-1' }))
      .resolves.toMatchObject({ content: expect.stringContaining('项目会话总结') });
    await expect(service.readEntry({ scope: 'session', sessionId: 'session-1' }))
      .resolves.toMatchObject({ content: expect.stringContaining('正在处理') });
  });

  it('rejects traversal and does not expose remote session storage', async () => {
    const sessions = [{
      id: 'remote-1',
      sessionId: 'remote-engine',
      title: '远程会话',
      agentMode: 'remote-direct',
      createdAt: 1,
      updatedAt: 2,
      busy: false,
    }];
    const service = createMemoryCatalog({
      mossHome: tempDir,
      listProjects: () => [],
      getProjectMemory: async () => ({}),
      listSessions: () => sessions,
    });

    await expect(service.readEntry({ scope: 'global', path: '../secret.md' })).rejects.toThrow('Invalid memory path');
    await expect(service.readEntry({ scope: 'session', sessionId: 'remote-1' })).rejects.toThrow('尚未同步到本机');
  });

  it('rejects a global-memory symlink that escapes the memory root', async () => {
    if (process.platform === 'win32') return;
    const memoryDir = path.join(tempDir, 'memory');
    const outside = path.join(tempDir, 'outside.md');
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(outside, 'private');
    await fs.symlink(outside, path.join(memoryDir, 'linked.md'));
    const service = createMemoryCatalog({
      mossHome: tempDir,
      listProjects: () => [],
      getProjectMemory: async () => ({}),
      listSessions: () => [],
    });

    await expect(service.readEntry({ scope: 'global', path: 'linked.md' })).rejects.toThrow('超出允许范围');
  });

  it('merges Moss Server global memory and resolves remote session summaries', async () => {
    const remoteReads: string[] = [];
    const service = createMemoryCatalog({
      mossHome: tempDir,
      listProjects: () => [],
      getProjectMemory: async () => ({}),
      listSessions: () => [{
        id: 'desktop-session-1',
        sessionId: 'server-session-1',
        title: '云端会话',
        agentMode: 'remote-direct',
        createdAt: 1,
        updatedAt: 2,
        busy: false,
      }],
      getRemoteMemoryCatalog: async () => ({
        global: {
          rootLabel: 'Moss Server / memory',
          files: [{
            id: 'MEMORY.md',
            path: 'MEMORY.md',
            title: '记忆索引',
            description: '',
            type: 'index',
            isIndex: true,
            indexed: true,
            bytes: 20,
            updatedAt: 10,
            readable: true,
          }],
        },
        sessions: [{
          sessionId: 'server-session-1',
          exists: true,
          bytes: 30,
          updatedAt: 11,
          readable: true,
        }],
      }),
      readRemoteGlobalMemory: async (filePath: string) => {
        remoteReads.push(`global:${filePath}`);
        return { content: '# Cloud memory', bytes: 14, updatedAt: 10, readable: true };
      },
      readRemoteSessionMemory: async (sessionId: string) => {
        remoteReads.push(`session:${sessionId}`);
        return { exists: true, content: '# Cloud session', bytes: 15, updatedAt: 11, readable: true };
      },
    });

    const catalog = await service.getCatalog();
    expect(catalog.global.files).toContainEqual(expect.objectContaining({
      id: 'remote:MEMORY.md',
      source: 'remote',
    }));
    expect(catalog.sessions[0]).toMatchObject({
      id: 'desktop-session-1',
      hasSummary: true,
      summaryUpdatedAt: 11,
    });
    await expect(service.readEntry({ scope: 'global', source: 'remote', path: 'MEMORY.md' }))
      .resolves.toMatchObject({ content: '# Cloud memory' });
    await expect(service.readEntry({ scope: 'session', sessionId: 'desktop-session-1' }))
      .resolves.toMatchObject({ content: '# Cloud session' });
    expect(remoteReads).toEqual(['global:MEMORY.md', 'session:server-session-1']);
  });
});
