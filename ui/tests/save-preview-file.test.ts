import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { savePreviewFile } from '../src/process/services/save-preview-file.mjs';

test('Save As copies original binary bytes and cancellation leaves files untouched', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-save-preview-'));
  try {
    const sourcePath = path.join(dir, '报告.pptx'), destination = path.join(dir, '副本.pptx');
    const bytes = Buffer.from([80, 75, 3, 4, 0, 255, 128, 20]);
    await fs.writeFile(sourcePath, bytes);
    let options;
    expect(await savePreviewFile({ sourcePath, defaultPath: '销售汇报.pptx' }, async value => { options = value; return { filePath: destination }; })).toMatchObject({ ok: true, path: destination });
    expect(options).toMatchObject({ defaultPath: '销售汇报.pptx', filters: [{ extensions: ['pptx'] }] });
    expect(await fs.readFile(destination)).toEqual(bytes);
    expect(await savePreviewFile({ sourcePath }, async () => ({ canceled: true }))).toEqual({ ok: false, canceled: true });
    expect(await savePreviewFile({ sourcePath }, async () => ({ filePath: sourcePath }))).toMatchObject({ ok: true });
    expect(await fs.readFile(sourcePath)).toEqual(bytes);
    expect(await savePreviewFile({ sourcePath }, async () => ({ filePath: path.join(dir, 'absent', 'file.pptx') }))).toMatchObject({ ok: false, canceled: false });
    let shown = false;
    expect(await savePreviewFile({ sourcePath: dir }, async () => { shown = true; return {}; })).toMatchObject({ ok: false });
    expect(shown).toBe(false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
