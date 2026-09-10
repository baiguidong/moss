import { describe, expect, test } from 'bun:test';
import { buildLibraryResourceTree, collectLibraryDirectoryIds } from '../src/renderer-react/lib/library-tree';
import type { LibraryResource } from '../src/renderer-react/types';

function resource(id: string, relativePath: string, indexStatus: LibraryResource['indexStatus']): LibraryResource {
  const name = relativePath.split('/').at(-1) || relativePath;
  return {
    id,
    sourceId: 'source-1',
    provider: 'managed-files',
    capabilities: ['list', 'search', 'read'],
    uri: `moss-library://resource/${id}`,
    title: name.replace(/\.[^.]+$/, ''),
    name,
    parentId: null,
    kind: 'file',
    displayPath: relativePath,
    relativePath,
    extension: `.${name.split('.').at(-1)}`,
    mimeType: 'text/plain',
    size: 10,
    status: indexStatus === 'error' ? 'failed' : indexStatus === 'ready' ? 'ready' : 'discovered',
    error: indexStatus === 'error' ? '解析失败' : '',
    indexStatus,
    indexError: indexStatus === 'error' ? '解析失败' : null,
    revision: 'revision-1',
    indexedRevision: indexStatus === 'ready' ? 'revision-1' : null,
    metadata: {},
    contentHash: 'hash',
    sourceSessionId: null,
    provenance: [],
    sourceName: '资料整理',
    providerKind: 'managed-files',
    scope: { kind: 'personal' },
    createdAt: 1,
    updatedAt: 1,
    indexedAt: indexStatus === 'ready' ? 1 : null,
  };
}

describe('Library resource tree', () => {
  test('groups managed files by category, subcategory, and original relative path', () => {
    const tree = buildLibraryResourceTree([
      resource('resource-1', '个人档案/简历/kown/白桂东简历.pdf', 'ready'),
      resource('resource-2', '工作与项目/部署/kown/大湾区升级.md', 'ready'),
      resource('resource-3', '工作与项目/部署/kown/fabric.md', 'error'),
    ]);

    expect(tree.fileCount).toBe(3);
    expect(tree.indexedCount).toBe(2);
    expect(tree.errorCount).toBe(1);
    expect(collectLibraryDirectoryIds(tree)).toEqual([
      '个人档案',
      '个人档案/简历',
      '个人档案/简历/kown',
      '工作与项目',
      '工作与项目/部署',
      '工作与项目/部署/kown',
    ]);
    const work = tree.children[1];
    expect(work.kind).toBe('directory');
    if (work.kind !== 'directory') throw new Error('expected directory');
    expect(work.children[0]).toMatchObject({
      kind: 'directory',
      name: '部署',
      fileCount: 2,
      indexedCount: 1,
      errorCount: 1,
    });
  });

  test('keeps a standalone file at the tree root', () => {
    const tree = buildLibraryResourceTree([
      resource('resource-1', '说明.md', 'unindexed'),
    ]);

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]).toMatchObject({ kind: 'file', name: '说明.md' });
  });
});
