import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { collectAssistantOutputCandidates, resolveAssistantOutputFiles, type ResolveOutputFiles } from "../src/renderer-react/lib/assistant-output-files";
import type { TranscriptRenderMessage } from "../src/renderer-react/lib/agent-transcript";
import { AssistantMessage } from "../src/renderer-react/components/chat/assistant-message";
import { openAssistantOutputFile } from "../src/renderer-react/components/chat/assistant-output-file-card";
import type { TurnChangeSummary, PresentationResource } from '../src/renderer-react/types';

const timestamp = new Date(0);
const user: TranscriptRenderMessage = { id: "user-1", turnId: "turn-1", type: "user_text", role: "user", content: "生成文档", timestamp };
const reply = { id: "final", turnId: "turn-1", type: "assistant_text", role: "assistant", content: "已完成。", timestamp } as const;
const history = () => [user, reply];
const observation = (paths = ['/workspace/report.md'], turnId = 'turn-1'): TurnChangeSummary => ({ userMessageId: turnId, observationId: 'observed-' + turnId, coverage: 'complete', hasUnverifiedChanges: false,
  stats: { filesChanged: paths.length, additions: paths.length, deletions: 0 }, files: paths.map(filePath => ({ filePath, status: 'added', isNewFile: true, verified: true, structuredPatch: [], additions: 1, deletions: 0 })) });
const acceptFiles: ResolveOutputFiles = async ({ paths }) => paths.map(inputPath => ({ inputPath, file: { path: inputPath, name: inputPath.split('/').at(-1)!, size: 8, relativePath: inputPath.startsWith('/workspace/') ? inputPath.slice(11) : undefined } }));
const resolve = (messages: TranscriptRenderMessage[] = history(), resolver = acceptFiles, turns = [observation()]) => resolveAssistantOutputFiles(collectAssistantOutputCandidates(messages, { turns }), 'local', resolver);

test('Write, Bash and Python files use the same verified observation source', async () => {
  const paths = ['/workspace/joke_write.txt', '/workspace/joke_bash.txt', '/workspace/joke_python.txt'];
  const files = (await resolve(history(), acceptFiles, [observation(paths)])).get('final')!;
  expect(files.map(file => file.path)).toEqual(paths);
  expect(files.every(file => file.operation === 'create')).toBe(true);
  const html = renderToStaticMarkup(<AssistantMessage message={reply} outputFiles={files} sessionId="local" />);
  expect(html.match(/aria-label="文件：/g)).toHaveLength(3);
});

test('old structured Write/Edit results, prose, attachments and tool input never create cards', () => {
  for (const name of ['Write', 'Edit', 'Bash', 'moss_present']) {
    const messages: TranscriptRenderMessage[] = [user,
      { id: 'tool', turnId: 'turn-1', type: 'tool_use', role: 'assistant', toolUseId: 'tool', toolName: name, displayName: name, status: 'success', input: { file_path: '/workspace/report.md' }, timestamp },
      { id: 'result', turnId: 'turn-1', type: 'tool_result', role: 'assistant', toolUseId: 'tool', toolName: name, content: 'Created /workspace/report.md', isError: false, structuredResult: { filePath: '/workspace/report.md', type: 'create', content: 'done', originalFile: null, structuredPatch: [] }, timestamp },
      { ...reply, content: '[report](/workspace/report.md)', attachments: [{ kind: 'file', path: '/workspace/report.md' }] }];
    expect(collectAssistantOutputCandidates(messages).size).toBe(0);
  }
});

test('unavailable, unverified, deleted and reverted files do not claim creation', async () => {
  for (const turn of [
    { ...observation(), coverage: 'unavailable' as const },
    { ...observation(), files: observation().files.map(file => ({ ...file, verified: false })) },
    { ...observation(), files: observation().files.map(file => ({ ...file, status: 'deleted' as const })) },
    { ...observation(), files: [] },
  ]) expect((await resolve(history(), acceptFiles, [turn])).size).toBe(0);
  const partial = { ...observation(['/workspace/yes', '/workspace/no']), coverage: 'partial' as const };
  partial.files[1].verified = false;
  expect((await resolve(history(), acceptFiles, [partial])).get('final')?.map(file => file.path)).toEqual(['/workspace/yes']);
});

test('explicit presentation references are viewable without claiming that an existing file was created', () => {
  const tool: TranscriptRenderMessage = { id: 'present', turnId: 'turn-1', type: 'tool_use', role: 'assistant', toolUseId: 'present', toolName: 'moss_present', displayName: '展示成果', input: {}, status: 'success', timestamp };
  const resource: PresentationResource = { id: 'resource', kind: 'file', title: 'existing', revision: '1', source: { type: 'file', path: '/workspace/existing.pdf' }, capabilities: { preview: true, edit: false, popout: true }, bindings: [{ sourceToolUseId: 'present' }] };
  expect(collectAssistantOutputCandidates([user, tool, reply], { resources: [resource] }).get('final')?.[0].operation).toBe('reference');
  expect(collectAssistantOutputCandidates([user, tool, reply], { resources: [{ ...resource, bindings: [{ sourceToolUseId: 'other' }] }] }).size).toBe(0);
  expect(collectAssistantOutputCandidates([user, tool, tool, reply], { resources: [resource] }).size).toBe(0);
});

test('cards belong only to the completed reply in the observed turn', async () => {
  const next = [{ ...user, id: 'user-2', turnId: 'turn-2' }, { ...reply, id: 'final-2', turnId: 'turn-2' }];
  expect([...(await resolve([...history(), ...next])).keys()]).toEqual(['final']);
  expect((await resolve([user, { ...reply, streaming: true }])).size).toBe(0);
  const frozen = Object.freeze(history());
  const before = JSON.stringify(frozen);
  await resolve([...frozen]); await resolve([...frozen]);
  expect(JSON.stringify(frozen)).toBe(before);
});

test('canonical paths deduplicate aliases while keeping different same-named files', async () => {
  const files = (await resolve(history(), async ({ paths }) => paths.map(inputPath => ({ inputPath, file: { path: inputPath === '/alias/report.md' ? '/workspace/report.md' : inputPath, name: 'report.md', size: 8 } })), [observation(['/workspace/report.md', '/alias/report.md', '/other/report.md'])])).get('final')!;
  expect(files.map(file => file.path)).toEqual(['/workspace/report.md', '/other/report.md']);
  expect(files[0].sourcePaths).toEqual(['/workspace/report.md', '/alias/report.md']);
});

test('file validation rejects absent outputs and duplicate attachments are replaced by one card', async () => {
  expect((await resolve(history(), async () => [])).size).toBe(0);
  const files = (await resolve()).get('final')!;
  const markup = renderToStaticMarkup(<AssistantMessage message={{ ...reply, attachments: [{ kind: 'file', path: '/workspace/report.md' }] }} outputFiles={files} sessionId="local" />);
  expect(markup.match(/aria-label="文件：/g)).toHaveLength(1);
  expect(markup).toContain('已创建'); expect(markup).toContain('MARKDOWN'); expect(markup).toContain('打开方式');
});

function openHost(resolver: ResolveOutputFiles = acceptFiles, previewError?: string) {
  const calls: unknown[] = [];
  const host = {
    preview: {
      resolveFiles: resolver,
      readFile: async (payload: unknown) => { calls.push(["read", payload]); if (previewError) throw new Error(previewError); return { path: "/workspace/report.md", content: "# Report", contentType: "markdown", metadata: {} }; },
      open: async (payload: unknown) => { calls.push(["preview", payload]); },
    },
    shell: { openFile: async (path: string) => { calls.push(["system", path]); return ""; }, showItemInFolder: async (path: string) => { calls.push(["reveal", path]); } },
  } as unknown as Window["agentDesktop"];
  return { host, calls };
}

test("all open actions revalidate the canonical path, with no preview fallback", async () => {
  const file = (await resolve()).get("final")![0];
  const { host, calls } = openHost();
  await openAssistantOutputFile(file, "preview", "local", "/workspace", false, host);
  expect(calls[0]).toEqual(["read", { sessionId: "local", filePath: file.path }]);
  expect((calls[1] as any)[0]).toBe("preview");
  for (const action of ["system", "reveal"] as const) {
    calls.length = 0;
    await openAssistantOutputFile(file, action, "local", "/workspace", false, host);
    expect(calls).toEqual([[action, file.path]]);
  }
  const failing = openHost(acceptFiles, "Invalid document");
  await expect(openAssistantOutputFile(file, "preview", "local", "", false, failing.host)).rejects.toThrow("Invalid document");
  expect(failing.calls).toHaveLength(1);
});

test("deleted files, redirected symlinks, missing sessions and remote cards cannot open local substitutes", async () => {
  const file = (await resolve()).get("final")![0];
  const unavailable = openHost(async ({ paths }) => paths.map((inputPath) => ({ inputPath, error: "ENOENT" })));
  const moved = openHost(async ({ paths }) => paths.map((inputPath) => ({ inputPath, file: { path: "/other/report.md", name: "report.md", size: 8 } })));
  for (const action of ["preview", "system", "reveal"] as const) {
    await expect(openAssistantOutputFile(file, action, "local", "", false, unavailable.host)).rejects.toThrow("无法读取");
    await expect(openAssistantOutputFile(file, action, "local", "", false, moved.host)).rejects.toThrow("位置已变化");
    await expect(openAssistantOutputFile(file, action, undefined, "", false, unavailable.host)).rejects.toThrow("所属的会话");
    await expect(openAssistantOutputFile(file, action, "remote", "", true, unavailable.host)).rejects.toThrow("远程");
  }
  expect(unavailable.calls).toEqual([]);
  expect(moved.calls).toEqual([]);
});

test("Web downloads start before asynchronous file resolution loses user activation", async () => {
  const file = (await resolve()).get("final")![0];
  const { host, calls } = openHost(async () => { throw new Error("Unexpected file resolution"); });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { mossWeb: {} } });
  try {
    const download = openAssistantOutputFile(file, "system", "local", "/workspace", false, host);
    expect(calls).toEqual([["system", file.path]]);
    await download;
    host.shell.openFile = async () => "Download unavailable";
    await expect(openAssistantOutputFile(file, "system", "local", "/workspace", false, host)).rejects.toThrow("Download unavailable");
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
