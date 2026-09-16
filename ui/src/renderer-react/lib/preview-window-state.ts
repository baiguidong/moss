import type { PreviewOpenPayload, WorkspacePreviewData } from '@/types';

function isDirty(file: WorkspacePreviewData | null | undefined): boolean {
  return Boolean((file?.metadata as { dirty?: boolean } | undefined)?.dirty);
}

export function previewFileFromPayload(payload: PreviewOpenPayload): WorkspacePreviewData {
  if ('file' in payload) return payload.file;

  const title = String(payload.metadata?.title || payload.metadata?.fileName || '').trim();
  const content = String(payload.content || '');
  const fallback = content.slice(0, 48) || 'untitled';
  const path = `preview:${payload.contentType}:${title || fallback}`;
  return {
    path,
    relativePath: title || path,
    content,
    contentType: payload.contentType,
    language: String(payload.metadata?.language || ''),
    metadata: payload.metadata,
    size: content.length,
    truncated: false,
  };
}

export function upsertPreviewTab(
  tabs: WorkspacePreviewData[],
  incoming: WorkspacePreviewData,
): WorkspacePreviewData[] {
  const existing = tabs.find((tab) => tab.path === incoming.path);
  if (!existing) return [...tabs, incoming];
  const next = isDirty(existing) ? existing : incoming;
  return tabs.map((tab) => (tab.path === incoming.path ? next : tab));
}

export function syncPreviewTabs(
  tabs: WorkspacePreviewData[],
  incoming: WorkspacePreviewData[],
): WorkspacePreviewData[] {
  return incoming.reduce(upsertPreviewTab, tabs);
}
