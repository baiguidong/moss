import fs from 'node:fs/promises';
import path from 'node:path';

// Keep original bytes (including Office formulas and native objects), not the PDF preview.
export async function savePreviewFile(input, showSaveDialog) {
  try {
    if (typeof input?.sourcePath !== 'string' || !path.isAbsolute(input.sourcePath)) throw new Error('没有可保存的原始文件。');
    const sourcePath = await fs.realpath(input.sourcePath), source = await fs.stat(sourcePath);
    if (!source.isFile()) throw new Error('只能保存文件。');
    const name = path.basename(input.defaultPath || sourcePath);
    const extension = path.extname(sourcePath).slice(1);
    const result = await showSaveDialog({ title: '另存为', defaultPath: name, ...(extension ? { filters: [{ name: extension.toUpperCase(), extensions: [extension] }] } : {}) });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const destination = await fs.stat(result.filePath).catch(() => null);
    if (!destination || source.dev !== destination.dev || source.ino !== destination.ino) await fs.copyFile(sourcePath, result.filePath);
    return { ok: true, canceled: false, path: result.filePath };
  } catch (error) { return { ok: false, canceled: false, error: error instanceof Error ? error.message : String(error) }; }
}
