import { describe, expect, it } from 'bun:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { persistBrowserSnapshotArtifact } from '../src/browser-snapshot-artifact.mjs';

describe('browser snapshot artifact', () => {
  it('persists the captured bytes as a workspace image with conversation markdown', async () => {
    const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-browser-snapshot-'));
    try {
      const artifact = await persistBrowserSnapshotArtifact({
        workspace,
        imageBase64: Buffer.from('actual-browser-pixels').toString('base64'),
        imageMediaType: 'image/png',
        now: Date.parse('2026-09-18T01:02:03.000Z'),
        id: 'snapshot-123',
      });

      expect(artifact).toMatchObject({
        fileKind: 'image',
        mediaType: 'image/png',
        filePaths: [artifact.filePath],
      });
      expect(artifact.filePath).toBe(path.join(
        workspace,
        'screenshots',
        'browser-2026-09-18T01-02-03-000Z-snapshot-123.png',
      ));
      expect(await fsp.readFile(artifact.filePath, 'utf8')).toBe('actual-browser-pixels');
      expect(artifact.previewMarkdown).toBe(`![browser screenshot](${artifact.previewUrl})`);
    } finally {
      await fsp.rm(workspace, { recursive: true, force: true });
    }
  });
});
