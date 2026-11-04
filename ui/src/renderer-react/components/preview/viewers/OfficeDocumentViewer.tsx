import * as React from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { OfficeEditRequest } from '../OfficeEditRequest';
import { OfficePreviewToolbar } from '../OfficePreviewToolbar';
import { LazyOpenFileViewer } from './LazyOpenFileViewer';
import { PDFViewer, type PDFViewerProps } from './PDFViewer';
import { browserOfficeCapability, officeParserFileName } from './office-file-utils';

export type OfficeViewerProps = Omit<PDFViewerProps, 'title'> & { toolbarContainer?: HTMLElement | null; toolbarMenuItems?: React.ReactNode; downloadMenuItems?: React.ReactNode; onDownload?: () => void; downloadDisabled?: boolean; previewPdfPath?: string };

export function OfficeDocumentViewer({ filePath, fileVersion, toolbarContainer, toolbarMenuItems, downloadMenuItems, onDownload, downloadDisabled, previewPdfPath, kind, onReady, onError, ...annotation }: OfficeViewerProps & { kind: 'word' | 'ppt' }) {
  const [controls, setControls] = React.useState<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [mode, setMode] = React.useState<'original' | 'pages'>(previewPdfPath ? 'pages' : 'original');
  React.useEffect(() => { setMode(previewPdfPath ? 'pages' : 'original'); }, [filePath, previewPdfPath]);
  const viewerKey = `${filePath}:${fileVersion ?? ''}:${previewPdfPath || ''}:${attempt}:${mode}`;
  const showingPages = mode === 'pages' && Boolean(previewPdfPath);
  return <div className="flex h-full min-h-0 flex-col">
    <OfficePreviewToolbar filePath={filePath} onRefresh={() => setAttempt(value => value + 1)} container={toolbarContainer} menuItems={toolbarMenuItems} downloadMenuItems={downloadMenuItems} onDownload={onDownload} downloadDisabled={downloadDisabled}>
      {!showingPages && <OfficeEditRequest target={annotation.resourceUri ? { resourceUri: annotation.resourceUri, sessionId: annotation.sessionId } : { artifactId: annotation.artifactId, revision: annotation.revision, sessionId: annotation.sessionId }} />}
      {previewPdfPath && <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 rounded-md px-2 text-xs" aria-label="预览模式" title="切换预览模式"><span>{showingPages ? '页面版式' : '原始预览'}</span><FileText className="h-3.5 w-3.5"/><ChevronDown className="h-3 w-3"/></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end"><DropdownMenuRadioGroup value={mode} onValueChange={value => setMode(value as 'original' | 'pages')}><DropdownMenuRadioItem value="original">原始预览</DropdownMenuRadioItem><DropdownMenuRadioItem value="pages">页面版式</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuContent>
      </DropdownMenu>}
      <div ref={setControls} className="flex shrink-0 items-center gap-1 empty:hidden" />
    </OfficePreviewToolbar>
    {showingPages ? <div key={viewerKey} className="min-h-0 flex-1"><PDFViewer {...annotation} office presentation={kind === 'ppt'} toolbarContainer={controls} sourcePath={filePath} filePath={previewPdfPath!} title={filePath} onReady={onReady} onError={onError} /></div> : <div key={viewerKey} className="min-h-0 flex-1"><LazyOpenFileViewer filePath={filePath} fileName={officeParserFileName(filePath)} capability={browserOfficeCapability(filePath)} fit="width" onReady={onReady} onError={onError} /></div>}
  </div>;
}
