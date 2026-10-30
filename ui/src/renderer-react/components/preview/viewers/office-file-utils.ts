const MODERN_OFFICE_EXTENSIONS = new Set(['docx', 'docm', 'dotx', 'pptx', 'pptm', 'ppsx']);

function basename(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || value;
}

/**
 * Extract an extension from a local path without treating # or ? in the
 * filename as URL delimiters. A filename such as `签核 #100%.docx` must still
 * be identified as a DOCX file.
 */
export function fileExtension(filePath: string): string {
  const name = basename(filePath);
  const match = name.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  return match?.[1]?.toLowerCase() || '';
}

export function browserOfficeCapability(filePath: string): 'full' | 'basic' {
  return MODERN_OFFICE_EXTENSIONS.has(fileExtension(filePath)) ? 'full' : 'basic';
}

/**
 * Open File Viewer uses fileName as both a parser hint and a download name.
 * Its extension detection follows URL semantics and truncates at # or ?, so
 * pass it a basename with those delimiters removed while keeping the real
 * extension. The source path itself remains unchanged and continues to carry
 * the original filename.
 */
export function officeParserFileName(filePath: string): string {
  const name = basename(filePath);
  const match = name.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  if (!match || match.index === undefined) return name.replace(/[?#%&]/g, '_');
  const stem = name.slice(0, match.index).replace(/[?#%&]/g, '_');
  return `${stem}.${match[1]}`;
}
