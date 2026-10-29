import * as React from 'react';
import { documentIpc } from '@/ipc/document.ipc';
import { OfficePreviewToolbar } from '../OfficePreviewToolbar';
import { LazyOpenFileViewer } from './LazyOpenFileViewer';
import { PDFViewer, type PDFViewerProps } from './PDFViewer';

export type OfficeViewerProps = Omit<PDFViewerProps, 'title'> & { toolbarContainer?: HTMLElement | null; previewPdfPath?: string };
export function OfficeDocumentViewer({ filePath, fileVersion, toolbarContainer, previewPdfPath, kind, onReady, onError, ...annotation }: OfficeViewerProps & { kind: 'word' | 'ppt' }) {
  const [state, setState] = React.useState<{ key: string; path?: string; error?: string }>();
  const [attempt, setAttempt] = React.useState(0);
  const key = `${filePath}:${fileVersion ?? ''}:${attempt}:${previewPdfPath || ''}`;
  React.useEffect(() => {
    let active = true;
    if (previewPdfPath && !attempt) { setState({ key, path: previewPdfPath }); return; }
    void documentIpc.convert({ filePath, to: 'libreoffice-pdf' }).then(response => {
      if (active) setState({ key, ...(response?.result?.success ? { path: response.result.data } : { error: response?.result?.error || '无法生成页面预览' }) });
    }).catch(error => { if (active) setState({ key, error: String(error.message || error) }); });
    return () => { active = false; };
  }, [key, filePath]);
  if (state?.key !== key) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在渲染{kind === 'word' ? '文档' : '幻灯片'}页面…</div>;
  return <div className="flex h-full min-h-0 flex-col">
    <OfficePreviewToolbar filePath={filePath} onRefresh={() => setAttempt(value => value + 1)} container={toolbarContainer} />
    {state.path ? <div className="min-h-0 flex-1"><PDFViewer {...annotation} sourcePath={filePath} filePath={state.path} title={filePath} onReady={onReady} onError={onError} /></div> : <>
      <div role="status" className="shrink-0 border-b border-border px-3 py-2 text-xs text-muted-foreground">当前显示基础预览。完整页面预览需要本机 LibreOffice；安装后可刷新重试。<details className="mt-1"><summary className="cursor-pointer">查看原因</summary>{state.error}</details></div>
      <div className="min-h-0 flex-1"><LazyOpenFileViewer filePath={filePath} fileName={filePath} capability="basic" onReady={onReady} onError={onError} /></div>
    </>}
  </div>;
}
