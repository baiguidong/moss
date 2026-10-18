import { defaultUrlTransform } from 'react-markdown';
import { isAppResourceUri } from '../../shared/app-resource-uri.mjs';
import { parseFileReference } from '../../shared/file-reference.mjs';

export function markdownUrlTransform(url: string, key: string) {
  if (key === 'href' && isAppResourceUri(url)) return url;
  if (key === 'href' && (parseFileReference(url) || url.startsWith('moss-remote-workspace://'))) return url;
  if (/^(moss-image|moss-media|file):/i.test(url) || url.startsWith('/') || /^[A-Za-z]:[\\/]/.test(url) || /^[~～][\\/]/.test(url)) {
    return url;
  }
  return defaultUrlTransform(url);
}

type LinkHost = {
  openAppResource: Window['agentDesktop']['openAppResource'];
  shell: Pick<Window['agentDesktop']['shell'], 'openExternal'>;
  presentation?: Window['agentDesktop']['presentation'];
};

export function fileLinkLabel(href: string | undefined, label: string) {
  if (!href) return null;
  const target = parseFileReference(href), displayed = parseFileReference(label);
  if (!target || !displayed || target.path !== displayed.path || !/[\\/]/.test(displayed.path)) return null;
  const name = target.path.split(/[\\/]/).filter(Boolean).at(-1) || target.path;
  return name;
}

export async function handleMarkdownLinkClick(
  event: { preventDefault(): void },
  href: string | undefined,
  host: LinkHost,
  sessionId?: string,
): Promise<void> {
  if (href && isAppResourceUri(href)) {
    event.preventDefault();
    if (typeof window !== 'undefined' && window.mossWeb && sessionId && host.presentation) {
      const result = await host.presentation.open({ sessionId, input: { items: [{ resource_uri: href }] } });
      if (!result.ok) throw new Error(result.error || 'App 文件不可用');
    } else await host.openAppResource(href);
  } else if (href && /^https?:/i.test(href)) {
    event.preventDefault();
    await host.shell.openExternal(href);
  } else if (href && (parseFileReference(href) || href.startsWith('moss-remote-workspace://'))) {
    event.preventDefault();
    if (!sessionId || !host.presentation) throw new Error('请在文件所属会话中打开此链接');
    const result = await host.presentation.open({ sessionId, input: { items: [{ path: href }] } });
    if (!result.ok) throw new Error(result.error || '文件不可用');
  }
}
