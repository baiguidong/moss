// Document fragments are navigation instructions, never part of a provider/file path.
// Unrecognized fragments remain literal so filenames containing # continue to work.
export function splitDocumentReference(value) {
  if (typeof value !== 'string') return { reference: value };
  const index = value.lastIndexOf('#');
  if (index < 0 || !/^(page|text|sheet|range)=/.test(value.slice(index + 1))) return { reference: value };
  const params = new URLSearchParams(value.slice(index + 1));
  const fail = () => { throw new Error('文档引用无效：使用 page/text 或 sheet/range 定位原文'); };
  const location = {};
  for (const [key, content] of params) {
    if (!['page', 'text', 'sheet', 'range', 'occurrence'].includes(key) || key in location || !content || /[\u0000-\u001f]/.test(content)) fail();
    location[key] = content;
  }
  if (location.page !== undefined) {
    if (!/^[1-9]\d{0,4}$/.test(location.page)) fail();
    location.page = Number(location.page);
  }
  if (location.text && location.text.length > 2000) fail();
  if (location.occurrence !== undefined) { if (!location.text || !/^[1-9]\d{0,4}$/.test(location.occurrence)) fail(); location.occurrence = Number(location.occurrence); }
  if (location.sheet && (location.sheet.length > 31 || /[\\/*?:\[\]]/.test(location.sheet))) fail();
  if (location.range && (!location.sheet || !parseCellRange(location.range))) fail();
  if (location.sheet && (location.page || location.text)) fail();
  return { reference: value.slice(0, index), location };
}

export function parseCellRange(value) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})(?::\$?([A-Z]{1,3})\$?([1-9]\d{0,6}))?$/i.exec(value || '');
  if (!match) return null;
  const col = text => [...text.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const start = { row: Number(match[2]) - 1, col: col(match[1]) };
  const end = { row: Number(match[4] || match[2]) - 1, col: col(match[3] || match[1]) };
  if (end.row < start.row || end.col < start.col || end.row >= 1048576 || end.col >= 16384) return null;
  return { start, end };
}

export const compactDocumentText = value => String(value || '').normalize('NFKC').replace(/\s+/gu, '');
