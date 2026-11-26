"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { documentIpc } from "@/ipc/document.ipc";
import { appRouteLink, spreadsheetEditorHref } from "@/lib/markdown-links";
import { EmbeddedAppView } from "@/components/embedded-app-view";
import { setAppViewGuard } from "@/lib/app-view-guard";
import { OfficeEditRequest } from '../OfficeEditRequest';
import { OfficePreviewToolbar } from "../OfficePreviewToolbar";
import { LazyOpenFileViewer } from "./LazyOpenFileViewer";
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

export function ExcelViewer({ filePath, fileVersion, toolbarContainer, toolbarMenuItems, downloadMenuItems, onDownload, downloadDisabled, onReady, onError, documentLocation, locationRequest, ...annotation }: OfficeViewerProps) {
  const [state, setState] = React.useState<{ key: string; data?: any }>();
  const [previewMode, setPreviewMode] = React.useState<'sheets' | 'original'>('original');
  const originalRoot = React.useRef<HTMLDivElement>(null);
  const [originalSheets, setOriginalSheets] = React.useState<string[]>([]);
  const showingOriginal = previewMode === 'original';
  const [zoom, setZoom] = React.useState<number | 'fit'>(100);
  const [activeSheet, setActiveSheet] = React.useState('');
  const [selectedCell, setSelectedCell] = React.useState('');
  const editorHref = spreadsheetEditorHref(annotation.resourceUri, annotation.sessionId);
  const [editing, setEditing] = React.useState('');
  const [returnCell, setReturnCell] = React.useState<{ sheet?: string; cell?: string }>();
  React.useEffect(() => () => { if (editing) setAppViewGuard(null); }, [editing, editorHref]);
  React.useEffect(() => { setEditing(''); }, [editorHref]);
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
  React.useEffect(() => {
    setPreviewMode(documentLocation?.sheet ? 'sheets' : 'original');
    setActiveSheet(documentLocation?.sheet || '');
  }, [filePath, locationKey]);
  const [attempt, setAttempt] = React.useState(0);
  const key = `${filePath}:${fileVersion ?? ''}:${attempt}`;
  React.useEffect(() => {
    let active = true;
    void documentIpc.convert({ filePath, to: 'excel-json' }).then(workbook => {
      if (!active) return;
      setState({ key, data: workbook.result?.success ? workbook.result.data : undefined });
    }).catch(() => {
      if (active) setState({ key });
    });
    return () => { active = false; };
  }, [key, filePath]);
  React.useEffect(() => {
    setSelectedCell('');
    setReturnCell(undefined);
  }, [filePath]);
  const workbook = state?.key === key ? state : undefined;
  const excelData = workbook?.data;
  const showingSheets = !showingOriginal && Boolean(excelData?.sheets?.length);
  React.useEffect(() => { if (showingSheets) onReady?.(); }, [showingSheets, excelData, onReady]);
  React.useEffect(() => { if (showingSheets) tableRoot.current?.querySelector('[data-citation-cell="true"]')?.scrollIntoView({ block: 'center', inline: 'nearest' }); }, [showingSheets, activeSheet, excelData, locationKey]);
  React.useEffect(() => {
    const cell = returnCell?.cell;
    if (!editing && showingSheets && cell && returnCell.sheet === activeSheet) {
      tableRoot.current?.querySelector(`[data-cell="${cell}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [editing, showingSheets, excelData, activeSheet, returnCell]);
  const citationError = documentLocation?.sheet && excelData && !excelData.sheets?.some((sheet: any) => sheet.name === documentLocation.sheet) ? `引用的工作表「${documentLocation.sheet}」不存在` : '';
  if (editing && editorHref) return <div className="h-full min-h-0 flex-1" data-spreadsheet-editor>
    <EmbeddedAppView appName="moss.spreadsheets" route={editing} sessionId={annotation.sessionId} compact onViewState={view => {
      setAppViewGuard(view.returnToPreview ? null : view);
      if (!view.returnToPreview) return;
      setPreviewMode(view.previewMode || 'original');
      if (view.sheet) setActiveSheet(view.sheet);
      if (view.cell) setSelectedCell(view.cell);
      setReturnCell({ sheet: view.sheet, cell: view.cell });
      if (view.saved) setAttempt(value => value + 1);
      setEditing('');
    }} />
  </div>;
  const originalTabs = () => Array.from(originalRoot.current?.querySelectorAll<HTMLButtonElement>('.ofv-tabs [role="tab"]') || []);
  const sheetTabs = (names: string[]) => names.length > 0 && <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t border-border/70 px-3" aria-label="工作表列表">
    {names.map(name => <button key={name} type="button" aria-pressed={name === (names.includes(activeSheet) ? activeSheet : names[0])}
      className="h-full shrink-0 whitespace-nowrap border-b-2 border-transparent px-4 text-xs text-muted-foreground aria-pressed:border-primary aria-pressed:font-medium aria-pressed:text-primary"
      onClick={() => {
        setActiveSheet(name);
        setSelectedCell('');
        originalTabs().find(tab => tab.title === name)?.click();
      }}>{name}</button>)}
  </div>;
  const toolbar = <OfficePreviewToolbar filePath={filePath} onRefresh={() => setAttempt(value => value + 1)} container={toolbarContainer} menuItems={<>
    {showingSheets && <DropdownMenuCheckboxItem checked={showFormulaBar} onCheckedChange={setShowFormulaBar}>公式栏</DropdownMenuCheckboxItem>}
    {toolbarMenuItems}
  </>} downloadMenuItems={downloadMenuItems} onDownload={onDownload} downloadDisabled={downloadDisabled}>
    <select aria-label="工作簿模式" className="h-7 shrink-0 rounded-md border border-border bg-background px-2 text-xs" value={previewMode}
      onChange={event => {
        const mode = event.target.value;
        if (mode === 'original' || mode === 'sheets') { setPreviewMode(mode); return; }
        if (!editorHref) return;
        const url = new URL(editorHref);
        url.searchParams.set('inline', '1');
        const sheet = activeSheet || excelData?.sheets?.[0]?.name;
        if (sheet) url.searchParams.set('sheet', sheet);
        if (selectedCell) url.searchParams.set('cell', selectedCell);
        const route = appRouteLink(url.href);
        if (route) setEditing(route.route);
      }}>
      <option value="original">原始预览</option>
      <option value="sheets">工作表视图</option>
      {editorHref && <option value="edit">编辑工作簿</option>}
    </select>
    <OfficeEditRequest target={annotation.resourceUri ? { resourceUri: annotation.resourceUri, sessionId: annotation.sessionId } : { artifactId: annotation.artifactId, revision: annotation.revision, sessionId: annotation.sessionId }} selection={showingSheets && selectedCell && excelData?.sheets?.length ? { kind: 'cell', sheet: (excelData.sheets.find((sheet: any) => sheet.name === activeSheet) || excelData.sheets[0]).name, range: selectedCell, selector: selectedCell, text: '', nearbyText: '', rect: { x: 0, y: 0, width: 1, height: 1 } } : undefined} selectionLabel={showingSheets ? `单元格 ${selectedCell}` : undefined} />
    {showingSheets && <>
      <select aria-label="工作表缩放" className={`h-7 ${zoom === 'fit' ? 'w-24' : 'w-16'} shrink-0 rounded-md bg-transparent px-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`} value={zoom} onChange={event => setZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}><option value="fit">适合宽度</option>{[50, 75, 100, 125, 150, 200].map(value => <option key={value} value={value}>{value}%</option>)}</select>
      <Button variant="ghost" size="icon-sm" className="office-formula-toggle h-7 w-7 shrink-0 rounded-md font-serif italic aria-pressed:bg-muted" aria-label="公式栏" title={showFormulaBar ? '收起公式栏' : '展开公式栏'} aria-pressed={showFormulaBar} aria-expanded={showFormulaBar} aria-controls={formulaBarId} onClick={() => setShowFormulaBar(value => !value)}>ƒx</Button>
    </>}
  </OfficePreviewToolbar>;
  if (showingSheets) {
    const currentSheet = excelData.sheets.find((sheet: any) => sheet.name === activeSheet) || excelData.sheets[0];
    const cited = currentSheet.name === documentLocation?.sheet && range;
    const focus = cited && range.start.row < currentSheet.data.length && range.start.col < currentSheet.data.reduce((n: number, row: any[]) => Math.max(n, row?.length || 0), 0) ? range.start : undefined;
    const layout = buildSheetLayout(currentSheet, focus);
    const selected = parseCellRange(selectedCell || 'A1')?.start;
    const selectedValue = selected ? currentSheet.data?.[selected.row]?.[selected.col] : '';
    const formula = currentSheet.cells?.[selectedCell || 'A1']?.formula;
    return <div className="flex h-full min-h-0 flex-col">
      {toolbar}
      {showFormulaBar && <div id={formulaBarId} data-cell-details className="flex h-8 shrink-0 items-center gap-3 border-b border-border/60 px-3 text-xs">
        <span className="min-w-12 max-w-36 shrink-0 truncate font-medium" title={`${currentSheet.name}!${selectedCell || 'A1'}`}>{selectedCell || 'A1'}</span>
        <span className="border-l border-border/60 pl-3 italic text-muted-foreground">ƒx</span>
        <code className="min-w-0 truncate" title={formula ? `=${formula}` : String(selectedValue ?? '')}>{formula ? `=${formula}` : String(selectedValue ?? '')}</code>
      </div>}
      {citationError && <p role="alert" className="px-4 py-2 text-xs text-destructive">{citationError}</p>}
      {cited && <p role={focus ? "status" : "alert"} className="px-4 py-2 text-xs text-muted-foreground">{currentSheet.name}!{documentLocation?.range}{!focus && " · 引用区域超出已使用范围"}</p>}
      <SpreadsheetGrid sheet={currentSheet} layout={layout} selectedCell={selectedCell} onSelectCell={setSelectedCell} citedRange={cited ? range : undefined} scrollRef={tableRoot} zoom={zoom}/>
      {sheetTabs(excelData.sheets.map((sheet: { name: string }) => sheet.name))}
    </div>;
  }

  if (!showingOriginal && !workbook) return <div className="flex h-full min-h-0 flex-col">{toolbar}<p role="status" className="p-4 text-sm text-muted-foreground">正在读取工作簿…</p></div>;
  return <div className="flex h-full min-h-0 flex-col">{toolbar}
    <div ref={originalRoot} className="excel-original-preview min-h-0 flex-1">
      <LazyOpenFileViewer key={key} filePath={filePath} fileName={officeParserFileName(filePath)} capability={browserOfficeCapability(filePath)} fit="width"
        onReady={() => {
          const tabs = originalTabs();
          setOriginalSheets(tabs.map(tab => tab.title));
          const selected = tabs.find(tab => tab.title === activeSheet);
          if (selected && selected.getAttribute('aria-selected') !== 'true') selected.click();
          onReady?.();
        }} onError={onError} />
    </div>
    {sheetTabs(originalSheets)}
  </div>;
}
