import { afterEach, describe, expect, it } from 'bun:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

import { conversionService } from '../src/process/services/conversion-service.mjs';

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => fsp.rm(target, { recursive: true, force: true })));
});

function slideXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:cSld><p:spTree><p:pic><p:blipFill><a:blip r:embed="rId1" /></p:blipFill></p:pic></p:spTree></p:cSld>
    </p:sld>`;
}

function slideRels(imageName: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${imageName}" />
    </Relationships>`;
}

describe('conversion service', () => {
  it('resolves duplicate relationship ids within each PowerPoint slide', async () => {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-conversion-test-'));
    cleanupPaths.push(tempDir);
    const filePath = path.join(tempDir, 'relationships.pptx');
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', slideXml());
    zip.file('ppt/slides/slide2.xml', slideXml());
    zip.file('ppt/slides/_rels/slide1.xml.rels', slideRels('first.png'));
    zip.file('ppt/slides/_rels/slide2.xml.rels', slideRels('second.png'));
    zip.file('ppt/media/first.png', Buffer.from([1]));
    zip.file('ppt/media/second.png', Buffer.from([2]));
    await fsp.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await conversionService.pptToJson(filePath);

    expect(result.success).toBe(true);
    expect(result.data?.slides[0].content.elements).toContainEqual({ type: 'image', ref: 'first.png' });
    expect(result.data?.slides[1].content.elements).toContainEqual({ type: 'image', ref: 'second.png' });
  });

  it('rejects oversized files before fallback parsers read them into memory', async () => {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-conversion-test-'));
    cleanupPaths.push(tempDir);
    const filePath = path.join(tempDir, 'large.docx');
    await fsp.writeFile(filePath, '');
    await fsp.truncate(filePath, 100 * 1024 * 1024 + 1);

    await expect(conversionService.readFallbackBuffer(filePath)).rejects.toThrow('too large');
  });
});
