"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { documentIpc } from "@/ipc/document.ipc";
import { OfficePreviewToolbar } from "../OfficePreviewToolbar";
import { LazyOpenFileViewer } from "./LazyOpenFileViewer";
import { PDFViewer } from "./PDFViewer";
import { parseCellRange } from "../../../../shared/document-location.mjs";
import type { OfficeViewerProps } from "./OfficeDocumentViewer";

const MAX_FALLBACK_ROWS = 500;
const MAX_FALLBACK_COLUMNS = 100;

type SheetMerge = { s?: { r?: number; c?: number }; e?: { r?: number; c?: number } };
type SheetImage = { row?: number; col?: number; src?: string; width?: number; height?: number };

function buildSheetLayout(sheet: { data?: any[][]; merges?: SheetMerge[]; images?: SheetImage[] }, focus?: { row: number; col: number }) {
  const rows = Array.isArray(sheet.data) ? sheet.data : [];
  const merges = Array.isArray(sheet.merges) ? sheet.merges : [];
  const images = Array.isArray(sheet.images) ? sheet.images : [];
  const rowStart = focus ? Math.max(0, focus.row - 5) : 0, colStart = focus ? Math.max(0, focus.col - 3) : 0;
  const rowLimit = rowStart + (focus ? 100 : MAX_FALLBACK_ROWS), colLimit = colStart + (focus ? 40 : MAX_FALLBACK_COLUMNS);
  const mergeStarts = new Map<string, { rowSpan: number; colSpan: number }>();
  const mergedCells = new Set<string>();
  let sourceColumnCount = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);

  for (const merge of merges) {
    const startRow = Math.max(0, Number(merge.s?.r) || 0);
    const startCol = Math.max(0, Number(merge.s?.c) || 0);
    const endRow = Math.max(startRow, Number(merge.e?.r) || startRow);
    const endCol = Math.max(startCol, Number(merge.e?.c) || startCol);
    sourceColumnCount = Math.max(sourceColumnCount, endCol + 1);
    if (startRow >= rowLimit || startCol >= colLimit || endRow < rowStart || endCol < colStart) continue;
    const visibleRow = Math.max(startRow, rowStart), visibleCol = Math.max(startCol, colStart);
    mergeStarts.set(`${visibleRow}:${visibleCol}`, {
      rowSpan: Math.min(endRow, rowLimit - 1) - visibleRow + 1,
      colSpan: Math.min(endCol, colLimit - 1) - visibleCol + 1,
    });
    for (let row = visibleRow; row <= Math.min(endRow, rowLimit - 1); row += 1) {
      for (let col = visibleCol; col <= Math.min(endCol, colLimit - 1); col += 1) {
        if (row !== visibleRow || col !== visibleCol) mergedCells.add(`${row}:${col}`);
      }
    }
  }

  const imagesByCell = new Map<string, SheetImage[]>();
  for (const image of images) {
    const row = Math.max(0, Number(image.row) || 0);
    const col = Math.max(0, Number(image.col) || 0);
    if (!image.src || row < rowStart || col < colStart || row >= rowLimit || col >= colLimit) continue;
    const key = `${row}:${col}`;
    const current = imagesByCell.get(key) || [];
    current.push(image);
    imagesByCell.set(key, current);
    sourceColumnCount = Math.max(sourceColumnCount, col + 1);
  }

  return {
    rows,
    rowStart, colStart,
    rowCount: Math.min(Math.max(rows.length, images.reduce((max, image) => Math.max(max, (Number(image.row) || 0) + 1), 0)), rowLimit),
    columnCount: Math.min(sourceColumnCount, colLimit),
    mergeStarts,
    mergedCells,
    imagesByCell,
    truncated: rowStart > 0 || colStart > 0 || rows.length > rowLimit || sourceColumnCount > colLimit,
  };
}

const columnLabel = (index: number): string => index < 26 ? String.fromCharCode(65 + index) : columnLabel(Math.floor(index / 26) - 1) + String.fromCharCode(65 + index % 26);

export function ExcelViewer({ filePath, fileVersion, toolbarContainer, previewPdfPath, onReady, onError, documentLocation, locationRequest, ...annotation }: OfficeViewerProps) {
  const [state, setState] = React.useState<{ key: string; pdfPath?: string; data?: any; error?: string; dataError?: string; pdfPending?: boolean; dataPending?: boolean }>();
  const [mode, setMode] = React.useState<'pages' | 'sheets'>('pages');
  const [activeSheet, setActiveSheet] = React.useState('');
  const [selectedCell, setSelectedCell] = React.useState('');
  const userSelectedMode = React.useRef(false);
  const tableRoot = React.useRef<HTMLDivElement>(null);
  const locationKey = JSON.stringify([documentLocation, locationRequest]);
  const range = documentLocation?.range ? parseCellRange(documentLocation.range) : null;
  React.useEffect(() => { if (documentLocation?.sheet) { setMode('sheets'); setActiveSheet(documentLocation.sheet); } else if (documentLocation?.page) setMode('pages'); }, [locationKey]);
  const [attempt, setAttempt] = React.useState(0);
  const key = `${filePath}:${fileVersion ?? ''}:${attempt}:${previewPdfPath || ''}`;
  React.useEffect(() => {
    let active = true;
    const convert = (to: 'excel-json' | 'libreoffice-pdf') => documentIpc.convert({ filePath, to }).catch(error => ({ result: { success: false, error: String(error.message || error) } }));
    let pdfReady = Boolean(previewPdfPath && !attempt);
    userSelectedMode.current = false;
    setSelectedCell('');
    setState({ key, pdfPath: pdfReady ? previewPdfPath : undefined, pdfPending: !pdfReady, dataPending: true });
    setMode(documentLocation?.sheet ? 'sheets' : 'pages');
    void convert('excel-json').then(workbook => {
      if (!active) return;
      setState(current => ({ ...current!, key, dataPending: false, data: workbook.result?.success ? workbook.result.data : undefined, dataError: workbook.result?.error }));
      // Keep the first usable view stable; background conversion never steals it.
      if (workbook.result?.success && !pdfReady && !userSelectedMode.current && !documentLocation?.page) setMode('sheets');
    });
    if (!pdfReady) void convert('libreoffice-pdf').then(pdf => {
      if (!active) return;
      pdfReady = Boolean(pdf.result?.success);
      setState(current => ({ ...current!, key, pdfPending: false, pdfPath: pdf.result?.success ? pdf.result.data : undefined, error: pdf.result?.error }));
    });
    return () => { active = false; };
  }, [key, filePath]);
  const excelData = state?.key === key ? state.data : undefined, pdfPath = state?.key === key ? state.pdfPath : undefined;
  React.useEffect(() => { if (excelData && (mode === 'sheets' || !pdfPath)) onReady?.(); }, [excelData, mode, pdfPath, onReady]);
  React.useEffect(() => { if (mode === 'sheets' && excelData) tableRoot.current?.querySelector('[data-citation-cell="true"]')?.scrollIntoView({ block: 'center', inline: 'nearest' }); }, [mode, activeSheet, excelData, locationKey]);
  const citationError = documentLocation?.sheet && excelData && !excelData.sheets?.some((sheet: any) => sheet.name === documentLocation.sheet) ? `引用的工作表「${documentLocation.sheet}」不存在` : '';
  if (state?.key !== key) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在渲染工作簿…</div>;
  const toolbar = <div className="flex shrink-0 items-center gap-1 border-b border-border/70 px-3 py-1 text-xs">
    <button aria-pressed={mode === 'pages'} className="rounded px-2 py-1 aria-pressed:bg-muted" onClick={() => { userSelectedMode.current = true; setMode('pages'); }}>页面版式</button>
    <button aria-pressed={mode === 'sheets'} className="rounded px-2 py-1 aria-pressed:bg-muted" onClick={() => { userSelectedMode.current = true; setMode('sheets'); }}>工作表</button>
    <OfficePreviewToolbar filePath={filePath} onRefresh={() => setAttempt(value => value + 1)} container={toolbarContainer} />
  </div>;
  if (mode === 'pages' && pdfPath) return <div className="flex h-full min-h-0 flex-col">{toolbar}<div className="min-h-0 flex-1"><PDFViewer {...annotation} documentLocation={documentLocation} locationRequest={locationRequest} sourcePath={filePath} onReady={onReady} onError={onError} filePath={pdfPath} title={filePath} /></div></div>;
  const notice = mode === 'pages' && !pdfPath ? <p role="status" className="shrink-0 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">当前显示工作表内容；{state.pdfPending ? '页面版式正在后台生成。' : `完整页面版式暂不可用。${state.error || ''}`}</p> : null;
  if (excelData?.sheets?.length) {
    const currentSheet = excelData.sheets.find((sheet: any) => sheet.name === activeSheet) || excelData.sheets[0];
    const cited = currentSheet.name === documentLocation?.sheet && range;
    const focus = cited && range.start.row < currentSheet.data.length && range.start.col < currentSheet.data.reduce((n: number, row: any[]) => Math.max(n, row?.length || 0), 0) ? range.start : undefined;
    const layout = buildSheetLayout(currentSheet, focus);
    return (
      <div className="flex h-full min-h-0 flex-col">
        {toolbar}{notice}
        {mode === 'sheets' && <p role="status" className="shrink-0 px-4 py-1 text-xs text-muted-foreground">{state.pdfPending ? '页面版式正在后台生成，可先阅读工作表。' : pdfPath ? '页面版式已就绪，可随时切换。' : ''}</p>}
        {selectedCell && <div data-cell-details className="shrink-0 border-b border-border/60 px-4 py-2 text-xs"><span className="font-medium">{currentSheet.name}!{selectedCell}</span>{currentSheet.cells?.[selectedCell]?.formula && <code className="ml-3 break-all">={currentSheet.cells[selectedCell].formula}</code>}</div>}
        {citationError && <p role="alert" className="px-4 py-2 text-xs text-destructive">{citationError}</p>}
        {cited && <p role={focus ? "status" : "alert"} className="px-4 py-2 text-xs text-muted-foreground">{currentSheet.name}!{documentLocation?.range}{!focus && " · 引用区域超出已使用范围"}</p>}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-2.5">
          {excelData.sheets.map((sheet: any) => (
            <Button
              key={sheet.name}
              variant={sheet.name === currentSheet.name ? "default" : "ghost"}
              size="sm"
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => { setActiveSheet(sheet.name); setSelectedCell(''); }}
            >
              {sheet.name}
            </Button>
          ))}
        </div>
        <div ref={tableRoot} className="min-h-0 flex-1 overflow-auto p-4">
          {layout.truncated ? (
            <div className="mb-3 text-xs text-muted-foreground">
              当前显示第 {layout.rowStart + 1}–{layout.rowCount} 行、{columnLabel(layout.colStart)}–{columnLabel(Math.max(layout.colStart, layout.columnCount - 1))} 列，完整数据保留在原文件中。
            </div>
          ) : null}
          <div className="min-w-max overflow-hidden rounded-md border border-border/70 bg-card/70">
            <table className="border-collapse text-xs">
              <thead><tr><th className="bg-muted px-2 py-1" />{Array.from({ length: Math.max(0, layout.columnCount - layout.colStart) }, (_, i) => <th key={i} className="border-r border-border/60 bg-muted px-2 py-1">{columnLabel(i + layout.colStart)}</th>)}</tr></thead>
              <tbody>
                {Array.from({ length: Math.max(0, layout.rowCount - layout.rowStart) }, (_, i) => { const rowIndex = i + layout.rowStart; return (
                  <tr key={rowIndex} className="border-b border-border/60"><th className="bg-muted px-2 py-1 font-normal">{rowIndex + 1}</th>
                    {Array.from({ length: Math.max(0, layout.columnCount - layout.colStart) }, (_, j) => {
                      const colIndex = j + layout.colStart;
                      const key = `${rowIndex}:${colIndex}`;
                      if (layout.mergedCells.has(key)) return null;
                      const merge = layout.mergeStarts.get(key);
                      const cellImages = layout.imagesByCell.get(key) || [];
                      const highlighted = Boolean(cited && rowIndex <= range.end.row && rowIndex + (merge?.rowSpan || 1) - 1 >= range.start.row && colIndex <= range.end.col && colIndex + (merge?.colSpan || 1) - 1 >= range.start.col);
                      return (
                        <td
                          key={key}
                          data-cell={`${columnLabel(colIndex)}${rowIndex + 1}`} data-citation-cell={highlighted || undefined}
                          rowSpan={merge?.rowSpan}
                          colSpan={merge?.colSpan}
                          className="min-w-[112px] border-r border-border/60 px-3 py-2 align-top data-[citation-cell=true]:bg-primary/15 data-[citation-cell=true]:outline data-[citation-cell=true]:outline-1 data-[citation-cell=true]:outline-primary"
                        >
                          <button type="button" className="w-full whitespace-pre-wrap break-words text-left focus-visible:outline focus-visible:outline-primary" aria-label={`查看 ${columnLabel(colIndex)}${rowIndex + 1}`} onClick={() => setSelectedCell(`${columnLabel(colIndex)}${rowIndex + 1}`)}>{String(currentSheet.displayData?.[rowIndex]?.[colIndex] ?? layout.rows[rowIndex]?.[colIndex] ?? "") || "\u00a0"}</button>
                          {cellImages.map((image, imageIndex) => (
                            <img
                              key={`${key}:${imageIndex}`}
                              src={image.src}
                              alt=""
                              className="mt-2 max-h-48 max-w-64 object-contain"
                              style={{
                                width: image.width ? Math.min(image.width, 256) : undefined,
                                height: image.height ? Math.min(image.height, 192) : undefined,
                              }}
                            />
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (state.dataPending || state.pdfPending) return <div className="flex h-full min-h-0 flex-col">{toolbar}<p role="status" className="p-4 text-sm text-muted-foreground">正在读取工作簿…</p></div>;
  return <div className="flex h-full min-h-0 flex-col">{toolbar}{notice}<div className="min-h-0 flex-1"><LazyOpenFileViewer filePath={filePath} fileName={filePath} capability="basic" onReady={onReady} onError={onError} /></div></div>;
}
