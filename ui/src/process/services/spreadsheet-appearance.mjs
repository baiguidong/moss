import * as XLSX from 'xlsx-republish';
import { parseOfficeXml, xmlElements, xmlChildren, xmlChild, officeRelationships } from './office-xml.mjs';

const read = (entries, name) => entries.has(name) ? parseOfficeXml(entries.get(name)) : null;
const number = (node, name, fallback = 0) => node?.hasAttribute(name) && Number.isFinite(Number(node.getAttribute(name))) ? Number(node.getAttribute(name)) : fallback;
const enabled = (node, name) => node?.getAttribute(name) === '1' || node?.getAttribute(name) === 'true';
const flag = node => Boolean(node) && !['0', 'false'].includes(node.getAttribute('val'));
const RGB = /^[\da-f]{6}$/i;
const indexedColors = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080'];

// Excel applies tint to HSL luminance, not independently to RGB channels.
function tintColor(hex, tint) {
  const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb), d = max - min;
  const l = (max + min) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const h = !d ? 0 : max === rgb[0] ? ((rgb[1] - rgb[2]) / d + 6) % 6 : max === rgb[1] ? (rgb[2] - rgb[0]) / d + 2 : (rgb[0] - rgb[1]) / d + 4;
  const light = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const c = (1 - Math.abs(2 * light - 1)) * s, x = c * (1 - Math.abs(h % 2 - 1)), m = light - c / 2;
  const parts = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return '#' + parts.map(value => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('');
}

function colors(theme) {
  const scheme = xmlElements(theme, 'clrScheme')[0];
  const names = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  const defaults = ['FFFFFF', '000000', 'EEECE1', '1F497D', '4F81BD', 'C0504D', '9BBB59', '8064A2', '4BACC6', 'F79646', '0000FF', '800080'];
  const palette = names.map((name, i) => {
    const color = xmlChildren(xmlChild(scheme, name))[0];
    return color?.getAttribute('lastClr') || color?.getAttribute('val') || defaults[i];
  });
  const resolve = node => {
    if (!node) return undefined;
    const raw = node.getAttribute('rgb')?.slice(-6) || (node.hasAttribute('theme') ? palette[number(node, 'theme')] : indexedColors[number(node, 'indexed', -1)]);
    return RGB.test(raw || '') ? tintColor(raw, Math.max(-1, Math.min(1, number(node, 'tint')))) : undefined;
  };
  return { palette, resolve };
}

function styleReader(document, color) {
  const root = document?.documentElement;
  const fonts = xmlChildren(xmlChild(root, 'fonts'), 'font');
  const fills = xmlChildren(xmlChild(root, 'fills'), 'fill');
  const borders = xmlChildren(xmlChild(root, 'borders'), 'border');
  const bases = xmlChildren(xmlChild(root, 'cellStyleXfs'), 'xf');
  const partStyle = (font, fill, border, alignment) => {
    const css = {};
    if (font) {
      const name = xmlChild(font, 'name')?.getAttribute('val');
      const size = number(xmlChild(font, 'sz'), 'val');
      if (name) css.fontFamily = `${JSON.stringify(name)}, Arial, sans-serif`;
      if (size > 0) css.fontSize = `${Math.min(size, 409)}pt`;
      if (xmlChild(font, 'b')) css.fontWeight = flag(xmlChild(font, 'b')) ? 'bold' : 'normal';
      if (xmlChild(font, 'i')) css.fontStyle = flag(xmlChild(font, 'i')) ? 'italic' : 'normal';
      const decorations = [flag(xmlChild(font, 'u')) && 'underline', flag(xmlChild(font, 'strike')) && 'line-through'].filter(Boolean);
      if (decorations.length) css.textDecoration = decorations.join(' ');
      const value = color(xmlChild(font, 'color')); if (value) css.color = value;
    }
    const pattern = xmlChild(fill, 'patternFill');
    if (pattern && pattern.getAttribute('patternType') === 'solid') {
      const value = color(xmlChild(pattern, 'fgColor')) || color(xmlChild(pattern, 'bgColor'));
      if (value) css.backgroundColor = value;
    }
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const edge = xmlChild(border, side), kind = edge?.getAttribute('style');
      if (!kind || kind === 'none') continue;
      const width = kind === 'double' || kind === 'thick' ? 3 : kind.startsWith('medium') ? 2 : 1;
      const line = kind === 'double' ? 'double' : /dash/i.test(kind) ? 'dashed' : kind === 'dotted' ? 'dotted' : 'solid';
      css['border' + side[0].toUpperCase() + side.slice(1)] = `${width}px ${line} ${color(xmlChild(edge, 'color')) || '#000000'}`;
    }
    const horizontal = alignment?.getAttribute('horizontal'), vertical = alignment?.getAttribute('vertical');
    if (['left', 'center', 'right', 'justify'].includes(horizontal)) css.textAlign = horizontal;
    if (['top', 'center', 'bottom'].includes(vertical)) css.verticalAlign = vertical === 'center' ? 'middle' : vertical;
    if (alignment?.hasAttribute('wrapText')) css.whiteSpace = enabled(alignment, 'wrapText') ? 'pre-wrap' : 'pre';
    const indent = number(alignment, 'indent'); if (indent) css.paddingLeft = `${Math.min(indent, 20) * 3 + 2}ch`;
    return css;
  };
  const xfStyle = xf => partStyle(fonts[number(xf, 'fontId')], fills[number(xf, 'fillId')], borders[number(xf, 'borderId')], xmlChild(xf, 'alignment'));
  return {
    styles: xmlChildren(xmlChild(root, 'cellXfs'), 'xf').map(xf => ({ ...xfStyle(bases[number(xf, 'xfId')]), ...xfStyle(xf) })),
    differential: xmlChildren(xmlChild(root, 'dxfs'), 'dxf').map(dxf => partStyle(xmlChild(dxf, 'font'), xmlChild(dxf, 'fill'), xmlChild(dxf, 'border'), xmlChild(dxf, 'alignment'))),
  };
}

const range = value => {
  if (!/^\$?[A-Z]+\$?[1-9]\d*(?::\$?[A-Z]+\$?[1-9]\d*)?$/.test(value || '')) return null;
  return XLSX.utils.decode_range(value.replace(/\$/g, ''));
};
const includes = (range, cell) => range && cell.r >= range.s.r && cell.r <= range.e.r && cell.c >= range.s.c && cell.c <= range.e.c;

function conditionalFormats(document, sheet, differential, color) {
  const cellStyles = {}, dataBars = {}, stopped = new Set();
  const cells = Object.entries(sheet).filter(([address]) => /^[A-Z]+[1-9]\d*$/.test(address)).map(([address, cell]) => ({ address, cell, position: XLSX.utils.decode_cell(address) }));
  const rules = xmlElements(document, 'conditionalFormatting').flatMap(format => {
    const ranges = format.getAttribute('sqref').split(/\s+/).map(range);
    return xmlChildren(format, 'cfRule').map(rule => ({ rule, ranges }));
  }).sort((a, b) => number(a.rule, 'priority') - number(b.rule, 'priority'));
  for (const { rule, ranges } of rules) {
    const targets = cells.filter(({ address, position }) => !stopped.has(address) && ranges.some(range => includes(range, position)));
    const type = rule.getAttribute('type'), text = (rule.getAttribute('text') || '').toLowerCase();
    const dataBar = xmlChild(rule, 'dataBar');
    if (type === 'dataBar' && dataBar) {
      const values = targets.filter(({ cell }) => cell.t === 'n' && Number.isFinite(cell.v)).map(({ cell }) => cell.v);
      if (!values.length) continue;
      const min = values.reduce((a, b) => Math.min(a, b), Infinity), max = values.reduce((a, b) => Math.max(a, b), -Infinity);
      const thresholds = xmlChildren(dataBar, 'cfvo');
      const lower = thresholds[0]?.getAttribute('type') === 'num' ? number(thresholds[0], 'val') : min;
      const upper = thresholds[1]?.getAttribute('type') === 'num' ? number(thresholds[1], 'val') : max;
      const span = upper - lower || 1;
      const minLength = Math.max(0, Math.min(100, number(dataBar, 'minLength', 10)));
      const maxLength = Math.max(minLength, Math.min(100, number(dataBar, 'maxLength', 90)));
      for (const { address, cell } of targets) if (cell.t === 'n' && Number.isFinite(cell.v)) {
        // Standard OOXML bars reserve 10–90% of the cell by default, so even
        // the smallest positive value has a visible bar. Zero stays empty.
        const fraction = Math.max(0, Math.min(1, upper <= 0 ? (upper - cell.v) / span : (cell.v - lower) / span));
        let width = cell.v === 0 ? 0 : minLength + fraction * (maxLength - minLength);
        let left = upper <= 0 ? 100 - width : 0;
        if (lower < 0 && upper > 0) {
          const baseline = -lower / span * 100;
          width = Math.min(cell.v < 0 ? baseline : 100 - baseline, Math.abs(cell.v) / span * maxLength);
          left = cell.v < 0 ? baseline - width : baseline;
        }
        dataBars[address] ||= { color: color(xmlChild(dataBar, 'color')) || '#638ec6', left, width, showValue: !['0', 'false'].includes(dataBar.getAttribute('showValue')) };
      }
      continue;
    }
    const formulas = xmlChildren(rule, 'formula').map(node => node.textContent);
    for (const { address, cell } of targets) {
      const value = String(cell.v ?? '').toLowerCase();
      let matches = type === 'containsText' ? value.includes(text) : type === 'notContainsText' ? !value.includes(text)
        : type === 'beginsWith' ? value.startsWith(text) : type === 'endsWith' ? value.endsWith(text) : false;
      if (type === 'cellIs') {
        const operands = formulas.map(value => /^".*"$/.test(value) ? value.slice(1, -1).replace(/""/g, '"') : Number(value));
        const [a, b] = operands, v = cell.v;
        switch (rule.getAttribute('operator')) {
          case 'equal': matches = v === a; break;
          case 'notEqual': matches = v !== a; break;
          case 'greaterThan': matches = typeof v === 'number' && v > a; break;
          case 'lessThan': matches = typeof v === 'number' && v < a; break;
          case 'greaterThanOrEqual': matches = typeof v === 'number' && v >= a; break;
          case 'lessThanOrEqual': matches = typeof v === 'number' && v <= a; break;
          case 'between': matches = typeof v === 'number' && v >= a && v <= b; break;
          case 'notBetween': matches = typeof v === 'number' && (v < a || v > b); break;
        }
      }
      if (!matches) continue;
      cellStyles[address] = { ...differential[number(rule, 'dxfId', -1)], ...cellStyles[address] };
      if (enabled(rule, 'stopIfTrue')) stopped.add(address);
    }
  }
  return { conditionalStyles: cellStyles, dataBars };
}

export function readSpreadsheetAppearance(entries, workbook) {
  const document = read(entries, 'xl/workbook.xml');
  if (!document) return {};
  const relationships = officeRelationships(entries, 'xl/workbook.xml');
  const part = type => Array.from(relationships.values()).find(rel => rel.type?.endsWith('/' + type))?.path;
  const { palette, resolve: color } = colors(read(entries, part('theme') || 'xl/theme/theme1.xml'));
  const { styles, differential } = styleReader(read(entries, part('styles') || 'xl/styles.xml'), color);
  const result = {};
  for (const node of xmlElements(document, 'sheet')) {
    const name = node.getAttribute('name'), sheet = workbook.Sheets[name];
    const sheetPath = relationships.get(node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'))?.path;
    const xml = read(entries, sheetPath);
    if (!xml || !sheet) continue;
    const view = xmlElements(xml, 'sheetView')[0], pane = xmlChild(view, 'pane');
    const defaults = xmlElements(xml, 'sheetFormatPr')[0];
    const appearance = { styles, cellStyles: {}, columns: {}, rows: {}, tables: [],
      defaultRowHeight: number(defaults, 'defaultRowHeight', 15) * 4 / 3,
      defaultColumnWidth: number(defaults, 'defaultColWidth', 9.14) * 7,
      defaultColumnWidthChars: number(defaults, 'defaultColWidth', 9.14),
      showGridLines: view?.getAttribute('showGridLines') !== '0',
      frozenRows: ['frozen', 'frozenSplit'].includes(pane?.getAttribute('state')) ? number(pane, 'ySplit') : 0,
      frozenColumns: ['frozen', 'frozenSplit'].includes(pane?.getAttribute('state')) ? number(pane, 'xSplit') : 0,
      ...conditionalFormats(xml, sheet, differential, color),
    };
    for (const cell of xmlElements(xml, 'c')) if (cell.hasAttribute('s')) appearance.cellStyles[cell.getAttribute('r')] = number(cell, 's');
    for (const row of xmlElements(xml, 'row')) appearance.rows[number(row, 'r') - 1] = { height: number(row, 'ht', appearance.defaultRowHeight * 3 / 4) * 4 / 3, hidden: enabled(row, 'hidden'), style: row.hasAttribute('s') ? number(row, 's') : undefined };
    for (const col of xmlElements(xml, 'col')) {
      for (let i = Math.max(0, number(col, 'min') - 1); i < Math.min(16384, number(col, 'max')); i++) appearance.columns[i] = { width: Math.max(0, number(col, 'width', 9.14) * 7), widthChars: Math.max(0, number(col, 'width', 9.14)), hidden: enabled(col, 'hidden'), style: col.hasAttribute('style') ? number(col, 'style') : undefined };
    }
    const sheetRels = officeRelationships(entries, sheetPath);
    for (const tablePart of xmlElements(xml, 'tablePart')) {
      const target = sheetRels.get(tablePart.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'))?.path;
      const table = read(entries, target)?.documentElement, style = xmlChild(table, 'tableStyleInfo');
      const tableRange = range(table?.getAttribute('ref'));
      if (!tableRange) continue;
      const styleName = style?.getAttribute('name') || '';
      const index = Number(styleName.match(/\d+$/)?.[0] || 2);
      const accent = palette[4 + ((index - 2 + 6) % 6)];
      appearance.tables.push({ range: tableRange, headerRows: number(table, 'headerRowCount', 1), totalRows: number(table, 'totalsRowCount'),
        rowStripes: enabled(style, 'showRowStripes'), columnStripes: enabled(style, 'showColumnStripes'),
        firstColumn: enabled(style, 'showFirstColumn'), lastColumn: enabled(style, 'showLastColumn'),
        headerColor: '#' + accent, stripeColor: tintColor(accent, 0.8), borderColor: tintColor(accent, 0.4),
      });
    }
    result[name] = appearance;
  }
  return result;
}
