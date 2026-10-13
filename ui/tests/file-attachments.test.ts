import { expect, test } from 'bun:test';
import { collectFileAttachments, mergeFileAttachments } from '../src/renderer-react/lib/file-attachments';
import { fileActionCapabilities, performFileAction } from '../src/renderer-react/lib/file-actions';
import { buildFileAttachmentPrompt } from '../src/session-prompt-preparation.mjs';

function host(paths = new Map<File, string>()) {
  const writes: unknown[] = [];
  return { writes, getPathForFile: (file: File) => paths.get(file) || '',
    getFileMetadata: async (_path: string) => ({ size: 0, isFile: true }),
    createTempFile: async (name: string) => `/tmp/${name}`,
    writeFile: async (path: string, bytes: number[]) => { writes.push([path, bytes]); return true; },
  };
}

test('native file references preserve exact paths and deduplicate across sources without reading content', async () => {
  const file = new File([''], '报告 (1).pdf');
  const nativePath = '/Users/example/含 空格/报告 (1).pdf';
  const fs = host(new Map([[file, nativePath]]));
  const result = await collectFileAttachments([file, file], fs);
  expect(result.errors).toEqual([]);
  expect(result.attachments).toEqual([{ name: file.name, path: nativePath }]);
  expect(fs.writes).toEqual([]);
  expect(mergeFileAttachments(result.attachments, result.attachments)).toEqual(result.attachments);
});

test('browser and clipboard files of any type are materialized, including zero-byte files', async () => {
  const fs = host();
  const result = await collectFileAttachments([new File(['a,b'], 'table.csv'), new File([], 'empty.txt')], fs);
  expect(result.errors).toEqual([]);
  expect(result.attachments.map(file => file.path)).toEqual(['/tmp/table.csv', '/tmp/empty.txt']);
  expect(fs.writes).toEqual([['/tmp/table.csv', [97, 44, 98]], ['/tmp/empty.txt', []]]);
});

test('reports failed saves, unavailable files and directories instead of silently adding them', async () => {
  const file = new File([''], 'missing.txt');
  const fs = host();
  fs.writeFile = async () => false;
  expect((await collectFileAttachments([file], fs)).errors[0]).toContain('无法保存');
  const native = host(new Map([[file, '/missing.txt']]));
  native.getFileMetadata = async () => ({ size: 0, isFile: false });
  const rejected = await collectFileAttachments([file], native);
  expect(rejected.attachments).toEqual([]);
  expect(rejected.errors).toHaveLength(1);
});

test('file actions use the same preview reader for local, remote and App references', async () => {
  const calls: unknown[] = [];
  const api = { preview: { readFile: async (payload: unknown) => { calls.push(payload); return { path: '/resolved', metadata: {} }; },
    open: async (payload: unknown) => { calls.push(payload); return { ok: true }; } } } as any;
  await performFileAction('/some/file.pdf', 'preview', api);
  expect(calls[0]).toEqual({ filePath: '/some/file.pdf' });
  expect((calls[1] as any).file.metadata.previewEditable).toBe(false);
  const remote = 'moss-remote-workspace://session/s/report.pdf';
  expect(fileActionCapabilities(remote)).toEqual({ preview: true, system: false, reveal: false });
  await expect(performFileAction(remote, 'system', api)).rejects.toThrow('不支持');
});

test('model attachment input contains paths only, including images and names with spaces', () => {
  expect(buildFileAttachmentPrompt([])).toBe('');
  const prompt = buildFileAttachmentPrompt(['/work/报告.pdf', '/work/my image.png']);
  expect(prompt).toContain('- /work/报告.pdf');
  expect(prompt).toContain('- /work/my image.png');
  expect(prompt).not.toContain('base64');
  expect(prompt).toContain('Read tool');
});
