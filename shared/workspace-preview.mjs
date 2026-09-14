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
});

const OFV_IMAGE_MIME_BY_EXTENSION = Object.freeze({
  jfif: 'image/jpeg',
  pjpe: 'image/pjpeg',
  pjpeg: 'image/pjpeg',
  cur: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  apng: 'image/apng',
  heic: 'image/heic',
  heif: 'image/heif',
  jxl: 'image/jxl',
});

const OFV_VIDEO_MIME_BY_EXTENSION = Object.freeze({
  mp4: 'video/mp4',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  mpe: 'video/mpeg',
  mpv: 'video/mpv',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  flv: 'video/x-flv',
  wmv: 'video/x-ms-wmv',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  m2ts: 'video/mp2t',
  m3u8: 'application/vnd.apple.mpegurl',
});

const OFV_COMPATIBILITY_VIDEO_EXTENSIONS = new Set([
  'mpg', 'mpeg', 'mpe', 'mpv', 'avi', 'mkv', 'flv', 'wmv', '3gp', '3g2', 'm2ts',
]);

const OFV_AUDIO_MIME_BY_EXTENSION = Object.freeze({
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  aifc: 'audio/aiff',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  opus: 'audio/opus',
  weba: 'audio/webm',
  amr: 'audio/amr',
  mid: 'audio/midi',
  midi: 'audio/midi',
  caf: 'audio/x-caf',
  au: 'audio/basic',
  snd: 'audio/basic',
  wma: 'audio/x-ms-wma',
});

const OFV_RICH_TEXT_MIME_BY_EXTENSION = Object.freeze({
  lrc: 'text/plain',
  ipynb: 'application/x-ipynb+json',
  mmd: 'text/vnd.mermaid',
  mermaid: 'text/vnd.mermaid',
});

const OFV_BINARY_FORMATS = Object.freeze({
  ebook: {
    capability: 'full',
    formats: { epub: 'application/epub+zip' },
  },
  'fixed-document': {
    capability: 'basic',
    formats: {
      xps: 'application/vnd.ms-xpsdocument',
      oxps: 'application/oxps',
      ofd: 'application/ofd',
    },
  },
  archive: {
    capability: 'full',
    formats: {
      zip: 'application/zip', tar: 'application/x-tar', gz: 'application/gzip',
      tgz: 'application/gzip', bz2: 'application/x-bzip2', xz: 'application/x-xz',
    },
  },
  'archive-structure': {
    capability: 'structure',
    formats: { rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed' },
  },
  email: {
    capability: 'full',
    formats: { eml: 'message/rfc822', msg: 'application/vnd.ms-outlook', mbox: 'application/mbox' },
  },
  drawing: {
    capability: 'basic',
    formats: {
      drawio: 'application/vnd.jgraph.mxfile', dio: 'application/vnd.jgraph.mxfile',
      excalidraw: 'application/vnd.excalidraw+json', tldraw: 'application/json',
      xmind: 'application/vnd.xmind.workbook',
    },
  },
  office: {
    capability: 'basic',
    formats: {
      dotm: 'application/vnd.ms-word.template.macroenabled.12',
      fodt: 'application/vnd.oasis.opendocument.text-flat-xml', wps: 'application/vnd.ms-works',
      xlt: 'application/vnd.ms-excel',
      xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
      xltm: 'application/vnd.ms-excel.template.macroenabled.12',
      fods: 'application/vnd.oasis.opendocument.spreadsheet-flat-xml', et: 'application/vnd.ms-excel',
      ppsm: 'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
      potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
      potm: 'application/vnd.ms-powerpoint.template.macroenabled.12',
      fodp: 'application/vnd.oasis.opendocument.presentation-flat-xml', dps: 'application/vnd.ms-powerpoint',
    },
  },
  'office-structure': {
    capability: 'structure',
    formats: { numbers: 'application/vnd.apple.numbers', key: 'application/vnd.apple.keynote' },
  },
  asset: {
    capability: 'full',
    formats: {
      ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
      eot: 'application/vnd.ms-fontobject', psd: 'image/vnd.adobe.photoshop',
      psb: 'image/vnd.adobe.photoshop', parquet: 'application/vnd.apache.parquet',
      avro: 'application/avro', wasm: 'application/wasm',
    },
  },
  'asset-structure': {
    capability: 'structure',
    formats: {
      ai: 'application/postscript', eps: 'application/postscript', ps: 'application/postscript',
      webarchive: 'application/x-webarchive', sqlite: 'application/vnd.sqlite3',
      sqlite3: 'application/vnd.sqlite3', db: 'application/vnd.sqlite3',
    },
  },
  cad: {
    capability: 'basic',
    formats: {
      dxf: 'image/vnd.dxf', step: 'model/step', stp: 'model/step',
      iges: 'application/iges', igs: 'application/iges', ifc: 'application/x-step',
      sat: 'application/sat', 'x_t': 'application/x-parasolid',
      gds: 'application/vnd.gds', gdsii: 'application/x-gdsii',
      oas: 'application/vnd.oasis.layout', oasis: 'application/vnd.oasis.layout',
    },
  },
  'cad-structure': {
    capability: 'structure',
    formats: {
      dwg: 'application/acad', dwf: 'model/vnd.dwf', sab: 'application/sab',
      'x_b': 'application/x-parasolid', '3dm': 'model/vnd.3dm',
      skp: 'application/vnd.sketchup.skp', sldprt: 'application/sldworks',
      sldasm: 'application/sldworks',
    },
  },
  model3d: {
    capability: 'full',
    formats: {
      gltf: 'model/gltf+json', glb: 'model/gltf-binary', obj: 'model/obj',
      stl: 'model/stl', fbx: 'application/vnd.autodesk.fbx',
      dae: 'model/vnd.collada+xml', ply: 'application/ply', '3mf': 'model/3mf',
      '3ds': 'model/3ds', usd: 'model/vnd.usd', usda: 'model/vnd.usd',
      usdc: 'model/vnd.usd', usdz: 'model/vnd.usdz+zip',
      wrl: 'model/vrml', vrml: 'model/vrml',
    },
  },
  gis: {
    capability: 'full',
    formats: {
      geojson: 'application/geo+json', topojson: 'application/topo+json',
      kml: 'application/vnd.google-earth.kml+xml', kmz: 'application/vnd.google-earth.kmz',
      gpx: 'application/gpx+xml', shp: 'application/octet-stream',
    },
  },
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
  'image', 'pdf', 'word', 'excel', 'ppt', 'ofv',
]);

function createOfvPreviewInfo(extension, mimeType, family, capability, binary = true) {
  return {
    contentType: 'ofv',
    language: extension,
    mimeType,
    previewEngine: 'open-file-viewer',
    previewFamily: family,
    previewCapability: capability,
    binary,
  };
}

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
  if (OFV_IMAGE_MIME_BY_EXTENSION[extension]) {
    return createOfvPreviewInfo(
      extension,
      OFV_IMAGE_MIME_BY_EXTENSION[extension],
      'image',
      extension === 'jxl' ? 'basic' : 'full',
    );
  }
  if (OFV_VIDEO_MIME_BY_EXTENSION[extension]) {
    return createOfvPreviewInfo(
      extension,
      OFV_VIDEO_MIME_BY_EXTENSION[extension],
      'video',
      OFV_COMPATIBILITY_VIDEO_EXTENSIONS.has(extension) ? 'basic' : 'full',
    );
  }
  if (OFV_AUDIO_MIME_BY_EXTENSION[extension]) {
    return createOfvPreviewInfo(extension, OFV_AUDIO_MIME_BY_EXTENSION[extension], 'audio', 'full');
  }
  if (OFV_RICH_TEXT_MIME_BY_EXTENSION[extension]) {
    return createOfvPreviewInfo(extension, OFV_RICH_TEXT_MIME_BY_EXTENSION[extension], 'rich-text', 'full', false);
  }
  for (const [family, definition] of Object.entries(OFV_BINARY_FORMATS)) {
    if (definition.formats[extension]) {
      return createOfvPreviewInfo(
        extension,
        definition.formats[extension],
        family,
        definition.capability,
      );
    }
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
