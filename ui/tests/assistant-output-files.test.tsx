import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAssistantOutputFiles, extractAssistantOutputFiles, isOutputInsideWorkspace, normalizeOutputPath } from "../src/renderer-react/lib/assistant-output-files";
import { AssistantMessage } from "../src/renderer-react/components/chat/assistant-message";
import { openAssistantOutputFile } from "../src/renderer-react/components/chat/assistant-output-file-card";
import type { TranscriptRenderMessage } from "../src/renderer-react/lib/agent-transcript";

test("generated Markdown files use the actual writes and are deduplicated against prose", () => {
  const files = extractAssistantOutputFiles("已生成 `WELCOME.md` 和 [欢迎](WELCOME.md)。", "/workspace", ["/workspace/docs/WELCOME.md", "/workspace/.memory/user_beginner.md", "/workspace/.memory/MEMORY.md", "/workspace/src/app.ts"]);
  expect(files.map((file) => file.path)).toEqual(["/workspace/docs/WELCOME.md", "/workspace/.memory/user_beginner.md", "/workspace/.memory/MEMORY.md"]);
  expect(files[0]).toMatchObject({ name: "WELCOME.md", subtitle: "docs/WELCOME.md", type: "MARKDOWN" });
});

test("Markdown links, reference links, plain paths and paths containing spaces are supported", () => {
  const content = '[报告](<./我的 报告.pdf>)，另一个文件：/tmp/report.docx:12\n\n[下载][report]\n\n[report]: file:///workspace/%E5%AF%BC%E5%87%BA.xlsx';
  expect(extractAssistantOutputFiles(content, "/workspace").map((file) => file.path)).toEqual(["/workspace/我的 报告.pdf", "/tmp/report.docx", "/workspace/导出.xlsx"]);
});

test("code samples, external URLs, and unmodified source files do not generate cards", () => {
  expect(extractAssistantOutputFiles('```md\n[示例](demo.md)\n```\n\nhttps://example.com/report.pdf\n\n[下载](https://example.com/report.pdf)\n\n`src/app.ts`', "/workspace")).toEqual([]);
});

test("ambiguous basenames never pick the wrong generated file", () => {
  const files = extractAssistantOutputFiles("`report.pdf`", "/workspace", ["/workspace/a/report.pdf", "/workspace/b/report.pdf"]);
  expect(files.map((file) => file.path)).toEqual(["/workspace/a/report.pdf", "/workspace/b/report.pdf"]);
  expect(extractAssistantOutputFiles("`/tmp/report.pdf`", "/workspace", ["/workspace/report.pdf"])[0].path).toBe("/tmp/report.pdf");
});

test("paths normalize line references and Windows separators without accepting URL schemes", () => {
  expect(normalizeOutputPath('C:\\work\\docs\\..\\report.md:12:4')).toBe('C:/work/report.md');
  expect(normalizeOutputPath('file:///C:/work/report.md')).toBe('C:/work/report.md');
  expect(normalizeOutputPath('～/report.md')).toBe('~/report.md');
  expect(normalizeOutputPath('javascript:alert(1)', '/workspace')).toBeNull();
  expect(normalizeOutputPath('relative.md')).toBeNull();
  expect(isOutputInsideWorkspace('/workspace/report.md', '')).toBe(false);
  expect(isOutputInsideWorkspace('/workspace-other/report.md', '/workspace')).toBe(false);
});

const timestamp = new Date(0);
const history: TranscriptRenderMessage[] = [
  { id: 'user-1', type: 'user_text', role: 'user', content: '生成文档', timestamp },
  { id: 'progress', type: 'assistant_text', role: 'assistant', content: '正在生成', timestamp },
  { id: 'write', type: 'tool_use', role: 'assistant', toolUseId: 'write-1', toolName: 'Write', displayName: 'Write', status: 'success', input: { file_path: '/workspace/WELCOME.md' }, timestamp },
  { id: 'failed', type: 'tool_use', role: 'assistant', toolUseId: 'write-2', toolName: 'Write', displayName: 'Write', status: 'error', input: { file_path: '/workspace/failed.md' }, timestamp },
  { id: 'final', type: 'assistant_text', role: 'assistant', content: '文件已生成。', timestamp },
];

test("only the last reply owns successful outputs, scoped to its turn", () => {
  const files = buildAssistantOutputFiles([...history, { id: 'user-2', type: 'user_text', role: 'user', content: '你好', timestamp }, { id: 'reply-2', type: 'assistant_text', role: 'assistant', content: '你好', timestamp }], '/workspace');
  expect(files.has('progress')).toBe(false);
  expect(files.get('final')?.map((file) => file.name)).toEqual(['WELCOME.md']);
  expect(files.get('reply-2')).toEqual([]);
});

test("streaming replies wait for completion and checkpoints supply unmentioned files", () => {
  expect(buildAssistantOutputFiles([...history.slice(0, -1), { ...history.at(-1)!, streaming: true } as TranscriptRenderMessage], '/workspace').has('final')).toBe(false);
  const changes = new Map([['user-1', { userMessageId: 'user-1', files: [{ filePath: '/workspace/checkpoint.pdf', isNewFile: true, structuredPatch: [], additions: 1, deletions: 0 }], stats: { filesChanged: 1, additions: 1, deletions: 0 }, hasUnverifiedChanges: false }]]);
  expect(buildAssistantOutputFiles(history, '/workspace', changes).get('final')?.map((file) => file.name)).toEqual(['WELCOME.md', 'checkpoint.pdf']);
});

test("assistant output cards sit under the response and before message actions", () => {
  const message = history.at(-1)! as Extract<TranscriptRenderMessage, { type: 'assistant_text' }>;
  const markup = renderToStaticMarkup(<AssistantMessage message={{ ...message, attachments: [{ kind: 'file', path: './WELCOME.md' }] }} outputFiles={buildAssistantOutputFiles(history, '/workspace').get('final')} sessionId="s1" workspace="/workspace" />);
  expect(markup.indexOf('文件已生成')).toBeLessThan(markup.indexOf('生成的文件：WELCOME.md'));
  expect(markup.indexOf('生成的文件：WELCOME.md')).toBeLessThan(markup.indexOf('复制回复'));
  expect(markup).toContain('MARKDOWN');
  expect(markup).toContain('打开方式');
  expect(markup).not.toContain('max-w-[150px]');
});

test("default opening always uses Moss preview, including files outside the workspace", async () => {
  const calls: unknown[] = [];
  const host = {
    preview: {
      readFile: async (payload: unknown) => { calls.push(['read', payload]); return { path: '/workspace/report.md', content: '# report', relativePath: 'report.md', contentType: 'markdown', metadata: { remote: true } }; },
      open: async (payload: unknown) => { calls.push(['preview', payload]); },
    },
    shell: { openFile: async (path: string) => { calls.push(['system', path]); return ''; }, showItemInFolder: async (path: string) => { calls.push(['reveal', path]); } },
    fs: { getHomeDir: async () => '/home/test' },
  } as unknown as Window['agentDesktop'];
  const file = extractAssistantOutputFiles('`report.md`', '/workspace')[0];
  await openAssistantOutputFile(file, 'preview', 's1', '/workspace', false, host);
  expect(calls[0]).toEqual(['read', { sessionId: 's1', filePath: '/workspace/report.md' }]);
  expect((calls[1] as any)[1].file.metadata).toEqual({ remote: true, sessionId: 's1', workspace: '/workspace', originalContent: '# report', dirty: false });
  calls.length = 0;
  await openAssistantOutputFile({ ...file, path: '/tmp/report.md' }, 'preview', 's1', '/workspace', false, host);
  expect(calls[0]).toEqual(['read', { sessionId: 's1', filePath: '/tmp/report.md' }]);
  expect((calls[1] as any)[0]).toBe('preview');
  calls.length = 0;
  await openAssistantOutputFile(file, 'system', 's1', '/workspace', false, host);
  expect(calls).toEqual([['system', '/workspace/report.md']]);
  calls.length = 0;
  await openAssistantOutputFile(file, 'preview', undefined, '', false, host);
  expect((calls[1] as any)[0]).toBe('preview');
  calls.length = 0;
  await openAssistantOutputFile(file, 'preview', 'remote', '/workspace', true, host);
  expect((calls[0] as any)[0]).toBe('read');
  await expect(openAssistantOutputFile(file, 'system', 'remote', '/workspace', true, host)).rejects.toThrow('远程');
  await expect(openAssistantOutputFile(file, 'preview', undefined, '/workspace', true, host)).rejects.toThrow('远程会话');
  calls.length = 0;
  await openAssistantOutputFile({ ...file, path: '~/report.md' }, 'reveal', 's1', '/workspace', false, host);
  expect(calls).toEqual([['reveal', '/home/test/report.md']]);
});

test("system open errors propagate for visible feedback and retry", async () => {
  const file = extractAssistantOutputFiles('`/tmp/report.md`', '/workspace')[0];
  await expect(openAssistantOutputFile(file, 'system', 's1', '/workspace', false, { shell: { openFile: async () => 'File does not exist' } } as any)).rejects.toThrow('File does not exist');
});

test("preview failures remain visible and never fall back to a system application", async () => {
  let systemOpened = false;
  const host = {
    preview: { readFile: async () => { throw new Error('File does not exist'); } },
    shell: { openFile: async () => { systemOpened = true; return ''; } },
  } as any;
  const file = extractAssistantOutputFiles('`/tmp/report.md`', '/workspace')[0];
  await expect(openAssistantOutputFile(file, 'preview', 's1', '/workspace', false, host)).rejects.toThrow('File does not exist');
  expect(systemOpened).toBe(false);
});
