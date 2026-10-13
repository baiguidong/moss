export type FileAttachment = { name: string; path: string };
type AttachmentHost = Pick<Window['agentDesktop']['fs'], 'getPathForFile' | 'getFileMetadata' | 'createTempFile' | 'writeFile'>;

export function mergeFileAttachments(current: FileAttachment[], incoming: FileAttachment[]): FileAttachment[] {
  const paths = new Set(current.map(file => file.path));
  return [...current, ...incoming.filter(file => {
    if (!file.path || paths.has(file.path)) return false;
    paths.add(file.path);
    return true;
  })];
}

// Native files remain references. Clipboard/browser files have no disk path,
// so materialize them once before using the same attachment pipeline.
export async function collectFileAttachments(files: readonly File[], host: AttachmentHost = window.agentDesktop.fs) {
  const attachments: FileAttachment[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      let path = host.getPathForFile(file);
      if (!path) {
        path = await host.createTempFile(file.name || 'attachment');
        if (!path || !await host.writeFile(path, Array.from(new Uint8Array(await file.arrayBuffer())))) {
          throw new Error('无法保存文件');
        }
      }
      const metadata = await host.getFileMetadata(path);
      if (!metadata || metadata.isFile === false) throw new Error('文件不存在、无法读取或是文件夹');
      attachments.push({ name: file.name || path.split(/[\\/]/).at(-1) || 'attachment', path });
    } catch (error) {
      errors.push(`${file.name || '文件'}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { attachments: mergeFileAttachments([], attachments), errors };
}
