import * as React from 'react';
import { OfficeEditRequest } from '../OfficeEditRequest';
import { OfficePreviewToolbar } from '../OfficePreviewToolbar';
import { LazyOpenFileViewer } from './LazyOpenFileViewer';
import { PDFViewer, type PDFViewerProps } from './PDFViewer';

export type OfficeViewerProps = Omit<PDFViewerProps, 'title'> & { toolbarContainer?: HTMLElement | null; toolbarMenuItems?: React.ReactNode; downloadMenuItems?: React.ReactNode; onDownload?: () => void; downloadDisabled?: boolean; previewPdfPath?: string };

const MODERN_OFFICE_EXTENSIONS = new Set(['docx', 'docm', 'dotx', 'pptx', 'pptm', 'ppsx']);
function browserOfficeCapability(filePath: string): 'full' | 'basic' {
  const cleanPath = filePath.split(/[?#]/, 1)[0] || filePath;
  const extension = cleanPath.slice(cleanPath.lastIndexOf('.') + 1).toLowerCase();
  return MODERN_OFFICE_EXTENSIONS.has(extension) ? 'full' : 'basic';
}

export function OfficeDocumentViewer({ filePath, fileVersion, toolbarContainer, toolbarMenuItems, downloadMenuItems, onDownload, downloadDisabled, previewPdfPath, kind, onReady, onError, ...annotation }: OfficeViewerProps & { kind: 'word' | 'ppt' }) {
  const [controls, setControls] = React.useState<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  // Creation artifacts may already carry a reviewed, high-fidelity PDF. Normal
  // workspace files stay in the renderer and never start a local office app.
  const usePdfPreview = Boolean(previewPdfPath);
  const viewerKey = `${filePath}:${fileVersion ?? ''}:${previewPdfPath || ''}:${attempt}`;
  return <div className="flex h-full min-h-0 flex-col">
    <OfficePreviewToolbar filePath={filePath} onRefresh={() => setAttempt(value => value + 1)} container={toolbarContainer} menuItems={toolbarMenuItems} downloadMenuItems={downloadMenuItems} onDownload={onDownload} downloadDisabled={downloadDisabled}>
      {!usePdfPreview && <OfficeEditRequest target={annotation.resourceUri ? { resourceUri: annotation.resourceUri, sessionId: annotation.sessionId } : { artifactId: annotation.artifactId, revision: annotation.revision, sessionId: annotation.sessionId }} />}
      <div ref={setControls} className="flex shrink-0 items-center gap-1 empty:hidden" />
    </OfficePreviewToolbar>
    {usePdfPreview ? <div key={viewerKey} className="min-h-0 flex-1"><PDFViewer {...annotation} office presentation={kind === 'ppt'} toolbarContainer={controls} sourcePath={filePath} filePath={previewPdfPath!} title={filePath} onReady={onReady} onError={onError} /></div> : <div key={viewerKey} className="min-h-0 flex-1"><LazyOpenFileViewer filePath={filePath} fileName={filePath} capability={browserOfficeCapability(filePath)} fit="width" onReady={onReady} onError={onError} /></div>}
  </div>;
}
