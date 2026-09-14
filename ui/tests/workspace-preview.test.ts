import { describe, expect, it } from 'bun:test';

import {
  decodeWorkspaceTextBuffer,
  getWorkspaceFilePreviewInfo,
  isBinaryPreviewContentType,
  isLikelyBinaryBuffer,
  MAX_WORKSPACE_TEXT_PREVIEW_BYTES,
} from '../../shared/workspace-preview.mjs';

describe('workspace preview contract', () => {
  it('classifies the supported preview families', () => {
    expect(getWorkspaceFilePreviewInfo('/tmp/photo.tiff')).toMatchObject({
      contentType: 'ofv',
      mimeType: 'image/tiff',
      previewEngine: 'open-file-viewer',
      previewFamily: 'image',
      previewCapability: 'full',
      binary: true,
    });
    expect(getWorkspaceFilePreviewInfo('/tmp/report.docm')).toMatchObject({ contentType: 'word' });
    expect(getWorkspaceFilePreviewInfo('/tmp/data.tsv')).toMatchObject({ contentType: 'excel' });
    expect(getWorkspaceFilePreviewInfo('/tmp/deck.ppsx')).toMatchObject({ contentType: 'ppt' });
    expect(getWorkspaceFilePreviewInfo('/tmp/source.tsx')).toMatchObject({ contentType: 'code', language: 'tsx' });
  });

  it('routes OFV-only formats with an honest capability level', () => {
    expect(getWorkspaceFilePreviewInfo('/tmp/book.epub')).toMatchObject({
      contentType: 'ofv', previewFamily: 'ebook', previewCapability: 'full', binary: true,
    });
    expect(getWorkspaceFilePreviewInfo('/tmp/archive.rar')).toMatchObject({
      contentType: 'ofv', previewFamily: 'archive-structure', previewCapability: 'structure', binary: true,
    });
    expect(getWorkspaceFilePreviewInfo('/tmp/model.sldprt')).toMatchObject({
      contentType: 'ofv', previewFamily: 'cad-structure', previewCapability: 'structure', binary: true,
    });
    expect(getWorkspaceFilePreviewInfo('/tmp/diagram.mermaid')).toMatchObject({
      contentType: 'ofv', previewFamily: 'rich-text', previewCapability: 'full', binary: false,
    });
  });

  it('keeps shared formats on Moss until their product routing is selected', () => {
    expect(getWorkspaceFilePreviewInfo('/tmp/report.pdf')).toMatchObject({ contentType: 'pdf' });
    expect(getWorkspaceFilePreviewInfo('/tmp/photo.png')).toMatchObject({ contentType: 'image' });
    expect(getWorkspaceFilePreviewInfo('/tmp/report.docx')).toMatchObject({ contentType: 'word' });
    expect(getWorkspaceFilePreviewInfo('/tmp/data.csv')).toMatchObject({ contentType: 'excel' });
  });

  it('treats unknown extensions as text until binary detection proves otherwise', () => {
    expect(getWorkspaceFilePreviewInfo('/tmp/README.notes')).toEqual({
      contentType: 'text',
      language: 'text',
      mimeType: 'text/plain',
    });
  });

  it('keeps binary preview types and text limit explicit', () => {
    expect(isBinaryPreviewContentType('pdf')).toBe(true);
    expect(isBinaryPreviewContentType('text')).toBe(false);
    expect(MAX_WORKSPACE_TEXT_PREVIEW_BYTES).toBe(600 * 1024);
  });

  it('distinguishes UTF-8 text from unknown binary content', () => {
    expect(isLikelyBinaryBuffer(Buffer.from('hello, 世界\n'))).toBe(false);
    expect(isLikelyBinaryBuffer(Buffer.from([0xff, 0xfe, 0x00, 0x01]))).toBe(true);
  });

  it('does not turn a UTF-8 character split at the preview boundary into binary or replacement text', () => {
    const prefix = Buffer.concat([Buffer.alloc(64 * 1024 - 1, 0x61), Buffer.from('世')]);
    expect(isLikelyBinaryBuffer(prefix)).toBe(false);
    expect(decodeWorkspaceTextBuffer(prefix.subarray(0, 64 * 1024), true)).not.toEndWith('\ufffd');
  });
});
