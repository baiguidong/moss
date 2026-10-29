import { defaultUrlTransform } from 'react-markdown';
import { isAppResourceUri } from '../../shared/app-resource-uri.mjs';
import { parseFileReference } from '../../shared/file-reference.mjs';

/**
 * Markdown permits optional whitespace inside angle-bracket destinations in
 * some producers. Treat it as formatting whitespace so file/resource links
 * still resolve to the actual target.
 */
export function normalizeMarkdownHref(href: string | undefined) {
  if (typeof href !== 'string') return href;
  // react-markdown URL-encodes spaces before calling urlTransform, so the
  // same malformed destination can arrive as `%20/path%20`.
  return href.trim().replace(/^(?:(?:%20|%09))+|(?:(?:%20|%09))+$/gi, '');
}

export function markdownUrlTransform(url: string, key: string) {
  const target = key === 'href' ? normalizeMarkdownHref(url) || '' : url;
  if (key === 'href' && isAppResourceUri(target)) return target;
  if (key === 'href' && (parseFileReference(target) || target.startsWith('moss-remote-workspace://'))) return target;
  if (/^(moss-image|moss-media|file):/i.test(target) || target.startsWith('/') || /^[A-Za-z]:[\\/]/.test(target) || /^[~～][\\/]/.test(target)) {
    return target;
  }
  return defaultUrlTransform(target);
}

export function appRouteLink(href: string) {
  if (/^#\/(?:flows|runs)\/[a-zA-Z0-9_-]+(?:\?[^#]*)?$/.test(href)) return { appName: '', route: href };
  try {
    const url = new URL(href);
    if (url.protocol !== 'moss-app:' || !/^[a-z0-9][a-z0-9._-]*$/.test(url.hostname)
      || !/^\/(?:flows|runs)\/[a-zA-Z0-9_-]+$/.test(url.pathname)) return null;
    return { appName: url.hostname, route: `#${url.pathname}${url.search}` };
  } catch { return null; }
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
  const target = normalizeMarkdownHref(href);
  const appRoute = target && appRouteLink(target);
  if (appRoute) {
    event.preventDefault();
    if (typeof window === 'undefined') throw new Error('此链接只能在 Moss 中打开');
    const detail = { ...appRoute, sessionId, handled: false };
    window.dispatchEvent(new CustomEvent('moss:open-app-route', { detail }));
    if (!detail.handled) throw new Error('此会话中的 App 页面不可用');
  } else if (target && isAppResourceUri(target)) {
    event.preventDefault();
    if (sessionId && host.presentation) {
      const result = await host.presentation.open({ sessionId, input: { items: [{ resource_uri: target }] } });
      if (!result.ok) throw new Error(result.error || 'App 文件不可用');
    } else await host.openAppResource(target);
  } else if (target && /^https?:/i.test(target)) {
    event.preventDefault();
    await host.shell.openExternal(target);
  } else if (target && (parseFileReference(target) || target.startsWith('moss-remote-workspace://'))) {
    event.preventDefault();
    if (!sessionId || !host.presentation) throw new Error('请在文件所属会话中打开此链接');
    const result = await host.presentation.open({ sessionId, input: { items: [{ path: target }] } });
    if (!result.ok) throw new Error(result.error || '文件不可用');
  }
}
