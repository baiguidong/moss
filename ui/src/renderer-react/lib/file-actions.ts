import { isAppResourceUri } from '../../shared/app-resource-uri.mjs';

export function fileActionCapabilities(path: string) {
  const remote = path.startsWith('moss-remote-workspace://');
  const resource = isAppResourceUri(path);
  return { preview: true, system: !remote && !resource, reveal: !remote && !resource };
}

export async function performFileAction(path: string, action: 'preview' | 'system' | 'reveal' | 'copy', host = window.agentDesktop, sessionId?: string) {
  if (action === 'copy') return navigator.clipboard.writeText(path);
  if (!fileActionCapabilities(path)[action]) throw new Error('此文件位置不支持该操作');
  if (action === 'system') {
    const error = await host.shell.openFile(path);
    if (error) throw new Error(error);
  } else if (action === 'reveal') {
    await host.shell.showItemInFolder(path);
  } else {
    if (sessionId && host.presentation) {
      const result = await host.presentation.open({ sessionId, input: { items: [isAppResourceUri(path) ? { resource_uri: path } : { path }] } });
      if (!result.ok) throw new Error(result.error || '无法打开内容');
      return;
    }
    const file = await host.preview.readFile({ filePath: path });
    const result = await host.preview.open({ file: {
      ...file,
      metadata: { ...file.metadata, previewEditable: false, previewSaveable: false },
    } });
    if (!result.ok) throw new Error('无法打开文件预览');
  }
}
