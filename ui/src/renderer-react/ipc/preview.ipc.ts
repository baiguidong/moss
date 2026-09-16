import type { PreviewOpenPayload, WorkspacePreviewData } from '@/types';

export const previewIpc = {
  open: (payload: PreviewOpenPayload) =>
    window.agentDesktop.preview.open(payload),
  sync: (payload: { files: WorkspacePreviewData[] }) =>
    window.agentDesktop.preview.sync(payload),
  ready: () => window.agentDesktop.preview.ready(),
  close: () => window.agentDesktop.preview.close(),
  onOpen: (callback: (payload: PreviewOpenPayload) => void) =>
    window.agentDesktop.preview.onOpen(callback),
  onSync: (callback: (payload: { files: WorkspacePreviewData[] }) => void) =>
    window.agentDesktop.preview.onSync(callback),
};
