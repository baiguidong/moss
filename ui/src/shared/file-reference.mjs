// Syntax only. Existence, platform and authorization are checked by the owning host.
export function parseFileReference(reference) {
  if (typeof reference !== 'string' || !reference || /[\u0000\r\n]/.test(reference)) return null;
  let value = reference.trim();
  if (value.startsWith('#')) return null;
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1);
  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      value = decodeURIComponent(url.pathname) + url.hash;
      if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
      if (url.hostname && url.hostname !== 'localhost') value = '//' + url.hostname + value;
    } catch { return null; }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[A-Za-z]:[\\/]/.test(value) && !/:\d+(?::\d+)?$/.test(value)) return null;
  if (!/^file:/i.test(reference) && /%[a-f\d]{2}/i.test(value)) { try { value = decodeURIComponent(value); } catch { return null; } }
  if (/^(?:javascript|vbscript|data|https?|mailto|tel|blob|about):/i.test(value) || /^[a-z][a-z\d+.-]*:\/\//i.test(value)) return null;
  const position = /(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?)$/.exec(value);
  const filePath = position ? value.slice(0, position.index) : value;
  if (!filePath || /[\u0000\r\n]/.test(filePath)) return null;
  const line = position ? Number(position[1] || position[3]) : undefined;
  const column = position && (position[2] || position[4]) ? Number(position[2] || position[4]) : undefined;
  if ((line !== undefined && (!Number.isSafeInteger(line) || line < 1)) || (column !== undefined && (!Number.isSafeInteger(column) || column < 1))) return null;
  return { path: filePath, ...(line ? { line } : {}), ...(column ? { column } : {}) };
}

export function isInlineFileReference(value) {
  return typeof value === 'string' && !/[\s;|`$<>]/.test(value) && (/[\\/]/.test(value) || /\.[A-Za-z0-9_-]+(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)?$/.test(value)) && Boolean(parseFileReference(value));
}
