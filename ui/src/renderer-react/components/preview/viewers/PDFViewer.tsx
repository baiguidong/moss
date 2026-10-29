import * as React from 'react';
import type { DocumentLocation } from '../../../../shared/document-location.mjs';

export type PDFViewerProps = {
  filePath: string; title: string; fileVersion?: number;
  resourceUri?: string; sessionId?: string; sourcePath?: string;
  documentLocation?: DocumentLocation; locationRequest?: number;
  onReady?: () => void; onError?: (message: string) => void;
};
const PDFPages = React.lazy(() => import('./PDFPages'));

export function PDFViewer(props: PDFViewerProps) {
  return <React.Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载页面预览…</div>}>
    <PDFPages key={`${props.filePath}:${props.fileVersion ?? ''}`} {...props} />
  </React.Suspense>;
}
