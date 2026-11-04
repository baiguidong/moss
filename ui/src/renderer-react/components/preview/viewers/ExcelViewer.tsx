"use client";

import * as React from "react";
import { ChevronDown, FileText, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { documentIpc } from "@/ipc/document.ipc";
import { OfficeEditRequest } from '../OfficeEditRequest';
import { OfficePreviewToolbar } from "../OfficePreviewToolbar";
import { LazyOpenFileViewer } from "./LazyOpenFileViewer";
import { PDFViewer } from "./PDFViewer";
import { SpreadsheetGrid } from "./SpreadsheetGrid";
import { parseCellRange } from "../../../../shared/document-location.mjs";
import { browserOfficeCapability, officeParserFileName } from "./office-file-utils";
import type { OfficeViewerProps } from "./OfficeDocumentViewer";

const MAX_FALLBACK_ROWS = 500;
const MAX_FALLBACK_COLUMNS = 100;
const FORMULA_BAR_PREFERENCE = 'ui.spreadsheet.formulaBar';

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

export function ExcelViewer({ filePath, fileVersion, toolbarContainer, toolbarMenuItems, downloadMenuItems, onDownload, downloadDisabled, previewPdfPath, onReady, onError, documentLocation, locationRequest, ...annotation }: OfficeViewerProps) {
  const [state, setState] = React.useState<{ key: string; pdfPath?: string; data?: any; error?: string; dataError?: string; pdfPending?: boolean; dataPending?: boolean }>();
  // Keep the established worksheet view as the initial view for ordinary
  // workbooks. The browser-native file view is an explicit additional mode.
  const [mode, setMode] = React.useState<'original' | 'sheets' | 'pages'>('sheets');
  const [pageControls, setPageControls] = React.useState<HTMLDivElement | null>(null);
  const [zoom, setZoom] = React.useState<number | 'fit'>(100);
  const [activeSheet, setActiveSheet] = React.useState('');
  const [selectedCell, setSelectedCell] = React.useState('');
  const [showFormulaBar, setShowFormulaBar] = React.useState(() => {
    try { return localStorage.getItem(FORMULA_BAR_PREFERENCE) === 'true'; } catch { return false; }
  });
  const formulaBarId = React.useId();
  React.useEffect(() => {
    try { localStorage.setItem(FORMULA_BAR_PREFERENCE, String(showFormulaBar)); } catch {}
  }, [showFormulaBar]);
  const tableRoot = React.useRef<HTMLDivElement>(null);
  const locationKey = JSON.stringify([documentLocation, locationRequest]);
  const range = documentLocation?.range ? parseCellRange(documentLocation.range) : null;
  React.useEffect(() => { if (documentLocation?.sheet) { setMode('sheets'); setActiveSheet(documentLocation.sheet); } else if (documentLocation?.page) setMode('pages'); }, [locationKey]);
  const [attempt, setAttempt] = React.useState(0);
  const key = `${filePath}:${fileVersion ?? ''}:${attempt}:${previewPdfPath || ''}`;
  React.useEffect(() => {
    let active = true;
    const pdfReady = Boolean(previewPdfPath);
    setSelectedCell('');
    setState({ key, pdfPath: pdfReady ? previewPdfPath : undefined, pdfPending: false, dataPending: true });
    setMode(documentLocation?.sheet ? 'sheets' : pdfReady ? 'pages' : 'sheets');
    void documentIpc.convert({ filePath, to: 'excel-json' }).catch(error => ({ result: { success: false, error: String(error.message || error) } })).then(workbook => {
      if (!active) return;
      setState(current => ({ ...current!, key, dataPending: false, data: workbook.result?.success ? workbook.result.data : undefined, dataError: workbook.result?.error }));
    });
    return () => { active = false; };
  }, [key, filePath]);
  const excelData = state?.key === key ? state.data : undefined, pdfPath = state?.key === key ? state.pdfPath : undefined;
  React.useEffect(() => { if (excelData && (mode === 'sheets' || !pdfPath)) onReady?.(); }, [excelData, mode, pdfPath, onReady]);
  React.useEffect(() => { if (mode === 'sheets' && excelData) tableRoot.current?.querySelector('[data-citation-cell="true"]')?.scrollIntoView({ block: 'center', inline: 'nearest' }); }, [mode, activeSheet, excelData, locationKey]);
  const citationError = documentLocation?.sheet && excelData && !excelData.sheets?.some((sheet: any) => sheet.name === documentLocation.sheet) ? `引用的工作表「${documentLocation.sheet}」不存在` : '';
  if (state?.key !== key) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在渲染工作簿…</div>;
  // Selecting page layout without a cached PDF keeps the old usable worksheet
  // fallback and explains why a rendered page view is unavailable.
  const showingSheets = mode === 'sheets' || (mode === 'pages' && !pdfPath);
  const showingPages = mode === 'pages' && Boolean(pdfPath);
  const showingOriginal = mode === 'original';
  const toolbar = <OfficePreviewToolbar filePath={filePath} onRefresh={() => setAttempt(value => value + 1)} container={toolbarContainer} menuItems={<><DropdownMenuCheckboxItem checked={showFormulaBar} onCheckedChange={setShowFormulaBar}>公式栏</DropdownMenuCheckboxItem>{toolbarMenuItems}</>} downloadMenuItems={downloadMenuItems} onDownload={onDownload} downloadDisabled={downloadDisabled}>
    {(showingSheets || showingOriginal) && <OfficeEditRequest target={annotation.resourceUri ? { resourceUri: annotation.resourceUri, sessionId: annotation.sessionId } : { artifactId: annotation.artifactId, revision: annotation.revision, sessionId: annotation.sessionId }} selection={showingSheets && selectedCell && excelData?.sheets?.length ? { kind: 'cell', sheet: (excelData.sheets.find((sheet: any) => sheet.name === activeSheet) || excelData.sheets[0]).name, range: selectedCell, selector: selectedCell, text: '', nearbyText: '', rect: { x: 0, y: 0, width: 1, height: 1 } } : undefined} selectionLabel={showingSheets ? `单元格 ${selectedCell}` : undefined} />}
    <div ref={setPageControls} className="flex shrink-0 items-center gap-1 empty:hidden" />
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 rounded-md px-2 text-xs" aria-label="预览模式" title="切换预览模式">
          <span className="office-preview-mode-label">{showingSheets ? '交互表格' : showingPages ? '页面版式' : '原始预览'}</span>
          {showingSheets ? <Table2 className="office-preview-mode-icon h-3.5 w-3.5" /> : <FileText className="office-preview-mode-icon h-3.5 w-3.5" />}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={mode} onValueChange={value => setMode(value as 'original' | 'pages' | 'sheets')}>
          <DropdownMenuRadioItem value="original">原始预览</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="sheets">交互表格</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="pages">页面版式</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    {showingSheets && <>
      <select aria-label="工作表缩放" className={`h-7 ${zoom === 'fit' ? 'w-24' : 'w-16'} shrink-0 rounded-md bg-transparent px-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`} value={zoom} onChange={event => setZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}><option value="fit">适合宽度</option>{[50, 75, 100, 125, 150, 200].map(value => <option key={value} value={value}>{value}%</option>)}</select>
      <Button variant="ghost" size="icon-sm" className="office-formula-toggle h-7 w-7 shrink-0 rounded-md font-serif italic aria-pressed:bg-muted" aria-label="公式栏" title={showFormulaBar ? '收起公式栏' : '展开公式栏'} aria-pressed={showFormulaBar} aria-expanded={showFormulaBar} aria-controls={formulaBarId} onClick={() => setShowFormulaBar(value => !value)}>ƒx</Button>
    </>}
  </OfficePreviewToolbar>;
  if (showingOriginal) return <div className="flex h-full min-h-0 flex-col">{toolbar}<div className="min-h-0 flex-1"><LazyOpenFileViewer filePath={filePath} fileName={officeParserFileName(filePath)} capability={browserOfficeCapability(filePath)} fit="width" onReady={onReady} onError={onError} /></div></div>;
  if (showingPages) return <div className="flex h-full min-h-0 flex-col">{toolbar}<div className="min-h-0 flex-1"><PDFViewer {...annotation} office toolbarContainer={pageControls} documentLocation={documentLocation} locationRequest={locationRequest} sourcePath={filePath} onReady={onReady} onError={onError} filePath={pdfPath!} title={filePath} /></div></div>;
  const notice = mode === 'pages' && !pdfPath ? <details open className="shrink-0 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground"><summary className="cursor-pointer">当前没有缓存的页面版式，显示工作表</summary><p role="status" className="pt-1">可直接使用交互表格查看内容；页面版式仅在文件已有预生成 PDF 时提供。</p></details> : null;
  if (excelData?.sheets?.length) {
    const currentSheet = excelData.sheets.find((sheet: any) => sheet.name === activeSheet) || excelData.sheets[0];
    const cited = currentSheet.name === documentLocation?.sheet && range;
    const focus = cited && range.start.row < currentSheet.data.length && range.start.col < currentSheet.data.reduce((n: number, row: any[]) => Math.max(n, row?.length || 0), 0) ? range.start : undefined;
    const layout = buildSheetLayout(currentSheet, focus);
    const selected = parseCellRange(selectedCell || 'A1')?.start;
    const selectedValue = selected ? currentSheet.data?.[selected.row]?.[selected.col] : '';
    const formula = currentSheet.cells?.[selectedCell || 'A1']?.formula;
    return <div className="flex h-full min-h-0 flex-col">
      {toolbar}{notice}
      {showFormulaBar && <div id={formulaBarId} data-cell-details className="flex h-8 shrink-0 items-center gap-3 border-b border-border/60 px-3 text-xs">
        <span className="min-w-12 max-w-36 shrink-0 truncate font-medium" title={`${currentSheet.name}!${selectedCell || 'A1'}`}>{selectedCell || 'A1'}</span>
        <span className="border-l border-border/60 pl-3 italic text-muted-foreground">ƒx</span>
        <code className="min-w-0 truncate" title={formula ? `=${formula}` : String(selectedValue ?? '')}>{formula ? `=${formula}` : String(selectedValue ?? '')}</code>
      </div>}
      {citationError && <p role="alert" className="px-4 py-2 text-xs text-destructive">{citationError}</p>}
      {cited && <p role={focus ? "status" : "alert"} className="px-4 py-2 text-xs text-muted-foreground">{currentSheet.name}!{documentLocation?.range}{!focus && " · 引用区域超出已使用范围"}</p>}
      <SpreadsheetGrid sheet={currentSheet} layout={layout} selectedCell={selectedCell} onSelectCell={setSelectedCell} citedRange={cited ? range : undefined} scrollRef={tableRoot} zoom={zoom}/>
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t border-border/70 px-3" aria-label="工作表列表">
        {excelData.sheets.map((sheet: any) => <button key={sheet.name} type="button" aria-pressed={sheet.name === currentSheet.name}
          className="h-full shrink-0 border-b-2 border-transparent px-4 text-xs text-muted-foreground aria-pressed:border-primary aria-pressed:font-medium aria-pressed:text-primary"
          onClick={() => { setActiveSheet(sheet.name); setSelectedCell(''); }}>{sheet.name}</button>)}
      </div>
    </div>;
  }

  if (state.dataPending || state.pdfPending) return <div className="flex h-full min-h-0 flex-col">{toolbar}<p role="status" className="p-4 text-sm text-muted-foreground">正在读取工作簿…</p></div>;
  return <div className="flex h-full min-h-0 flex-col">{toolbar}{notice}<div className="min-h-0 flex-1"><LazyOpenFileViewer filePath={filePath} fileName={officeParserFileName(filePath)} capability="basic" onReady={onReady} onError={onError} /></div></div>;
}
