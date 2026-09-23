import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppInstallProgressView } from '../src/renderer-react/components/app-install-progress';
import { isAppInstallActive } from '../src/renderer-react/lib/app-install-progress';
import type { AppInstallProgress } from '../src/renderer-react/types';

function renderProgress(patch: Partial<AppInstallProgress>) {
  return renderToStaticMarkup(<AppInstallProgressView progress={{ source: 'marketplace', appId: 'example.app', phase: 'downloading', ...patch }} />);
}

describe('App installation progress', () => {
  test('shows actual download percentage and transferred size', () => {
    const markup = renderProgress({ receivedBytes: 32 * 1024 ** 2, totalBytes: 128 * 1024 ** 2 });
    expect(markup).toContain('25% · 32.0 MB / 128.0 MB');
    expect(markup).toContain('aria-valuenow="25"');
    expect(markup).toContain('正在下载');
  });

  test('does not invent a percentage when the download total is unknown', () => {
    const markup = renderProgress({ receivedBytes: 1024, totalBytes: null });
    expect(markup).toContain('1.0 KB');
    expect(markup).not.toContain('aria-valuenow');
    expect(markup).not.toContain('NaN');
  });

  test('shows the next installation stage after all bytes are downloaded', () => {
    const markup = renderProgress({ phase: 'extracting', receivedBytes: 1024, totalBytes: 1024 });
    expect(markup).toContain('正在解压安装包');
    expect(markup).toContain('role="progressbar"');
    expect(markup).not.toContain('aria-valuenow="100"');
    expect(markup).not.toContain('安装完成');
  });

  test('stops waiting on success, failure and cancellation', () => {
    for (const phase of ['completed', 'error', 'canceled'] as const) {
      expect(isAppInstallActive({ source: 'local', appId: 'example.app', phase })).toBe(false);
      expect(renderProgress({ phase })).not.toContain('role="progressbar"');
    }
    expect(renderProgress({ phase: 'error', error: 'Download timeout' })).toContain('Download timeout');
    expect(renderProgress({ phase: 'canceled' })).toBe('');
  });
});
