#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { getWorkspaceFilePreviewInfo } from '../shared/workspace-preview.mjs';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mossRoot = path.resolve(scriptDir, '..');
const workspaceRoot = path.resolve(mossRoot, '..');
const ofvRoot = path.join(workspaceRoot, 'open-file-viewer');
const requireFromUi = createRequire(path.join(mossRoot, 'ui/package.json'));
const JSZip = requireFromUi('jszip');
const XLSX = requireFromUi('xlsx-republish');

const defaultOutput = path.join(process.env.HOME || '', 'Desktop', 'Moss-File-Preview-Samples');
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
const outputRoot = path.resolve(outputArg ? outputArg.slice('--output='.length) : defaultOutput);
const force = process.argv.includes('--force');
const records = [];
const skipped = [];

const tools = {
  magick: '/opt/homebrew/bin/magick',
  ffmpeg: '/usr/local/bin/ffmpeg',
  pandoc: '/opt/homebrew/bin/pandoc',
  rar: '/opt/homebrew/bin/rar',
  sqlite3: '/Users/bgd/anaconda3/bin/sqlite3',
  fonttools: '/Users/bgd/anaconda3/bin/fonttools',
  tar: '/usr/bin/tar',
  gzip: '/usr/bin/gzip',
  bzip2: '/Users/bgd/anaconda3/bin/bzip2',
  xz: '/Users/bgd/anaconda3/bin/xz',
  textutil: '/usr/bin/textutil',
};

function absolute(relativePath) {
  return path.join(outputRoot, relativePath);
}

async function ensureParent(relativePath) {
  await mkdir(path.dirname(absolute(relativePath)), { recursive: true });
}

async function write(relativePath, content) {
  await ensureParent(relativePath);
  await writeFile(absolute(relativePath), content);
}

async function copy(relativePath, sourcePath) {
  await ensureParent(relativePath);
  await copyFile(sourcePath, absolute(relativePath));
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd || outputRoot,
    encoding: options.binary ? 'buffer' : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function runToFile(command, args, relativePath, options = {}) {
  const result = await run(command, args, { ...options, binary: true });
  await write(relativePath, result.stdout);
}

async function optional(label, action) {
  try {
    await action();
  } catch (error) {
    skipped.push({ format: label, reason: String(error?.stderr || error?.message || error).trim() });
  }
}

async function register(relativePath, purpose, notes = '', testable = true) {
  const file = absolute(relativePath);
  const details = getWorkspaceFilePreviewInfo(file);
  const fileStat = await stat(file);
  let route = `Moss ${details.contentType}`;
  if (details.contentType === 'ofv') {
    route = `OFV ${details.previewFamily} (${details.previewCapability})`;
  } else if (['word', 'excel', 'ppt'].includes(details.contentType)) {
    route = `Moss ${details.contentType}; no LibreOffice -> OFV`;
  }
  records.push({
    file: relativePath,
    extension: path.extname(relativePath).slice(1) || '(none)',
    route,
    purpose,
    notes,
    testable,
    bytes: fileStat.size,
  });
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function svgPage(title, accent, subtitle) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <rect width="1200" height="800" fill="#f6f7f9"/>
  <rect x="0" y="0" width="1200" height="128" fill="${accent}"/>
  <text x="64" y="74" fill="#ffffff" font-family="Arial, sans-serif" font-size="42" font-weight="700">${title}</text>
  <text x="66" y="108" fill="#ffffff" font-family="Arial, sans-serif" font-size="18">${subtitle}</text>
  <rect x="64" y="184" width="510" height="230" rx="6" fill="#ffffff" stroke="#cbd1d8"/>
  <text x="96" y="232" fill="#20252b" font-family="Arial, sans-serif" font-size="24" font-weight="700">Preview checklist</text>
  <circle cx="108" cy="282" r="10" fill="#18a66a"/><text x="132" y="290" fill="#333" font-family="Arial" font-size="22">sharp text and solid colors</text>
  <circle cx="108" cy="330" r="10" fill="#18a66a"/><text x="132" y="338" fill="#333" font-family="Arial" font-size="22">correct aspect ratio</text>
  <circle cx="108" cy="378" r="10" fill="#18a66a"/><text x="132" y="386" fill="#333" font-family="Arial" font-size="22">zoom without layout shift</text>
  <rect x="626" y="184" width="510" height="230" rx="6" fill="#ffffff" stroke="#cbd1d8"/>
  <text x="658" y="232" fill="#20252b" font-family="Arial" font-size="24" font-weight="700">Quarterly volume</text>
  <line x1="680" y1="370" x2="1094" y2="370" stroke="#77818c"/>
  <rect x="710" y="302" width="62" height="68" fill="#56a8d8"/><rect x="810" y="260" width="62" height="110" fill="#18a66a"/>
  <rect x="910" y="224" width="62" height="146" fill="#f3b548"/><rect x="1010" y="196" width="62" height="174" fill="#e76363"/>
  <text x="716" y="396" font-family="Arial" font-size="16">Q1</text><text x="816" y="396" font-family="Arial" font-size="16">Q2</text>
  <text x="916" y="396" font-family="Arial" font-size="16">Q3</text><text x="1016" y="396" font-family="Arial" font-size="16">Q4</text>
  <rect x="64" y="466" width="1072" height="258" rx="6" fill="#20252b"/>
  <text x="96" y="520" fill="#f6f7f9" font-family="monospace" font-size="24">MOSS / OPEN FILE VIEWER / OFFLINE</text>
  <path d="M96 664 C230 500 350 700 500 566 S790 650 930 520 S1060 580 1100 502" fill="none" stroke="#f3b548" stroke-width="8"/>
  <circle cx="500" cy="566" r="12" fill="#e76363"/><circle cx="930" cy="520" r="12" fill="#56a8d8"/>
</svg>`;
}

async function generateTextAndCode() {
  const files = {
    '01-text-code/README.md': '# Preview sample\n\nThis Markdown file has **bold text**, a table, and code.\n\n| Engine | Offline |\n|---|---:|\n| Moss | yes |\n| OFV | yes |\n\n```ts\nconst preview = { status: "ready" };\n```\n',
    '01-text-code/dashboard.html': '<!doctype html><html><head><meta charset="utf-8"><style>body{font:18px system-ui;margin:40px;background:#f6f7f9;color:#20252b}header{background:#126b7a;color:white;padding:24px}section{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:20px}.metric{border:1px solid #ccd3d8;padding:20px;background:white}b{font-size:34px;color:#d44}</style></head><body><header><h1>Moss HTML Preview</h1><p>Scripts are intentionally unnecessary.</p></header><section><div class="metric">Documents<br><b>42</b></div><div class="metric">Images<br><b>18</b></div><div class="metric">Media<br><b>9</b></div></section></body></html>',
    '01-text-code/sample.ts': 'type PreviewState = { file: string; ready: boolean };\n\nexport function summarize(items: PreviewState[]) {\n  return items.filter(({ ready }) => ready).map(({ file }) => file);\n}\n',
    '01-text-code/sample.py': 'from dataclasses import dataclass\n\n@dataclass\nclass Preview:\n    name: str\n    ready: bool = True\n\nprint(Preview("report.docx"))\n',
    '01-text-code/config.yaml': 'preview:\n  offline: true\n  engines:\n    - moss\n    - open-file-viewer\n  limits:\n    rows: 500\n    pages: 80\n',
    '01-text-code/change.diff': 'diff --git a/preview.txt b/preview.txt\nindex 1111111..2222222 100644\n--- a/preview.txt\n+++ b/preview.txt\n@@ -1,2 +1,2 @@\n-old parser\n+offline parser\n stable behavior\n',
    '01-text-code/flow.mermaid': 'flowchart LR\n  A[Select file] --> B{Known type?}\n  B -->|Moss| C[Native viewer]\n  B -->|OFV| D[Plugin viewer]\n  C --> E[Preview ready]\n  D --> E\n',
    '01-text-code/song.lrc': '[00:00.00]Moss preview audio test\n[00:01.00]The highlighted line should advance\n[00:02.00]Offline playback complete\n',
    '01-text-code/notebook.ipynb': JSON.stringify({ cells: [{ cell_type: 'markdown', metadata: {}, source: ['# Offline analysis\n', 'A meaningful notebook preview.'] }, { cell_type: 'code', execution_count: 1, metadata: {}, outputs: [{ output_type: 'stream', name: 'stdout', text: ['preview ready\\n'] }], source: ['formats = ["docx", "epub", "gltf"]\n', 'print("preview ready")'] }], metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } }, nbformat: 4, nbformat_minor: 5 }, null, 2),
    '01-text-code/unknown-extension.notes': 'Unknown UTF-8 files should fall back to the Moss text viewer.\nThis validates content sniffing without a registered extension.\n',
  };
  for (const [relativePath, content] of Object.entries(files)) {
    await write(relativePath, content);
    await register(relativePath, 'Text, code, rich-text, or HTML rendering');
  }
}

async function generateImages() {
  const firstSvg = '02-images/showcase.svg';
  const secondSvg = '02-images/showcase-page-2.svg';
  await write(firstSvg, svgPage('Moss Preview Samples', '#126b7a', 'Page 1 / color, text, chart, and curves'));
  await write(secondSvg, svgPage('Second Image Page', '#8a3f64', 'Page 2 / multi-page and animation test'));
  await register(firstSvg, 'Native SVG image preview');

  const rasterFont = '/System/Library/Fonts/SFNS.ttf';
  await run(tools.magick, ['-font', rasterFont, absolute(firstSvg), absolute('02-images/showcase.png')]);
  await run(tools.magick, ['-font', rasterFont, absolute(secondSvg), absolute('02-images/showcase-page-2.png')]);
  await register('02-images/showcase.png', 'Reference raster image');

  const conversions = [
    ['showcase.jpg', ['-quality', '88']], ['showcase.jfif', ['-quality', '88']],
    ['showcase.webp', ['-quality', '86']], ['showcase.bmp', []], ['showcase.avif', ['-quality', '55']],
    ['showcase.heic', ['-quality', '60']], ['showcase.ico', ['-resize', '128x128']],
    ['showcase.cur', ['-resize', '32x32']], ['showcase.psd', []], ['showcase.eps', []], ['showcase.ps', []],
  ];
  for (const [name, args] of conversions) {
    await optional(name, async () => {
      const relativePath = `02-images/${name}`;
      await run(tools.magick, [absolute('02-images/showcase.png'), ...args, absolute(relativePath)]);
      await register(relativePath, 'Image decoding, zoom, and color fidelity');
    });
  }
  await run(tools.magick, [absolute('02-images/showcase.png'), absolute('02-images/showcase-page-2.png'), '-compress', 'lzw', absolute('02-images/multipage.tiff')]);
  await register('02-images/multipage.tiff', 'Multi-page TIFF navigation', 'Two pages');
  await run(tools.magick, ['-delay', '80', absolute('02-images/showcase.png'), absolute('02-images/showcase-page-2.png'), '-loop', '0', absolute('02-images/animated.gif')]);
  await register('02-images/animated.gif', 'Native animated image playback', 'Two frames');
  await optional('APNG', async () => {
    await run(tools.magick, ['-delay', '80', absolute('02-images/showcase.png'), absolute('02-images/showcase-page-2.png'), '-loop', '0', absolute('02-images/animated.apng')]);
    await register('02-images/animated.apng', 'OFV animated PNG playback', 'Two frames');
  });
}

async function generateOffice() {
  const markdown = `---
title: Moss File Preview Acceptance Report
author: Offline Test Suite
date: 2026-09-14
---

# Executive summary

This document verifies headings, paragraphs, **bold text**, *italic text*, lists, tables, code, links, and embedded images.

| Family | Sample count | Expected route |
|:--|--:|:--|
| Office | 8 | Moss / OFV fallback |
| Media | 12 | OFV |
| CAD and 3D | 16 | OFV |

![Preview dashboard](02-images/showcase.png){ width=75% }

## Checklist

1. The title and table are visible.
2. The image is embedded rather than loaded from the network.
3. Page navigation and zoom remain usable.

> Offline preview should never require a CDN.

\`\`\`json
{"engine":"open-file-viewer","offline":true}
\`\`\`
`;
  await write('03-documents-office/report-source.md', markdown);
  const source = absolute('03-documents-office/report-source.md');
  for (const [name, format] of [['report.docx', 'docx'], ['report.odt', 'odt'], ['report.rtf', 'rtf']]) {
    await run(tools.pandoc, [source, '--resource-path', outputRoot, '--to', format, '--output', absolute(`03-documents-office/${name}`)]);
    await register(`03-documents-office/${name}`, 'Rich Word document with embedded image and table');
  }
  await optional('DOC', async () => {
    await run(tools.textutil, ['-convert', 'doc', '-output', absolute('03-documents-office/report.doc'), absolute('03-documents-office/report.rtf')]);
    await register('03-documents-office/report.doc', 'Legacy Word compatibility preview');
  });

  const slides = `% Moss Preview Deck\n% Offline Test Suite\n% 2026-09-14\n\n# One preview route per format\n\n- Native Moss viewers remain for editing\n- OFV handles additional binary formats\n- Every dependency is bundled locally\n\n# Visual fidelity\n\n![Preview dashboard](02-images/showcase.png){ width=70% }\n\n# Acceptance\n\n| Check | Result |\n|---|---|\n| Offline | Required |\n| Relative resources | Required |\n| Safe fallback | Required |\n`;
  await write('03-documents-office/slides-source.md', slides);
  await run(tools.pandoc, [absolute('03-documents-office/slides-source.md'), '--resource-path', outputRoot, '--to', 'pptx', '--output', absolute('03-documents-office/slides.pptx')]);
  await register('03-documents-office/slides.pptx', 'Three-slide presentation with image and table');
  await createOdp('03-documents-office/slides.odp');
  await register('03-documents-office/slides.odp', 'OpenDocument presentation with two visual slides');

  await createSpreadsheet('03-documents-office/metrics.xlsx', 'xlsx');
  await createSpreadsheet('03-documents-office/metrics.xls', 'xls');
  await createSpreadsheet('03-documents-office/metrics.xlsb', 'xlsb');
  await createSpreadsheet('03-documents-office/metrics.ods', 'ods');
  for (const name of ['metrics.xlsx', 'metrics.xls', 'metrics.xlsb', 'metrics.ods']) {
    await register(`03-documents-office/${name}`, 'Two-sheet workbook with formulas, styles, widths, and merged cells');
  }
  await write('03-documents-office/metrics.csv', 'Quarter,Documents,Images,Media,Total\nQ1,12,8,3,23\nQ2,18,10,5,33\nQ3,25,15,7,47\nQ4,31,18,9,58\n');
  await write('03-documents-office/metrics.tsv', 'Quarter\tStatus\tOwner\nQ1\tDone\tMoss\nQ2\tReady\tOFV\nQ3\tTesting\tDesktop\n');
  await register('03-documents-office/metrics.csv', 'Moss CSV table preview');
  await register('03-documents-office/metrics.tsv', 'Moss TSV table preview');
  await copy('03-documents-office/multipage.pdf', path.join(ofvRoot, 'doc/public/__zoom-test.pdf'));
  await register('03-documents-office/multipage.pdf', 'Moss Chromium multi-page PDF and zoom');
}

async function createSpreadsheet(relativePath, bookType) {
  const overview = XLSX.utils.aoa_to_sheet([
    ['Moss Preview Metrics', null, null, null, null],
    ['Quarter', 'Documents', 'Images', 'Media', 'Total'],
    ['Q1', 12, 8, 3, { f: 'SUM(B3:D3)' }],
    ['Q2', 18, 10, 5, { f: 'SUM(B4:D4)' }],
    ['Q3', 25, 15, 7, { f: 'SUM(B5:D5)' }],
    ['Q4', 31, 18, 9, { f: 'SUM(B6:D6)' }],
  ]);
  overview['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  overview['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  const details = XLSX.utils.json_to_sheet([
    { File: 'report.docx', Engine: 'Moss / OFV', Offline: true },
    { File: 'map.geojson', Engine: 'OFV', Offline: true },
    { File: 'scene.glb', Engine: 'OFV', Offline: true },
  ]);
  details['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 12 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, overview, 'Overview');
  XLSX.utils.book_append_sheet(workbook, details, 'Files');
  XLSX.writeFile(workbook, absolute(relativePath), { bookType });
}

async function createOdp(relativePath) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.presentation', { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.presentation"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`);
  zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2"><office:body><office:presentation><draw:page draw:name="Slide 1"><draw:frame svg:x="1cm" svg:y="1cm" svg:width="24cm" svg:height="3cm"><draw:text-box><text:p>Moss Offline Preview</text:p><text:p>OpenDocument presentation</text:p></draw:text-box></draw:frame></draw:page><draw:page draw:name="Slide 2"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="8cm"><draw:text-box><text:p>Office fallback checklist</text:p><text:p>Fonts, shapes, pages, and navigation</text:p></draw:text-box></draw:frame></draw:page></office:presentation></office:body></office:document-content>`);
  await write(relativePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function generateMedia() {
  const mediaDir = absolute('04-media');
  await mkdir(mediaDir, { recursive: true });
  const ff = ['-hide_banner', '-loglevel', 'error', '-y'];
  await run(tools.ffmpeg, [...ff, '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100', '-t', '3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path.join(mediaDir, 'test-pattern.mp4')]);
  await register('04-media/test-pattern.mp4', 'Video, audio, seek, duration, and poster frame');
  const videos = [
    ['test-pattern.webm', ['-c:v', 'libvpx-vp9', '-b:v', '500k', '-c:a', 'libopus']],
    ['test-pattern.mov', ['-c', 'copy']],
    ['test-pattern.mkv', ['-c', 'copy']],
    ['compatibility.avi', ['-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame']],
  ];
  for (const [name, args] of videos) {
    await run(tools.ffmpeg, [...ff, '-i', path.join(mediaDir, 'test-pattern.mp4'), ...args, path.join(mediaDir, name)]);
    await register(`04-media/${name}`, 'Video codec/container compatibility and fallback messaging');
  }
  await mkdir(path.join(mediaDir, 'hls'), { recursive: true });
  await run(tools.ffmpeg, [...ff, '-i', path.join(mediaDir, 'test-pattern.mp4'), '-c', 'copy', '-hls_time', '1', '-hls_list_size', '0', '-hls_segment_filename', path.join(mediaDir, 'hls', 'segment-%02d.ts'), path.join(mediaDir, 'hls', 'playlist.m3u8')]);
  await register('04-media/hls/playlist.m3u8', 'Offline HLS playlist and relative segment loading', 'Keep the segment files beside the playlist');
  const hlsSegments = (await readdir(path.join(mediaDir, 'hls'))).filter((name) => name.endsWith('.ts')).sort();
  for (const segment of hlsSegments) {
    await register(`04-media/hls/${segment}`, 'HLS companion resource', 'Do not open directly', false);
  }

  await run(tools.ffmpeg, [...ff, '-f', 'lavfi', '-i', 'sine=frequency=523.25:sample_rate=44100', '-t', '3', '-c:a', 'pcm_s16le', path.join(mediaDir, 'tone.wav')]);
  await register('04-media/tone.wav', 'Lossless audio waveform and playback');
  const audio = [
    ['tone.mp3', ['-c:a', 'libmp3lame', '-q:a', '4']], ['tone.flac', ['-c:a', 'flac']],
    ['tone.ogg', ['-c:a', 'libvorbis', '-q:a', '5']], ['tone.opus', ['-c:a', 'libopus', '-b:a', '96k']],
    ['tone.m4a', ['-c:a', 'aac', '-b:a', '128k']], ['tone.aac', ['-c:a', 'aac', '-b:a', '128k']],
    ['tone.aiff', ['-c:a', 'pcm_s16be']],
  ];
  for (const [name, args] of audio) {
    await run(tools.ffmpeg, [...ff, '-i', path.join(mediaDir, 'tone.wav'), ...args, path.join(mediaDir, name)]);
    await register(`04-media/${name}`, 'Audio metadata, controls, duration, and playback');
  }
}

async function generateEbooksAndFixedDocs() {
  await mkdir(absolute('05-ebook-fixed-docs'), { recursive: true });
  await run(tools.pandoc, [absolute('03-documents-office/report-source.md'), '--resource-path', outputRoot, '--to', 'epub3', '--metadata', 'title=Moss Offline Preview Book', '--output', absolute('05-ebook-fixed-docs/preview-book.epub')]);
  await register('05-ebook-fixed-docs/preview-book.epub', 'EPUB table of contents, chapter, image, and typography');
  await createXps('05-ebook-fixed-docs/two-page.xps');
  await register('05-ebook-fixed-docs/two-page.xps', 'Two-page XPS fixed layout with glyphs and vector paths');
  await copy('05-ebook-fixed-docs/sample.ofd', path.join(ofvRoot, 'doc/public/issue37-repro.ofd'));
  await register('05-ebook-fixed-docs/sample.ofd', 'Real OFD regression sample from Open File Viewer');
}

async function createXps(relativePath) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="fdseq" ContentType="application/vnd.ms-package.xps-fixeddocumentsequence+xml"/><Default Extension="fdoc" ContentType="application/vnd.ms-package.xps-fixeddocument+xml"/><Default Extension="fpage" ContentType="application/vnd.ms-package.xps-fixedpage+xml"/></Types>');
  zip.file('FixedDocSeq.fdseq', '<?xml version="1.0"?><FixedDocumentSequence xmlns="http://schemas.microsoft.com/xps/2005/06"><DocumentReference Source="/Documents/1/FixedDoc.fdoc"/></FixedDocumentSequence>');
  zip.file('Documents/1/FixedDoc.fdoc', '<?xml version="1.0"?><FixedDocument xmlns="http://schemas.microsoft.com/xps/2005/06"><PageContent Source="Pages/1.fpage"/><PageContent Source="Pages/2.fpage"/></FixedDocument>');
  zip.file('Documents/1/Pages/1.fpage', '<?xml version="1.0"?><FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="816" Height="1056"><Path Fill="#126B7A" Data="M 60,60 L 756,60 756,250 60,250 Z"/><Glyphs FontUri="/Resources/Fonts/Test.ttf" FontRenderingEmSize="38" Fill="#FFFFFF" OriginX="90" OriginY="150" UnicodeString="Moss XPS Preview"/><Path Stroke="#E76363" StrokeThickness="10" Data="M 100,400 C 250,250 430,600 700,360"/></FixedPage>');
  zip.file('Documents/1/Pages/2.fpage', '<?xml version="1.0"?><FixedPage xmlns="http://schemas.microsoft.com/xps/2005/06" Width="816" Height="1056"><Path Fill="#F3B548" Data="M 80,80 L 736,80 736,500 80,500 Z"/><Glyphs FontUri="/Resources/Fonts/Test.ttf" FontRenderingEmSize="32" Fill="#20252B" OriginX="120" OriginY="180" UnicodeString="Page 2 - offline"/></FixedPage>');
  await write(relativePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function generateArchives() {
  const payloadRoot = absolute('06-archives/payload');
  await mkdir(path.join(payloadRoot, 'nested'), { recursive: true });
  await write('06-archives/payload/README.txt', 'Archive preview test\nContains nested text, JSON, and a thumbnail.\n');
  await write('06-archives/payload/nested/data.json', JSON.stringify({ offline: true, formats: ['zip', 'tar', 'rar'] }, null, 2));
  await copy('06-archives/payload/thumbnail.png', absolute('02-images/showcase.png'));
  const archiveDir = absolute('06-archives');
  const zip = new JSZip();
  zip.file('README.txt', await readFile(path.join(payloadRoot, 'README.txt')));
  zip.file('nested/data.json', await readFile(path.join(payloadRoot, 'nested/data.json')));
  zip.file('thumbnail.png', await readFile(path.join(payloadRoot, 'thumbnail.png')));
  await write('06-archives/files.zip', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  await register('06-archives/files.zip', 'Archive tree and internal file preview');
  await run(tools.tar, ['-cf', path.join(archiveDir, 'files.tar'), 'payload'], { cwd: archiveDir });
  await run(tools.tar, ['-czf', path.join(archiveDir, 'files.tgz'), 'payload'], { cwd: archiveDir });
  await runToFile(tools.gzip, ['-c', path.join(payloadRoot, 'README.txt')], '06-archives/readme.txt.gz');
  await runToFile(tools.bzip2, ['-c', path.join(payloadRoot, 'README.txt')], '06-archives/readme.txt.bz2');
  await runToFile(tools.xz, ['-c', path.join(payloadRoot, 'README.txt')], '06-archives/readme.txt.xz');
  await run(tools.rar, ['a', '-idq', path.join(archiveDir, 'files.rar'), 'payload'], { cwd: archiveDir });
  for (const name of ['files.tar', 'files.tgz', 'readme.txt.gz', 'readme.txt.bz2', 'readme.txt.xz', 'files.rar']) {
    await register(`06-archives/${name}`, 'Archive structure, metadata, and extraction behavior');
  }
}

async function generateEmailAndDrawings() {
  const imageBase64 = (await readFile(absolute('02-images/showcase.png'))).toString('base64');
  const eml = `From: Preview Bot <preview@example.test>\r\nTo: Moss Tester <tester@example.test>\r\nSubject: Offline preview acceptance\r\nDate: Mon, 14 Sep 2026 10:00:00 +0800\r\nMessage-ID: <preview-001@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="moss-boundary"\r\n\r\n--moss-boundary\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<html><body><h1 style="color:#126b7a">Preview ready</h1><p>This HTML email contains a real PNG attachment.</p><table border="1"><tr><th>Mode</th><th>Status</th></tr><tr><td>Offline</td><td>Pass</td></tr></table></body></html>\r\n--moss-boundary\r\nContent-Type: image/png; name="dashboard.png"\r\nContent-Disposition: attachment; filename="dashboard.png"\r\nContent-Transfer-Encoding: base64\r\n\r\n${imageBase64.match(/.{1,76}/g).join('\r\n')}\r\n--moss-boundary--\r\n`;
  await write('07-email/message-with-attachment.eml', eml);
  await register('07-email/message-with-attachment.eml', 'HTML email sanitization, headers, and attachment listing');
  const mbox = `From preview@example.test Mon Sep 14 10:00:00 2026\nSubject: First offline message\nFrom: Preview Bot <preview@example.test>\nTo: tester@example.test\nDate: Mon, 14 Sep 2026 10:00:00 +0800\n\nFirst plain-text message.\n\nFrom qa@example.test Mon Sep 14 11:00:00 2026\nSubject: Second test result\nFrom: QA <qa@example.test>\nTo: tester@example.test\nDate: Mon, 14 Sep 2026 11:00:00 +0800\n\nSecond message confirms mailbox navigation.\n`;
  await write('07-email/two-messages.mbox', mbox);
  await register('07-email/two-messages.mbox', 'Mailbox list and message selection');

  await write('08-diagrams/architecture.drawio', drawioXml());
  await register('08-diagrams/architecture.drawio', 'Draw.io nodes, colors, labels, and connectors');
  await write('08-diagrams/whiteboard.excalidraw', JSON.stringify({ type: 'excalidraw', version: 2, source: 'moss-preview-suite', elements: [{ id: 'box', type: 'rectangle', x: 80, y: 70, width: 260, height: 120, angle: 0, strokeColor: '#126b7a', backgroundColor: '#d8eef2', fillStyle: 'solid', strokeWidth: 3, roughness: 1, opacity: 100 }, { id: 'ellipse', type: 'ellipse', x: 470, y: 70, width: 180, height: 120, angle: 0, strokeColor: '#8a3f64', backgroundColor: '#f3dce8', fillStyle: 'solid', strokeWidth: 3, roughness: 1, opacity: 100 }, { id: 'label', type: 'text', x: 115, y: 110, width: 190, height: 30, angle: 0, strokeColor: '#20252b', backgroundColor: 'transparent', text: 'Moss native viewer', fontSize: 24, fontFamily: 1, textAlign: 'center', verticalAlign: 'middle' }, { id: 'arrow', type: 'arrow', x: 345, y: 130, width: 120, height: 0, angle: 0, strokeColor: '#e76363', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 4, roughness: 1, opacity: 100, points: [[0, 0], [120, 0]], startBinding: null, endBinding: null }], appState: { viewBackgroundColor: '#f6f7f9' }, files: {} }, null, 2));
  await register('08-diagrams/whiteboard.excalidraw', 'Excalidraw shapes, text, and arrow');
  await write('08-diagrams/roadmap.tldraw', JSON.stringify({ records: [{ typeName: 'shape', id: 'shape:box', type: 'geo', x: 20, y: 30, props: { geo: 'rectangle', w: 220, h: 100, color: 'blue', fill: 'solid', text: 'Moss preview' } }, { typeName: 'shape', id: 'shape:arrow', type: 'arrow', x: 270, y: 80, props: { start: { x: 0, y: 0 }, end: { x: 160, y: 50 }, color: 'red' } }, { typeName: 'shape', id: 'shape:note', type: 'note', x: 470, y: 30, props: { w: 160, h: 110, color: 'yellow', text: 'Offline ready' } }] }, null, 2));
  await register('08-diagrams/roadmap.tldraw', 'Tldraw rectangle, arrow, and note');
  await createXmind('08-diagrams/roadmap.xmind');
  await register('08-diagrams/roadmap.xmind', 'XMind hierarchy, labels, markers, and notes');
}

function drawioXml() {
  return `<mxfile host="app.diagrams.net"><diagram name="Preview architecture"><mxGraphModel dx="900" dy="600" grid="1"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="moss" value="Moss file router" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#d8eef2;strokeColor=#126b7a;fontSize=18" vertex="1" parent="1"><mxGeometry x="60" y="80" width="220" height="100" as="geometry"/></mxCell><mxCell id="ofv" value="Open File Viewer" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#f3dce8;strokeColor=#8a3f64;fontSize=18" vertex="1" parent="1"><mxGeometry x="430" y="80" width="220" height="100" as="geometry"/></mxCell><mxCell id="edge" value="binary stream" style="edgeStyle=orthogonalEdgeStyle;rounded=0;strokeColor=#e76363;strokeWidth=3" edge="1" parent="1" source="moss" target="ofv"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
}

async function createXmind(relativePath) {
  const zip = new JSZip();
  zip.file('content.json', JSON.stringify([{ id: 'sheet-1', class: 'sheet', title: 'Preview roadmap', rootTopic: { id: 'root', class: 'topic', title: 'Moss file preview', labels: ['offline'], notes: { plain: { content: 'Acceptance sample with nested topics.' } }, children: { attached: [{ id: 'office', class: 'topic', title: 'Office', markers: [{ markerId: 'priority-1' }] }, { id: 'media', class: 'topic', title: 'Media', children: { attached: [{ id: 'video', class: 'topic', title: 'Video' }, { id: 'audio', class: 'topic', title: 'Audio' }] } }, { id: 'model', class: 'topic', title: '3D and GIS' }] } } }], null, 2));
  zip.file('metadata.json', JSON.stringify({ creator: { name: 'Moss preview generator' }, activeSheetId: 'sheet-1' }));
  zip.file('manifest.json', JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } }));
  await write(relativePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function generateAssets() {
  const sourceFont = '/System/Library/Fonts/SFNSMono.ttf';
  await copy('09-assets-data/SF-Mono.ttf', sourceFont);
  await register('09-assets-data/SF-Mono.ttf', 'Font metadata and sample text rendering');
  for (const [name, flavor] of [['SF-Mono.woff', 'woff'], ['SF-Mono.woff2', 'woff2']]) {
    await optional(name, async () => {
      await run(tools.fonttools, ['subset', sourceFont, `--flavor=${flavor}`, `--output-file=${absolute(`09-assets-data/${name}`)}`, '--unicodes=U+0020-007E']);
      await register(`09-assets-data/${name}`, 'Webfont metadata and sample text rendering');
    });
  }
  await copy('09-assets-data/layered-image.psd', absolute('02-images/showcase.psd'));
  await register('09-assets-data/layered-image.psd', 'PSD composite image and layer metadata');
  await copy('09-assets-data/vector.eps', absolute('02-images/showcase.eps'));
  await copy('09-assets-data/postscript.ps', absolute('02-images/showcase.ps'));
  await register('09-assets-data/vector.eps', 'EPS document structure and DSC metadata');
  await register('09-assets-data/postscript.ps', 'PostScript document structure and DSC metadata');

  await run(tools.sqlite3, [absolute('09-assets-data/preview.sqlite'), `CREATE TABLE files(id INTEGER PRIMARY KEY, name TEXT, family TEXT, ready INTEGER); INSERT INTO files(name,family,ready) VALUES ('report.docx','office',1),('scene.glb','model3d',1),('map.geojson','gis',1); CREATE VIEW ready_files AS SELECT name,family FROM files WHERE ready=1;`]);
  await register('09-assets-data/preview.sqlite', 'SQLite schema, tables, views, and row samples');
  await write('09-assets-data/module.wasm', minimalWasmModule());
  await register('09-assets-data/module.wasm', 'WebAssembly sections, import, and export metadata');
  await write('09-assets-data/events.avro', minimalAvroFile());
  await register('09-assets-data/events.avro', 'Avro schema and two records');
  await write('09-assets-data/article.webarchive', webArchiveXml());
  await register('09-assets-data/article.webarchive', 'WebArchive main resource and subresource metadata');
}

function minimalWasmModule() {
  const varUint = (value) => { const result = []; do { let byte = value & 0x7f; value >>>= 7; if (value) byte |= 0x80; result.push(byte); } while (value); return result; };
  const name = (value) => { const bytes = [...Buffer.from(value)]; return [...varUint(bytes.length), ...bytes]; };
  const section = (id, payload) => [id, ...varUint(payload.length), ...payload];
  return Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...section(1, [1, 0x60, 0, 0]), ...section(2, [1, ...name('env'), ...name('log'), 0, 0]), ...section(3, [1, 0]), ...section(7, [1, ...name('run'), 0, 1]), ...section(10, [1, 2, 0, 0x0b])]);
}

function avroLong(value) {
  let current = value >= 0 ? value * 2 : (-value * 2) - 1;
  const result = [];
  do { let byte = current & 0x7f; current = Math.floor(current / 128); if (current) byte |= 0x80; result.push(byte); } while (current);
  return result;
}

function avroBytes(value) {
  const bytes = [...Buffer.from(value)];
  return [...avroLong(bytes.length), ...bytes];
}

function minimalAvroFile() {
  const schema = JSON.stringify({ type: 'record', name: 'Event', fields: [{ name: 'id', type: 'long' }, { name: 'name', type: 'string' }] });
  const metadata = [{ key: 'avro.schema', value: schema }, { key: 'avro.codec', value: 'null' }];
  const sync = Array.from({ length: 16 }, (_, index) => index);
  const rows = [[...avroLong(1), ...avroBytes('Launch')], [...avroLong(2), ...avroBytes('Review')]];
  const body = rows.flat();
  return Buffer.from([0x4f, 0x62, 0x6a, 0x01, ...avroLong(metadata.length), ...metadata.flatMap((item) => [...avroBytes(item.key), ...avroBytes(item.value)]), ...avroLong(0), ...sync, ...avroLong(rows.length), ...avroLong(body.length), ...body, ...sync]);
}

function webArchiveXml() {
  const html = Buffer.from('<html><body><h1>Moss WebArchive</h1><p>Offline main resource.</p></body></html>').toString('base64');
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>WebMainResource</key><dict><key>WebResourceURL</key><string>https://example.test/preview</string><key>WebResourceMIMEType</key><string>text/html</string><key>WebResourceTextEncodingName</key><string>UTF-8</string><key>WebResourceData</key><data>${html}</data></dict><key>WebSubresources</key><array><dict><key>WebResourceURL</key><string>https://example.test/style.css</string></dict></array></dict></plist>`;
}

async function generateCad() {
  const cadFiles = {
    '10-cad/geometry.dxf': sampleDxf(),
    '10-cad/part.step': "ISO-10303-21;\nDATA;\n#1 = CARTESIAN_POINT('P1',(1.,2.,3.));\n#2 = DIRECTION('D1',(0.,0.,1.));\n#3 = LINE('L1',#1,#2);\nENDSEC;\nEND-ISO-10303-21;\n",
    '10-cad/part.igs': "                                                                        S      1\n116,1.0,2.0,3.0;                                                        P      1\n110,0.0,0.0,0.0,10.0,0.0,0.0;                                        P      2\n",
    '10-cad/building.ifc': "ISO-10303-21;\nDATA;\n#1 = IFCPROJECT('0PROJECT',$,'Preview Project',$,$,$,$,$);\n#2 = IFCBUILDING('0BLDG',$,'HQ Building',$,$,$,$,$,$,$,$,$);\n#3 = IFCSPACE('0SPACE',$,'Lobby',$,$,$,$,$,$,$);\n#4 = IFCWALL('0WALL',$,'Lobby Wall',$,$,$,$,$);\n#5 = IFCDOOR('0DOOR',$,'Entry Door',$,$,$,$,$);\nENDSEC;\nEND-ISO-10303-21;\n",
    '10-cad/solid.sat': '700 0 1 0\n0 vertex $-1 0 0 0 #\n1 vertex $-1 100 0 0 #\n2 straight-curve $-1 0 0 0 1 0 0 #\nEnd-of-ACIS-data\n',
    '10-cad/parasolid.x_t': 'BEGIN HEADER;\n#1=point(0,0,0);\n#2=point(120,0,0);\n#3=line(0,0,0,120,0,0);\nEND;\n',
  };
  for (const [relativePath, content] of Object.entries(cadFiles)) {
    await write(relativePath, content);
    await register(relativePath, 'CAD entities, summary, and lightweight geometry');
  }
  await write('10-cad/layout.gds', sampleGds());
  await write('10-cad/layout.oas', sampleOasis());
  await register('10-cad/layout.gds', 'GDSII polygon and layer visualization');
  await register('10-cad/layout.oas', 'OASIS layout container and records');
  await copy('10-cad/real-sample.dwg', path.join(ofvRoot, 'doc/public/samples/cad/绘图_翁家翌_2016011446_自63.dwg'));
  await register('10-cad/real-sample.dwg', 'Real DWG structure/fallback sample', 'Default build does not include an enhanced DWG engine');
}

function sampleDxf() {
  return ['0','SECTION','2','ENTITIES','0','LINE','8','WALLS','10','0','20','0','11','160','21','0','0','CIRCLE','8','FIXTURES','10','80','20','60','40','28','0','ARC','8','ROUTE','10','80','20','60','40','45','50','0','51','120','0','LWPOLYLINE','8','BOUNDARY','90','4','70','1','10','0','20','0','10','160','20','0','10','160','20','120','10','0','20','120','0','TEXT','8','NOTES','10','36','20','96','40','14','1','MOSS PREVIEW','0','ENDSEC','0','EOF'].join('\n');
}

function sampleGds() {
  const bytes = [];
  const record = (type, dataType, data = []) => { const length = data.length + 4; bytes.push((length >> 8) & 255, length & 255, type, dataType, ...data); };
  const int2 = (value) => [(value >> 8) & 255, value & 255];
  const int4 = (value) => [(value >> 24) & 255, (value >> 16) & 255, (value >> 8) & 255, value & 255];
  const ascii = (value) => { const result = [...Buffer.from(value)]; if (result.length % 2) result.push(0); return result; };
  const date = [0x07, 0xe9, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0];
  record(0, 2, int2(600)); record(1, 2, date.concat(date)); record(2, 6, ascii('MOSS-LIB'));
  record(3, 5, [0x3e,0x41,0x89,0x37,0x4b,0xc6,0xa7,0xf0,0x39,0x44,0xb8,0x2f,0xa0,0x9b,0x5a,0x54]);
  record(5, 2, date.concat(date)); record(6, 6, ascii('TOP')); record(8, 0); record(0x0d, 2, int2(1)); record(0x0e, 2, int2(0));
  record(0x10, 3, [...int4(0),...int4(0),...int4(100),...int4(0),...int4(100),...int4(80),...int4(0),...int4(80),...int4(0),...int4(0)]);
  record(0x11, 0); record(7, 0); record(4, 0);
  return Buffer.from(bytes);
}

function sampleOasis() {
  return Buffer.from([...Buffer.from('%SEMI-OASIS\r\n'), 1, 3, 0x31, 0x2e, 0x30, 0, 0x21, 0x63,0x66,0x0e,0xf1,0x0f,0x60,0xe6,0x70,0xf1,0x74,0x8d,0x0f,0xf6,0x8c,0x72,0x05,0, 2]);
}

async function generateModels() {
  const positions = Buffer.alloc(44);
  const values = [-1, -0.8, 0, 1, -0.8, 0, 0, 1, 0];
  values.forEach((value, index) => positions.writeFloatLE(value, index * 4));
  positions.writeUInt16LE(0, 36); positions.writeUInt16LE(1, 38); positions.writeUInt16LE(2, 40);
  const gltf = gltfDocument(`data:application/octet-stream;base64,${positions.toString('base64')}`);
  await write('11-model-3d/triangle.gltf', JSON.stringify(gltf, null, 2));
  await register('11-model-3d/triangle.gltf', 'Interactive Three.js camera, mesh, lighting, and controls');
  await write('11-model-3d/triangle.glb', createGlb(gltfDocument(undefined), positions));
  await register('11-model-3d/triangle.glb', 'Binary glTF mesh and interactive controls');
  await mkdir(absolute('11-model-3d/textured-obj/textures'), { recursive: true });
  await copy('11-model-3d/textured-obj/textures/checker.png', absolute('02-images/showcase.png'));
  await write('11-model-3d/textured-obj/scene.mtl', 'newmtl PreviewMaterial\nKa 0.2 0.2 0.2\nKd 0.2 0.7 0.6\nKs 0.8 0.8 0.8\nNs 32\nmap_Kd textures/checker.png\n');
  await write('11-model-3d/textured-obj/scene.obj', 'mtllib scene.mtl\no PreviewTriangle\nv -1 -0.8 0\nv 1 -0.8 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0.5 1\nvn 0 0 1\nusemtl PreviewMaterial\nf 1/1/1 2/2/1 3/3/1\n');
  await register('11-model-3d/textured-obj/scene.obj', 'OBJ with relative MTL and PNG texture', 'Keep scene.mtl and textures/ beside the OBJ');
  await write('11-model-3d/pyramid.stl', 'solid pyramid\n facet normal 0 0 1\n  outer loop\n   vertex -1 -1 0\n   vertex 1 -1 0\n   vertex 0 0 1.5\n  endloop\n endfacet\n facet normal 1 0 0\n  outer loop\n   vertex 1 -1 0\n   vertex 1 1 0\n   vertex 0 0 1.5\n  endloop\n endfacet\n facet normal 0 1 0\n  outer loop\n   vertex 1 1 0\n   vertex -1 1 0\n   vertex 0 0 1.5\n  endloop\n endfacet\n facet normal -1 0 0\n  outer loop\n   vertex -1 1 0\n   vertex -1 -1 0\n   vertex 0 0 1.5\n  endloop\n endfacet\nendsolid pyramid\n');
  await register('11-model-3d/pyramid.stl', 'ASCII STL geometry and normals');
  await write('11-model-3d/colored-triangle.ply', 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n-1 -1 0 255 80 80\n1 -1 0 80 180 120\n0 1 0 70 130 220\n3 0 1 2\n');
  await register('11-model-3d/colored-triangle.ply', 'PLY vertex colors and mesh geometry');
  await write('11-model-3d/scene.dae', colladaDocument());
  await register('11-model-3d/scene.dae', 'COLLADA geometry and material');
  await write('11-model-3d/scene.wrl', '#VRML V2.0 utf8\nShape { appearance Appearance { material Material { diffuseColor 0.1 0.6 0.7 } } geometry Box { size 2 1 1 } }\nTransform { translation 0 1.2 0 children [ Shape { geometry Sphere { radius 0.55 } appearance Appearance { material Material { diffuseColor 0.9 0.35 0.3 } } } ] }\n');
  await register('11-model-3d/scene.wrl', 'VRML box, sphere, transforms, and materials');
  await write('11-model-3d/scene.usda', '#usda 1.0\n( defaultPrim = "Preview" )\ndef Xform "Preview" {\n  def Cube "Base" { double size = 2 color3f[] primvars:displayColor = [(0.1, 0.6, 0.7)] }\n  def Sphere "Marker" { double radius = 0.45 double3 xformOp:translate = (0, 1.4, 0) uniform token[] xformOpOrder = ["xformOp:translate"] }\n}\n');
  await register('11-model-3d/scene.usda', 'USD ASCII hierarchy and primitives');
  await create3mf('11-model-3d/triangle.3mf');
  await register('11-model-3d/triangle.3mf', '3MF OPC container and colored mesh');
}

function gltfDocument(uri) {
  return { asset: { version: '2.0', generator: 'Moss preview sample generator' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Preview triangle' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }], materials: [{ name: 'Moss teal', pbrMetallicRoughness: { baseColorFactor: [0.07, 0.55, 0.48, 1], metallicFactor: 0.1, roughnessFactor: 0.65 } }], buffers: [{ ...(uri ? { uri } : {}), byteLength: 44 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }, { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -0.8, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }] };
}

function createGlb(json, binary) {
  const jsonRaw = Buffer.from(JSON.stringify(json));
  const jsonPadding = Buffer.alloc((4 - (jsonRaw.length % 4)) % 4, 0x20);
  const binPadding = Buffer.alloc((4 - (binary.length % 4)) % 4);
  const total = 12 + 8 + jsonRaw.length + jsonPadding.length + 8 + binary.length + binPadding.length;
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonRaw.length + jsonPadding.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length + binPadding.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonRaw, jsonPadding, binHeader, binary, binPadding]);
}

function colladaDocument() {
  return `<?xml version="1.0"?><COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><up_axis>Y_UP</up_axis></asset><library_geometries><geometry id="triangle"><mesh><source id="positions"><float_array id="positions-array" count="9">-1 -1 0 1 -1 0 0 1 0</float_array><technique_common><accessor source="#positions-array" count="3" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="vertices"><input semantic="POSITION" source="#positions"/></vertices><triangles count="1"><input semantic="VERTEX" source="#vertices" offset="0"/><p>0 1 2</p></triangles></mesh></geometry></library_geometries><library_visual_scenes><visual_scene id="Scene"><node id="Preview"><instance_geometry url="#triangle"/></node></visual_scene></library_visual_scenes><scene><instance_visual_scene url="#Scene"/></scene></COLLADA>`;
}

async function create3mf(relativePath) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  zip.file('3D/3dmodel.model', '<?xml version="1.0"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><basematerials id="2"><base name="Moss teal" displaycolor="#149680FF"/></basematerials><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="30" y="0" z="0"/><vertex x="15" y="25" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" pid="2" p1="0"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>');
  await write(relativePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function generateGis() {
  const geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Shanghai preview point', kind: 'marker' }, geometry: { type: 'Point', coordinates: [121.4737, 31.2304] } }, { type: 'Feature', properties: { name: 'Offline route', kind: 'route' }, geometry: { type: 'LineString', coordinates: [[121.458, 31.222], [121.4737, 31.2304], [121.491, 31.241]] } }, { type: 'Feature', properties: { name: 'Preview zone', kind: 'area' }, geometry: { type: 'Polygon', coordinates: [[[121.465, 31.225], [121.485, 31.225], [121.485, 31.238], [121.465, 31.238], [121.465, 31.225]]] } }] };
  await write('12-gis/shanghai.geojson', JSON.stringify(geojson, null, 2));
  await register('12-gis/shanghai.geojson', 'Offline Leaflet point, route, polygon, and properties');
  const topo = { type: 'Topology', transform: { scale: [0.001, 0.001], translate: [121.45, 31.22] }, objects: { route: { type: 'LineString', arcs: [0], properties: { name: 'Delta-encoded route' } }, zone: { type: 'Polygon', arcs: [[1]], properties: { name: 'Preview zone' } } }, arcs: [[[0, 0], [20, 8], [18, 11]], [[10, 5], [20, 0], [0, 15], [-20, 0], [0, -15]]] };
  await write('12-gis/shanghai.topojson', JSON.stringify(topo, null, 2));
  await register('12-gis/shanghai.topojson', 'TopoJSON topology and delta-encoded geometry');
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Moss Offline Map</name><Style id="route"><LineStyle><color>ff7a6b12</color><width>5</width></LineStyle></Style><Placemark><name>Shanghai preview point</name><Point><coordinates>121.4737,31.2304,0</coordinates></Point></Placemark><Placemark><name>Offline route</name><styleUrl>#route</styleUrl><LineString><coordinates>121.458,31.222,0 121.4737,31.2304,0 121.491,31.241,0</coordinates></LineString></Placemark></Document></kml>`;
  await write('12-gis/shanghai.kml', kml);
  await register('12-gis/shanghai.kml', 'KML placemarks, route, and style');
  const kmz = new JSZip(); kmz.file('doc.kml', kml);
  await write('12-gis/shanghai.kmz', await kmz.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  await register('12-gis/shanghai.kmz', 'Compressed KML container');
  await write('12-gis/route.gpx', '<?xml version="1.0"?><gpx version="1.1" creator="Moss preview generator" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Shanghai offline route</name></metadata><wpt lat="31.2304" lon="121.4737"><name>Preview point</name></wpt><trk><name>Acceptance route</name><trkseg><trkpt lat="31.222" lon="121.458"><ele>4</ele></trkpt><trkpt lat="31.2304" lon="121.4737"><ele>6</ele></trkpt><trkpt lat="31.241" lon="121.491"><ele>5</ele></trkpt></trkseg></trk></gpx>');
  await register('12-gis/route.gpx', 'GPX waypoint and track');
  await createPointShapefile('12-gis/landmark');
  await register('12-gis/landmark.shp', 'ESRI Shapefile point geometry', 'Keep landmark.shx and landmark.dbf beside the SHP');
}

async function createPointShapefile(relativeBase) {
  const x = 121.4737;
  const y = 31.2304;
  const header = (fileLengthWords) => {
    const buffer = Buffer.alloc(100);
    buffer.writeInt32BE(9994, 0); buffer.writeInt32BE(fileLengthWords, 24);
    buffer.writeInt32LE(1000, 28); buffer.writeInt32LE(1, 32);
    buffer.writeDoubleLE(x, 36); buffer.writeDoubleLE(y, 44); buffer.writeDoubleLE(x, 52); buffer.writeDoubleLE(y, 60);
    return buffer;
  };
  const record = Buffer.alloc(28); record.writeInt32BE(1, 0); record.writeInt32BE(10, 4); record.writeInt32LE(1, 8); record.writeDoubleLE(x, 12); record.writeDoubleLE(y, 20);
  await write(`${relativeBase}.shp`, Buffer.concat([header(64), record]));
  const indexRecord = Buffer.alloc(8); indexRecord.writeInt32BE(50, 0); indexRecord.writeInt32BE(10, 4);
  await write(`${relativeBase}.shx`, Buffer.concat([header(54), indexRecord]));
  const dbf = Buffer.alloc(32 + 32 + 1 + 32 + 1, 0x20);
  dbf[0] = 0x03; dbf[1] = 126; dbf[2] = 9; dbf[3] = 14; dbf.writeUInt32LE(1, 4); dbf.writeUInt16LE(65, 8); dbf.writeUInt16LE(33, 10);
  Buffer.from('NAME').copy(dbf, 32); dbf[32 + 11] = 'C'.charCodeAt(0); dbf[32 + 16] = 32; dbf[64] = 0x0d; dbf[65] = 0x20; Buffer.from('Shanghai preview point').copy(dbf, 66); dbf[dbf.length - 1] = 0x1a;
  await write(`${relativeBase}.dbf`, dbf);
}

async function writeDocumentation() {
  skipped.push(
    { format: '7z', reason: 'No 7-Zip writer is installed; OFV currently provides structure-level support only.' },
    { format: 'MSG', reason: 'No trustworthy Outlook MSG authoring library is installed; EML and MBOX cover the email parser.' },
    { format: 'JXL', reason: 'The installed ImageMagick build has no JPEG XL encoder.' },
    { format: 'Parquet', reason: 'No Parquet writer is installed; an invalid PAR1 shell would not be a useful preview test.' },
    { format: 'FBX/3DS/USDC/USDZ', reason: 'No trusted local exporter is available; text and OPC 3D samples cover the bundled model viewer.' },
    { format: 'DWF/SKP/3DM/SolidWorks', reason: 'Proprietary samples are unavailable and OFV only promises structure-level preview.' },
  );
  const csvHeader = ['file', 'extension', 'moss route', 'test purpose', 'notes', 'open directly', 'bytes'];
  const csvRows = records.map((record) => [record.file, record.extension, record.route, record.purpose, record.notes, record.testable ? 'yes' : 'no', record.bytes]);
  await write('MANIFEST.csv', [csvHeader, ...csvRows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n');
  await write('NOT-GENERATED.md', `# Formats not generated\n\nThese are intentionally omitted rather than represented by fake files with renamed extensions.\n\n${skipped.map((item) => `- **${item.format}**: ${item.reason.replaceAll('\n', ' ')}`).join('\n')}\n`);
  const categoryCounts = new Map();
  for (const record of records.filter((item) => item.testable)) {
    const category = record.file.split('/')[0];
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  }
  const routeCounts = new Map();
  for (const record of records.filter((item) => item.testable)) {
    routeCounts.set(record.route, (routeCounts.get(record.route) || 0) + 1);
  }
  const readme = `# Moss file preview test suite\n\nGenerated on 2026-09-14. The suite contains **${records.filter((item) => item.testable).length} directly testable files**. Samples contain visible text, colors, tables, multiple pages, audio/video, nested archive entries, email attachments, diagrams, CAD entities, 3D meshes, or GIS features.\n\n## How to test\n\n1. Open this directory as a Moss workspace.\n2. Open files in numeric directory order.\n3. Compare the displayed route/capability badge with \`MANIFEST.csv\`.\n4. Keep companion resources beside HLS, OBJ, and SHP primary files.\n5. Disconnect networking and repeat representative OFV tests to verify offline behavior.\n\n## Coverage by directory\n\n| Directory | Directly testable files |\n|---|---:|\n${[...categoryCounts].map(([name, count]) => `| \`${name}\` | ${count} |`).join('\n')}\n\n## Routes expected from current Moss code\n\n| Route | Files |\n|---|---:|\n${[...routeCounts].map(([name, count]) => `| ${name} | ${count} |`).join('\n')}\n\n## Important limits\n\n- A generated file proves that the parser path can be exercised; it does not guarantee pixel-perfect rendering of every producer's files.\n- DWG uses a real OFV regression sample, but the current default Moss build only promises structure/fallback preview without the optional enhanced engine.\n- Browser codec availability still determines whether compatibility media containers play or show a conversion hint.\n- GIS vector layers work offline; online map tiles are not part of the test.\n- See \`NOT-GENERATED.md\` for formats omitted because this machine has no trustworthy writer or real sample.\n`;
  await write('README.md', readme);
}

async function main() {
  if (force) await rm(outputRoot, { recursive: true, force: true });
  try {
    await mkdir(outputRoot, { recursive: false });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`Output already exists: ${outputRoot}. Use --force to regenerate it.`);
    throw error;
  }
  await generateTextAndCode();
  await generateImages();
  await generateOffice();
  await generateMedia();
  await generateEbooksAndFixedDocs();
  await generateArchives();
  await generateEmailAndDrawings();
  await generateAssets();
  await generateCad();
  await generateModels();
  await generateGis();
  await writeDocumentation();
  console.log(JSON.stringify({ outputRoot, files: records.filter((item) => item.testable).length, resources: records.filter((item) => !item.testable).length, skipped: skipped.length }, null, 2));
}

await main();
