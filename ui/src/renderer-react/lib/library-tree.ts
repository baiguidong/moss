import type { LibraryResource } from '@/types';

export type LibraryFileTreeNode = {
  kind: 'file';
  id: string;
  name: string;
  path: string;
  resource: LibraryResource;
};

export type LibraryDirectoryTreeNode = {
  kind: 'directory';
  id: string;
  name: string;
  path: string;
  children: LibraryTreeNode[];
  fileCount: number;
  indexedCount: number;
  errorCount: number;
};

export type LibraryTreeNode = LibraryDirectoryTreeNode | LibraryFileTreeNode;

type MutableDirectory = {
  name: string;
  path: string;
  directories: Map<string, MutableDirectory>;
  files: LibraryFileTreeNode[];
};

const ROOT_CATEGORY_ORDER = new Map([
  '个人档案',
  '财务与票据',
  '工作与项目',
  '学习与研究',
  '生活资料',
  '创作与收藏',
  '参考资料',
  '其他资料',
].map((name, index) => [name, index]));

function compareDirectories(left: MutableDirectory, right: MutableDirectory, isRoot: boolean): number {
  if (isRoot) {
    const leftOrder = ROOT_CATEGORY_ORDER.get(left.name);
    const rightOrder = ROOT_CATEGORY_ORDER.get(right.name);
    if (leftOrder !== undefined || rightOrder !== undefined) {
      return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
    }
  }
  return left.name.localeCompare(right.name, 'zh-CN', { numeric: true });
}

function pathParts(resource: LibraryResource): string[] {
  const fallbackName = `${resource.title}${resource.extension || ''}`;
  const normalized = String(resource.relativePath || resource.displayPath || fallbackName)
    .replaceAll('\\', '/')
    .replace(/^\.\//, '');
  const parts = normalized.split('/').filter((part) => part && part !== '.' && part !== '..');
  return parts.length > 0 ? parts : [fallbackName];
}

function finalizeDirectory(directory: MutableDirectory): LibraryDirectoryTreeNode {
  const children: LibraryTreeNode[] = [
    ...[...directory.directories.values()]
      .sort((left, right) => compareDirectories(left, right, directory.path === ''))
      .map(finalizeDirectory),
    ...directory.files
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true })),
  ];
  const descendants = children.reduce((summary, child) => {
    if (child.kind === 'directory') {
      summary.fileCount += child.fileCount;
      summary.indexedCount += child.indexedCount;
      summary.errorCount += child.errorCount;
    } else {
      summary.fileCount += 1;
      if (child.resource.indexStatus === 'ready') summary.indexedCount += 1;
      if (child.resource.indexStatus === 'error') summary.errorCount += 1;
    }
    return summary;
  }, { fileCount: 0, indexedCount: 0, errorCount: 0 });
  return {
    kind: 'directory',
    id: directory.path || 'library-root',
    name: directory.name,
    path: directory.path,
    children,
    ...descendants,
  };
}

export function buildLibraryResourceTree(resources: LibraryResource[]): LibraryDirectoryTreeNode {
  const root: MutableDirectory = {
    name: '',
    path: '',
    directories: new Map(),
    files: [],
  };

  for (const resource of resources) {
    const parts = pathParts(resource);
    const fileName = parts.pop()!;
    let current = root;
    for (const part of parts) {
      const nextPath = current.path ? `${current.path}/${part}` : part;
      let next = current.directories.get(part);
      if (!next) {
        next = { name: part, path: nextPath, directories: new Map(), files: [] };
        current.directories.set(part, next);
      }
      current = next;
    }
    const filePath = current.path ? `${current.path}/${fileName}` : fileName;
    current.files.push({
      kind: 'file',
      id: resource.id,
      name: fileName,
      path: filePath,
      resource,
    });
  }

  return finalizeDirectory(root);
}

export function collectLibraryDirectoryIds(root: LibraryDirectoryTreeNode): string[] {
  const ids: string[] = [];
  const visit = (node: LibraryDirectoryTreeNode) => {
    for (const child of node.children) {
      if (child.kind !== 'directory') continue;
      ids.push(child.id);
      visit(child);
    }
  };
  visit(root);
  return ids;
}
