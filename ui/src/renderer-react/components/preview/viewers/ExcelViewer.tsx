"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { documentIpc } from "@/ipc/document.ipc";
import { libreOfficeIpc } from "@/ipc/libreoffice.ipc";
import { shellIpc } from "@/ipc/shell.ipc";
import { LibreOfficeInstallPrompt } from "@/components/preview/LibreOfficeInstallPrompt";
import { PDFViewer } from "./PDFViewer";
import { UnsupportedViewer } from "./UnsupportedViewer";

const pdfCache = new Map<string, { pdfPath: string; timestamp: number }>();
const CACHE_TIMEOUT = 5 * 60 * 1000;
const WIDE_TABLE_COLUMN_THRESHOLD = 6;
const LANDSCAPE_CHAR_WIDTH = 120;
const MAX_FALLBACK_ROWS = 500;
const MAX_FALLBACK_COLUMNS = 100;

type SheetMerge = { s?: { r?: number; c?: number }; e?: { r?: number; c?: number } };
type SheetImage = { row?: number; col?: number; src?: string; width?: number; height?: number };

function buildSheetLayout(sheet: { data?: any[][]; merges?: SheetMerge[]; images?: SheetImage[] }) {
  const rows = Array.isArray(sheet.data) ? sheet.data : [];
  const merges = Array.isArray(sheet.merges) ? sheet.merges : [];
  const images = Array.isArray(sheet.images) ? sheet.images : [];
  const mergeStarts = new Map<string, { rowSpan: number; colSpan: number }>();
  const mergedCells = new Set<string>();
  let sourceColumnCount = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);

  for (const merge of merges) {
    const startRow = Math.max(0, Number(merge.s?.r) || 0);
    const startCol = Math.max(0, Number(merge.s?.c) || 0);
    const endRow = Math.max(startRow, Number(merge.e?.r) || startRow);
    const endCol = Math.max(startCol, Number(merge.e?.c) || startCol);
    sourceColumnCount = Math.max(sourceColumnCount, endCol + 1);
    if (startRow >= MAX_FALLBACK_ROWS || startCol >= MAX_FALLBACK_COLUMNS) continue;
    mergeStarts.set(`${startRow}:${startCol}`, {
      rowSpan: Math.min(endRow, MAX_FALLBACK_ROWS - 1) - startRow + 1,
      colSpan: Math.min(endCol, MAX_FALLBACK_COLUMNS - 1) - startCol + 1,
    });
    for (let row = startRow; row <= Math.min(endRow, MAX_FALLBACK_ROWS - 1); row += 1) {
      for (let col = startCol; col <= Math.min(endCol, MAX_FALLBACK_COLUMNS - 1); col += 1) {
        if (row !== startRow || col !== startCol) mergedCells.add(`${row}:${col}`);
      }
    }
  }

  const imagesByCell = new Map<string, SheetImage[]>();
  for (const image of images) {
    const row = Math.max(0, Number(image.row) || 0);
    const col = Math.max(0, Number(image.col) || 0);
    if (!image.src || row >= MAX_FALLBACK_ROWS || col >= MAX_FALLBACK_COLUMNS) continue;
    const key = `${row}:${col}`;
    const current = imagesByCell.get(key) || [];
    current.push(image);
    imagesByCell.set(key, current);
    sourceColumnCount = Math.max(sourceColumnCount, col + 1);
  }

  return {
    rows,
    rowCount: Math.min(Math.max(rows.length, images.reduce((max, image) => Math.max(max, (Number(image.row) || 0) + 1), 0)), MAX_FALLBACK_ROWS),
    columnCount: Math.min(sourceColumnCount, MAX_FALLBACK_COLUMNS),
    mergeStarts,
    mergedCells,
    imagesByCell,
    truncated: rows.length > MAX_FALLBACK_ROWS || sourceColumnCount > MAX_FALLBACK_COLUMNS,
  };
}

function estimateTableContentWidth(sheets: Array<{ data?: any[][] }>) {
  let maxEstimatedWidth = 0;
  for (const sheet of sheets) {
    const sampleRows = (sheet.data || []).slice(0, 50);
    for (const row of sampleRows) {
      if (!Array.isArray(row)) continue;
      let rowWidth = 0;
      for (const cell of row) {
        const cellStr = String(cell ?? "");
        const charWidth = [...cellStr].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x7f ? 2 : 1), 0);
        rowWidth += Math.max(charWidth, 8);
      }
      maxEstimatedWidth = Math.max(maxEstimatedWidth, rowWidth);
    }
  }
  return maxEstimatedWidth;
}

export function ExcelViewer({ filePath, fileVersion }: { filePath: string; fileVersion?: number }) {
  const [pdfPath, setPdfPath] = React.useState<string>();
  const [excelData, setExcelData] = React.useState<any | null>(null);
  const [activeSheet, setActiveSheet] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [needsInstall, setNeedsInstall] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);
  const [installPercent, setInstallPercent] = React.useState<number>();
  const [installPhase, setInstallPhase] = React.useState<string>();
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    const unsubProgress = libreOfficeIpc.onInstallProgress(({ phase, percent }) => {
      setInstalling(true);
      setInstallPhase(phase);
      if (percent != null) setInstallPercent((prev) => (prev != null ? Math.max(prev, percent) : percent));
    });
    const unsubResult = libreOfficeIpc.onInstallResult(({ success }) => {
      setInstalling(false);
      setInstallPercent(undefined);
      setInstallPhase(undefined);
      if (success) {
        setNeedsInstall(false);
        setReloadToken((n) => n + 1);
      }
    });
    return () => {
      unsubProgress();
      unsubResult();
    };
  }, []);

  const cacheKey = `${filePath}:${fileVersion ?? "unknown"}`;

  const load = React.useCallback(async (bypassCache = false) => {
    setLoading(true);
    setError(null);
    setPdfPath(undefined);
    setExcelData(null);
    try {
      const cached = pdfCache.get(cacheKey);
      if (!bypassCache && cached && Date.now() - cached.timestamp < CACHE_TIMEOUT) {
        setPdfPath(cached.pdfPath);
        return;
      }
      if (cached) pdfCache.delete(cacheKey);

      const jsonResponse = await documentIpc.convert({ filePath, to: "excel-json" });
      const workbookData = jsonResponse?.result?.success ? jsonResponse.result.data : null;
      if (workbookData?.sheets?.length) {
        setExcelData(workbookData);
        setActiveSheet(workbookData.sheets[0].name);
      }

      const maxColumns = (workbookData?.sheets || []).reduce((max: number, sheet: any) => {
        const sheetMax = (sheet.data || []).reduce((rowMax: number, row: any) => Math.max(rowMax, Array.isArray(row) ? row.length : 0), 0);
        return Math.max(max, sheetMax);
      }, 0);
      const estimatedWidth = estimateTableContentWidth(workbookData?.sheets || []);
      const isWideTable = maxColumns > WIDE_TABLE_COLUMN_THRESHOLD || estimatedWidth > LANDSCAPE_CHAR_WIDTH;
      const libreOfficeAvailable = await documentIpc.libreOffice.isAvailable();

      if (libreOfficeAvailable && !isWideTable) {
        const pdfResponse = await documentIpc.convert({ filePath, to: "libreoffice-pdf" });
        if (pdfResponse?.result?.success && pdfResponse.result.data) {
          setPdfPath(pdfResponse.result.data);
          pdfCache.set(cacheKey, { pdfPath: pdfResponse.result.data, timestamp: Date.now() });
          return;
        }
      }

      if (workbookData?.sheets?.length) {
        return;
      }

      setNeedsInstall(true);
      setError("无法使用降级解析预览该 Excel 文件。");
    } catch (err) {
      setNeedsInstall(true);
      setError(err instanceof Error ? err.message : "Excel 预览失败。");
    } finally {
      setLoading(false);
    }
  }, [cacheKey, filePath]);

  React.useEffect(() => {
    void load(false);
  }, [load, reloadToken]);

  const handleInstall = React.useCallback(async () => {
    setInstalling(true);
    await libreOfficeIpc.install();
  }, []);

  if (loading) {
    return <UnsupportedViewer title="正在加载 Excel 预览" description="正在尝试 LibreOffice 与降级解析链。" />;
  }

  if (pdfPath) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-end gap-2 border-b border-border/70 px-4 py-2.5">
          <Button variant="ghost" size="sm" className="rounded-full text-xs" onClick={() => void load(true)}>
            刷新
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full text-xs" onClick={() => void shellIpc.openFile(filePath)}>
            用系统应用打开
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <PDFViewer filePath={pdfPath} title={filePath} />
        </div>
      </div>
    );
  }

  if (excelData?.sheets?.length) {
    const currentSheet = excelData.sheets.find((sheet: any) => sheet.name === activeSheet) || excelData.sheets[0];
    const layout = buildSheetLayout(currentSheet);
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-2.5">
          {excelData.sheets.map((sheet: any) => (
            <Button
              key={sheet.name}
              variant={sheet.name === currentSheet.name ? "default" : "ghost"}
              size="sm"
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => setActiveSheet(sheet.name)}
            >
              {sheet.name}
            </Button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {layout.truncated ? (
            <div className="mb-3 text-xs text-muted-foreground">
              表格较大，当前显示前 {MAX_FALLBACK_ROWS} 行、{MAX_FALLBACK_COLUMNS} 列。
            </div>
          ) : null}
          <div className="min-w-max overflow-hidden rounded-md border border-border/70 bg-card/70">
            <table className="border-collapse text-xs">
              <tbody>
                {Array.from({ length: layout.rowCount }, (_, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-border/60">
                    {Array.from({ length: layout.columnCount }, (_, colIndex) => {
                      const key = `${rowIndex}:${colIndex}`;
                      if (layout.mergedCells.has(key)) return null;
                      const merge = layout.mergeStarts.get(key);
                      const cellImages = layout.imagesByCell.get(key) || [];
                      return (
                        <td
                          key={key}
                          rowSpan={merge?.rowSpan}
                          colSpan={merge?.colSpan}
                          className="min-w-[112px] border-r border-border/60 px-3 py-2 align-top"
                        >
                          <div className="whitespace-pre-wrap break-words">{String(layout.rows[rowIndex]?.[colIndex] ?? "")}</div>
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (needsInstall) {
    return (
      <LibreOfficeInstallPrompt
        fileType="excel"
        installing={installing}
        percent={installPercent}
        phase={installPhase}
        onInstall={handleInstall}
      />
    );
  }

  return <UnsupportedViewer title="Excel 预览失败" description={error || "无法打开该 Excel 文档。"} tone="warning" />;
}
