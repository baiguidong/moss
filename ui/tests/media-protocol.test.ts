import { describe, expect, it } from 'bun:test';
import path from 'node:path';

import { decodeMediaRequestPath } from '../src/media-protocol.mjs';
import { createOfflinePreviewUrl } from '../src/renderer-react/components/preview/viewers/offline-preview-url';

describe('offline workspace media URLs', () => {
  it('preserves workspace-relative paths for adjacent preview resources', () => {
    const source = createOfflinePreviewUrl('/workspace/models/demo/scene.gltf', '/workspace');
    expect(decodeMediaRequestPath(source)).toBe(path.resolve('/workspace/models/demo/scene.gltf'));

    const texture = new URL('textures/base color.png', source).toString();
    expect(decodeMediaRequestPath(texture)).toBe(path.resolve('/workspace/models/demo/textures/base color.png'));
  });

  it('supports Windows-style paths in renderer-generated URLs', () => {
    const source = createOfflinePreviewUrl('C:\\work\\models\\scene.glb', 'C:\\work');
    expect(source).toContain('moss-media://workspace/');
    expect(source).toContain('models/scene.glb');
  });

  it('rejects malformed workspace media URLs without a file path', () => {
    expect(() => decodeMediaRequestPath('moss-media://workspace/%2Fworkspace')).toThrow();
  });
});
