import * as React from 'react';
import './spreadsheet-grid.css';

export const spreadsheetColumnLabel = (index: number): string => index < 26 ? String.fromCharCode(65 + index) : spreadsheetColumnLabel(Math.floor(index / 26) - 1) + String.fromCharCode(65 + index % 26);
const address = (row: number, col: number) => `${spreadsheetColumnLabel(col)}${row + 1}`;

export function SpreadsheetGrid({ sheet, layout, selectedCell, onSelectCell, citedRange, scrollRef, zoom }: {
  sheet: any;
  layout: any;
  selectedCell: string;
  onSelectCell: (cell: string) => void;
  citedRange?: { start: { row: number; col: number }; end: { row: number; col: number } };
  scrollRef: React.RefObject<HTMLDivElement>;
  zoom: number | 'fit';
}) {
  const appearance = sheet.appearance || {};
  const styles = appearance.styles || [];
  const normalFont = `${styles[0]?.fontSize || '11pt'} ${styles[0]?.fontFamily || 'Arial, sans-serif'}`;
  const [digitWidth, setDigitWidth] = React.useState(7);
  const [availableWidth, setAvailableWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!scrollRef.current) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    observer.observe(scrollRef.current); return () => observer.disconnect();
  }, [scrollRef]);
  React.useLayoutEffect(() => {
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const context = document.createElement('canvas').getContext('2d');
      if (!context) return;
      context.font = normalFont;
      // Column dimensions are character units of the workbook's normal font.
      // A fixed seven-pixel conversion clips labels when that font falls back.
      setDigitWidth(Math.max(1, Math.ceil(Math.max(...'0123456789'.split('').map(digit => context.measureText(digit).width)))));
    };
    measure();
    void document.fonts.ready.then(measure);
    return () => { disposed = true; };
  }, [normalFont]);
  const rows = Array.from({ length: Math.max(0, layout.rowCount - layout.rowStart) }, (_, i) => i + layout.rowStart).filter(row => !appearance.rows?.[row]?.hidden);
  const columns = Array.from({ length: Math.max(0, layout.columnCount - layout.colStart) }, (_, i) => i + layout.colStart).filter(col => !appearance.columns?.[col]?.hidden);
  const rowHeight = (row: number) => Math.max(1, Math.min(1000, appearance.rows?.[row]?.height ?? appearance.defaultRowHeight ?? 24));
  const colWidth = (col: number) => {
    const dimension = appearance.columns?.[col], characters = dimension?.widthChars ?? appearance.defaultColumnWidthChars;
    return Math.max(1, Math.min(2000, characters == null ? dimension?.width ?? appearance.defaultColumnWidth ?? 112 : characters * digitWidth));
  };
  const top = new Map<number, number>(), left = new Map<number, number>();
  let height = 25, width = 40;
  rows.forEach(row => { top.set(row, height); height += rowHeight(row); });
  columns.forEach(col => { left.set(col, width); width += colWidth(col); });
  const freezeRows = layout.rowStart === 0 ? appearance.frozenRows || 0 : 0;
  const freezeColumns = layout.colStart === 0 ? appearance.frozenColumns || 0 : 0;

  const sourceStyle = (row: number, col: number): React.CSSProperties => {
    const index = appearance.cellStyles?.[address(row, col)] ?? appearance.rows?.[row]?.style ?? appearance.columns?.[col]?.style;
    return index ? styles[index] || {} : {};
  };
  const cellStyle = (row: number, col: number, merge: { rowSpan: number; colSpan: number } | undefined): React.CSSProperties => {
    const table = appearance.tables?.find((table: any) => row >= table.range.s.r && row <= table.range.e.r && col >= table.range.s.c && col <= table.range.e.c);
    const tableStyle: React.CSSProperties = {};
    if (table) {
      if (row < table.range.s.r + table.headerRows) Object.assign(tableStyle, { backgroundColor: table.headerColor, color: '#ffffff', fontWeight: 'bold' });
      else if (row > table.range.e.r - table.totalRows) Object.assign(tableStyle, { fontWeight: 'bold', borderTop: `2px solid ${table.borderColor}` });
      else {
        if (table.rowStripes && (row - table.range.s.r - table.headerRows) % 2 === 0 || table.columnStripes && (col - table.range.s.c) % 2 === 0) tableStyle.backgroundColor = table.stripeColor;
        tableStyle.borderBottom = `1px solid ${table.borderColor}`;
        if (table.firstColumn && col === table.range.s.c || table.lastColumn && col === table.range.e.c) tableStyle.fontWeight = 'bold';
      }
    }
    const value = sheet.data?.[row]?.[col];
    const css: React.CSSProperties = { backgroundColor: '#ffffff', textAlign: typeof value === 'number' ? 'right' : typeof value === 'boolean' ? 'center' : 'left', ...styles[0], ...tableStyle, ...sourceStyle(row, col), ...appearance.conditionalStyles?.[address(row, col)] };
    if (merge) {
      const right = sourceStyle(row, col + merge.colSpan - 1).borderRight;
      const bottom = sourceStyle(row + merge.rowSpan - 1, col).borderBottom;
      if (right) css.borderRight = right;
      if (bottom) css.borderBottom = bottom;
    }
    if (row < freezeRows || col < freezeColumns) {
      css.position = 'sticky'; css.zIndex = row < freezeRows ? col < freezeColumns ? 5 : 3 : 2;
      if (row < freezeRows) css.top = top.get(row);
      if (col < freezeColumns) css.left = left.get(col);
    }
    return css;
  };

  return <div ref={scrollRef} className="spreadsheet-scroll min-h-0 flex-1 overflow-auto" data-spreadsheet-grid>
    {layout.truncated && <div className="sticky left-0 px-3 py-1 text-xs text-slate-600">当前显示第 {layout.rowStart + 1}–{layout.rowCount} 行、{spreadsheetColumnLabel(layout.colStart)}–{spreadsheetColumnLabel(Math.max(layout.colStart, layout.columnCount - 1))} 列，完整数据保留在原文件中。</div>}
    <div style={{ zoom: zoom === 'fit' ? Math.min(1, Math.max(0.1, (availableWidth - 1) / width)) : zoom / 100, width: Math.max(width, 1), minHeight: '100%' }}>
      <table className="spreadsheet-grid" data-grid-lines={appearance.showGridLines !== false} style={{ width }}>
        <colgroup><col style={{ width: 40 }}/>{columns.map(col => <col key={col} style={{ width: colWidth(col) }}/>)}</colgroup>
        <thead><tr style={{ height: 25 }}><th className="spreadsheet-corner"/>{columns.map(col => <th key={col} style={col < freezeColumns ? { left: left.get(col), zIndex: 8 } : undefined}>{spreadsheetColumnLabel(col)}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row} style={{ height: rowHeight(row) }}>
          <th style={row < freezeRows ? { top: top.get(row), zIndex: 7 } : undefined}>{row + 1}</th>
          {columns.map(col => {
            const key = `${row}:${col}`, cell = address(row, col);
            if (layout.mergedCells.has(key)) return null;
            const merge = layout.mergeStarts.get(key), images = layout.imagesByCell.get(key) || [];
            const highlighted = Boolean(citedRange && row <= citedRange.end.row && row + (merge?.rowSpan || 1) - 1 >= citedRange.start.row && col <= citedRange.end.col && col + (merge?.colSpan || 1) - 1 >= citedRange.start.col);
            const bar = appearance.dataBars?.[cell];
            return <td key={cell} data-cell={cell} data-citation-cell={highlighted || undefined} data-selected-cell={selectedCell === cell || undefined}
              rowSpan={merge?.rowSpan} colSpan={merge?.colSpan} style={cellStyle(row, col, merge)}>
              {bar && <span data-cell-data-bar className="spreadsheet-data-bar" style={{ left: `${bar.left}%`, width: `${bar.width}%`, background: `linear-gradient(90deg, ${bar.color}, ${bar.color}22)` }}/>}
              <button type="button" aria-label={`查看 ${cell}`} onClick={() => onSelectCell(cell)} style={bar?.showValue === false ? { color: 'transparent' } : undefined}>{String(sheet.displayData?.[row]?.[col] ?? sheet.data?.[row]?.[col] ?? '') || '\u00a0'}</button>
              {images.map((image: any, i: number) => <img key={i} src={image.src} alt="" style={{ width: image.width, height: image.height, maxWidth: '100%' }}/>)}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
