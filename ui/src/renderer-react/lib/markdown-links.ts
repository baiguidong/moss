import { defaultUrlTransform } from 'react-markdown';
import { isAppResourceUri } from '../../shared/app-resource-uri.mjs';

export function markdownUrlTransform(url: string, key: string) {
  if (key === 'href' && isAppResourceUri(url)) return url;
  if (/^(moss-image|moss-media|file):/i.test(url) || url.startsWith('/') || /^[A-Za-z]:[\\/]/.test(url) || /^[~～][\\/]/.test(url)) {
    return url;
  }
  return defaultUrlTransform(url);
}

type LinkHost = {
  openAppResource: Window['agentDesktop']['openAppResource'];
  shell: Pick<Window['agentDesktop']['shell'], 'openExternal'>;
};

export async function handleMarkdownLinkClick(
  event: { preventDefault(): void },
  href: string | undefined,
  host: LinkHost,
): Promise<void> {
  if (href && isAppResourceUri(href)) {
    event.preventDefault();
    await host.openAppResource(href);
  } else if (href && /^https?:/i.test(href)) {
    event.preventDefault();
    await host.shell.openExternal(href);
  }
}
