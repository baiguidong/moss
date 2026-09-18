import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const SCREENSHOT_MEDIA = Object.freeze({
  'image/png': { extension: '.png', mediaType: 'image/png' },
  'image/jpeg': { extension: '.jpg', mediaType: 'image/jpeg' },
});

export async function persistBrowserSnapshotArtifact({
  workspace,
  imageBase64,
  imageMediaType,
  now = Date.now(),
  id = randomUUID(),
} = {}) {
  if (typeof workspace !== 'string' || !workspace.trim()) {
    throw new Error('Session workspace is required to save a browser screenshot.');
  }
  if (typeof imageBase64 !== 'string' || !imageBase64.trim()) {
    throw new Error('Browser screenshot data is missing.');
  }
  const media = SCREENSHOT_MEDIA[imageMediaType];
  if (!media) {
    throw new Error(`Unsupported browser screenshot media type: ${imageMediaType || 'unknown'}`);
  }
  const bytes = Buffer.from(imageBase64, 'base64');
  if (bytes.length === 0) throw new Error('Browser screenshot data is empty.');

  const screenshotDir = path.join(path.resolve(workspace), 'screenshots');
  const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'capture';
  const filePath = path.join(screenshotDir, `browser-${timestamp}-${safeId}${media.extension}`);
  await fsp.mkdir(screenshotDir, { recursive: true });
  await fsp.writeFile(filePath, bytes, { flag: 'wx' });

  const previewUrl = `moss-media://local/${encodeURIComponent(filePath)}`;
  return {
    fileKind: 'image',
    filePath,
    filePaths: [filePath],
    previewUrl,
    previewMarkdown: `![browser screenshot](${previewUrl})`,
    mediaType: media.mediaType,
  };
}
