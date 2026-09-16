import { describe, expect, it } from 'bun:test';

import {
  previewFileFromPayload,
  syncPreviewTabs,
  upsertPreviewTab,
} from '../src/renderer-react/lib/preview-window-state';
import type { WorkspacePreviewData } from '../src/renderer-react/types';

function file(path: string, content: string, dirty = false): WorkspacePreviewData {
  return {
    path,
    relativePath: path.split('/').pop() || path,
    content,
    contentType: 'text',
    metadata: { dirty },
  };
}

describe('preview window state', () => {
  it('normalizes legacy content previews into a virtual tab', () => {
    expect(previewFileFromPayload({
      content: '# Release notes',
      contentType: 'markdown',
      metadata: { title: 'Release notes', language: 'markdown' },
    })).toMatchObject({
      path: 'preview:markdown:Release notes',
      relativePath: 'Release notes',
      content: '# Release notes',
      contentType: 'markdown',
      language: 'markdown',
      truncated: false,
    });
  });

  it('activates an existing clean file with its latest content', () => {
    expect(upsertPreviewTab(
      [file('/workspace/report.txt', 'old')],
      file('/workspace/report.txt', 'new'),
    )[0].content).toBe('new');
  });

  it('does not overwrite unsaved edits during workspace refresh', () => {
    const result = syncPreviewTabs(
      [file('/workspace/report.txt', 'draft', true)],
      [file('/workspace/report.txt', 'disk value')],
    );
    expect(result[0]).toMatchObject({
      content: 'draft',
      metadata: { dirty: true },
    });
  });

  it('adds newly opened files without replacing other preview tabs', () => {
    const result = upsertPreviewTab(
      [file('/workspace/a.txt', 'a')],
      file('/workspace/b.txt', 'b'),
    );
    expect(result.map((entry) => entry.path)).toEqual([
      '/workspace/a.txt',
      '/workspace/b.txt',
    ]);
  });
});
