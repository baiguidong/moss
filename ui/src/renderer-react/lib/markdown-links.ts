import { defaultUrlTransform } from 'react-markdown';
import { parseLibraryResourceUri } from '../../library/library-resource-uri.mjs';

export function markdownUrlTransform(url: string, key: string) {
  if (key === 'href' && url.startsWith('moss-library://')) return url;
  if (/^(moss-image|moss-media|file):/i.test(url) || url.startsWith('/') || /^[A-Za-z]:[\\/]/.test(url) || /^[~～][\\/]/.test(url)) {
    return url;
  }
  return defaultUrlTransform(url);
}

type LinkHost = {
  library: Pick<Window['agentDesktop']['library'], 'openResource'>;
  shell: Pick<Window['agentDesktop']['shell'], 'openExternal'>;
};

export async function handleMarkdownLinkClick(
  event: { preventDefault(): void },
  href: string | undefined,
  host: LinkHost,
): Promise<void> {
  if (href?.startsWith('moss-library://')) {
    event.preventDefault();
    const reference = parseLibraryResourceUri(href);
    if (!reference) throw new Error('Invalid Library resource reference.');
    await host.library.openResource({ resourceId: reference.resourceId });
  } else if (href && /^https?:/i.test(href)) {
    event.preventDefault();
    await host.shell.openExternal(href);
  }
}
