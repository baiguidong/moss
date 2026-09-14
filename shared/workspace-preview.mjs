import path from 'node:path';

export const MAX_WORKSPACE_TEXT_PREVIEW_BYTES = 600 * 1024;

const IMAGE_MIME_BY_EXTENSION = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
});

const WORD_MIME_BY_EXTENSION = Object.freeze({
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  dot: 'application/msword',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
});

const EXCEL_MIME_BY_EXTENSION = Object.freeze({
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xlsb: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
});

const PPT_MIME_BY_EXTENSION = Object.freeze({
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  pps: 'application/vnd.ms-powerpoint',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  odp: 'application/vnd.oasis.opendocument.presentation',
});

const CODE_EXTENSIONS = new Set([
  'astro', 'bash', 'c', 'cc', 'cjs', 'clj', 'cljs', 'cmake', 'coffee', 'cpp', 'cs',
  'css', 'dart', 'ex', 'exs', 'fish', 'fs', 'fsx', 'go', 'graphql', 'gql', 'groovy',
  'h', 'hpp', 'hs', 'ini', 'java', 'jl', 'js', 'json', 'json5', 'jsx', 'kt', 'kts',
  'less', 'lua', 'm', 'make', 'mdx', 'mjs', 'mm', 'php', 'pl', 'pm', 'proto', 'ps1',
  'py', 'r', 'rb', 'rs', 'sass', 'scala', 'scss', 'sh', 'sql', 'svelte', 'swift',
  'toml', 'ts', 'tsx', 'vue', 'xml', 'yaml', 'yml', 'zsh',
]);

const CODE_FILE_NAMES = new Set([
  'dockerfile', 'gemfile', 'makefile', 'procfile', 'rakefile', 'vagrantfile',
]);

export const BINARY_PREVIEW_CONTENT_TYPES = new Set([
  'image', 'pdf', 'word', 'excel', 'ppt',
]);

export function getWorkspaceFilePreviewInfo(targetPath) {
  const extension = path.extname(String(targetPath || '')).toLowerCase().replace(/^\./, '');
  const fileName = path.basename(String(targetPath || '')).toLowerCase();

  if (IMAGE_MIME_BY_EXTENSION[extension]) {
    return { contentType: 'image', language: 'image', mimeType: IMAGE_MIME_BY_EXTENSION[extension] };
  }
  if (extension === 'pdf') {
    return { contentType: 'pdf', language: 'pdf', mimeType: 'application/pdf' };
  }
  if (extension === 'md' || extension === 'markdown') {
    return { contentType: 'markdown', language: 'markdown', mimeType: 'text/markdown' };
  }
  if (extension === 'html' || extension === 'htm') {
    return { contentType: 'html', language: 'html', mimeType: 'text/html' };
  }
  if (extension === 'diff' || extension === 'patch') {
    return { contentType: 'diff', language: 'diff', mimeType: 'text/plain' };
  }
  if (WORD_MIME_BY_EXTENSION[extension]) {
    return { contentType: 'word', language: extension, mimeType: WORD_MIME_BY_EXTENSION[extension] };
  }
  if (EXCEL_MIME_BY_EXTENSION[extension]) {
    return { contentType: 'excel', language: extension, mimeType: EXCEL_MIME_BY_EXTENSION[extension] };
  }
  if (PPT_MIME_BY_EXTENSION[extension]) {
    return { contentType: 'ppt', language: extension, mimeType: PPT_MIME_BY_EXTENSION[extension] };
  }
  if (CODE_EXTENSIONS.has(extension) || CODE_FILE_NAMES.has(fileName)) {
    return { contentType: 'code', language: extension || fileName, mimeType: 'text/plain' };
  }
  return { contentType: 'text', language: 'text', mimeType: 'text/plain' };
}

export function isBinaryPreviewContentType(contentType) {
  return BINARY_PREVIEW_CONTENT_TYPES.has(contentType);
}

export function isLikelyBinaryBuffer(buffer) {
  if (!buffer?.length) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 64 * 1024));
  if (sample.includes(0)) return true;
  let controlBytes = 0;
  for (const byte of sample) {
    if (byte < 32 && byte !== 8 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) {
      controlBytes += 1;
    }
  }
  if (controlBytes / sample.length > 0.1) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample, {
      stream: sample.length < buffer.length,
    });
    return false;
  } catch {
    return true;
  }
}

export function decodeWorkspaceTextBuffer(buffer, truncated = false) {
  return new TextDecoder('utf-8').decode(buffer, { stream: truncated });
}
