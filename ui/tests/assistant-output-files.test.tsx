import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { collectAssistantOutputCandidates, resolveAssistantOutputFiles, type ResolveOutputFiles } from "../src/renderer-react/lib/assistant-output-files";
import { buildMainChatRenderMessagesFromHistory as renderHistory, type TranscriptRenderMessage, type ToolResultRenderMessage } from "../src/renderer-react/lib/agent-transcript";
import { AssistantMessage } from "../src/renderer-react/components/chat/assistant-message";
import { openAssistantOutputFile } from "../src/renderer-react/components/chat/assistant-output-file-card";

const timestamp = new Date(0);
const writeResult = (filePath = "/workspace/report.md") => ({ type: "create", filePath, content: "# Report", originalFile: null, structuredPatch: [] });
const editResult = (filePath = "/workspace/report.md") => ({ filePath, oldString: "Report", newString: "Updated", originalFile: "# Report", userModified: false, replaceAll: false, structuredPatch: [] });
const user: TranscriptRenderMessage = { id: "user-1", turnId: "turn-1", type: "user_text", role: "user", content: "生成文档", timestamp };
const reply = { id: "final", turnId: "turn-1", type: "assistant_text", role: "assistant", content: "已完成。", timestamp } as const;

function operation(id = "write-1", name = "Write", result: unknown = writeResult()): TranscriptRenderMessage[] {
  return [
    { id, turnId: "turn-1", type: "tool_use", role: "assistant", toolUseId: id, toolName: name, displayName: "Write", input: { file_path: "/wrong-input.md" }, status: "success", timestamp },
    { id: `${id}-result`, turnId: "turn-1", type: "tool_result", role: "assistant", toolUseId: id, toolName: name, content: "File created successfully at /wrong-text.md", rawContent: result, structuredResult: result, isError: false, timestamp },
  ];
}
const history = () => [user, ...operation(), reply];
const candidates = (messages = history()) => collectAssistantOutputCandidates(messages);
const acceptFiles: ResolveOutputFiles = async ({ paths }) => paths.map((inputPath) => ({ inputPath, file: {
  path: inputPath, name: inputPath.split("/").at(-1)!, size: 8, relativePath: inputPath.startsWith("/workspace/") ? inputPath.slice(11) : undefined,
} }));
const resolve = (messages = history(), resolver = acceptFiles) => resolveAssistantOutputFiles(candidates(messages), "local", resolver);

test("only matched, successful built-in structured outputs supply paths and operation labels", async () => {
  const messages = [user, ...operation(), ...operation("edit", "Edit", editResult("/workspace/src/main.ts")), reply];
  expect([...candidates(messages).values()].flat().map((entry) => [entry.target.path, entry.operation]))
    .toEqual([["/workspace/report.md", "create"], ["/workspace/src/main.ts", "update"]]);
  expect((await resolve(messages)).get("final")?.map((file) => [file.path, file.operation]))
    .toEqual([["/workspace/report.md", "create"], ["/workspace/src/main.ts", "update"]]);
});

test("the reported lookup, Markdown, code and attachment paths cannot generate output cards", async () => {
  const lookup = { ...reply, content: '**《报告-优化版.pdf》**\n\n`/tmp/报告-优化版.pdf`\n[下载](/tmp/报告-优化版.pdf)\n```\n/tmp/报告-优化版.pdf\n```', attachments: [{ kind: "file" as const, path: "/tmp/报告-优化版.pdf" }] };
  const messages = [user, ...operation("library", "app__moss_library__documents_read", { data: { uri: "moss-knowledge://resource/id", metadata: { origin: "/tmp/报告-优化版.pdf" } } }), lookup];
  let checked = false;
  const files = await resolve(messages, async () => { checked = true; return []; });
  expect(files.size).toBe(0);
  expect(checked).toBe(false);
  const markup = renderToStaticMarkup(<AssistantMessage message={{ ...lookup, attachments: [] }} outputFiles={files.get("final")} />);
  expect(markup).not.toContain('aria-label="文件：');
});

test("external tools, Read, Bash and display-name lookalikes do not match the adapter allowlist", () => {
  for (const name of ["Read", "Bash", "MultiEdit", "NotebookEdit", "write", "app__example__Write", "mcp__files__Write"]) {
    expect(candidates([user, ...operation("tool", name), reply]).size).toBe(0);
  }
});

test("missing, failed, text-only, malformed and ambiguously associated results fail closed", () => {
  const [call, result] = operation();
  const rejected: TranscriptRenderMessage[][] = [
    [call], [result], [call, { ...result, isError: true } as ToolResultRenderMessage],
    [{ ...call, status: "running" } as TranscriptRenderMessage, result],
    [call, { ...result, structuredResult: undefined } as ToolResultRenderMessage],
    [call, { ...result, structuredResult: JSON.stringify(writeResult()) } as ToolResultRenderMessage],
    [call, { ...result, toolUseId: "other" } as ToolResultRenderMessage],
    [call, { ...result, toolName: "Edit" } as ToolResultRenderMessage],
    [call, { ...result, turnId: "another-turn" } as ToolResultRenderMessage],
    [call, call, result],
    [{ ...call, parentToolUseId: "agent" } as TranscriptRenderMessage, result],
  ];
  for (const entries of rejected) expect(candidates([user, ...entries, reply]).size).toBe(0);
  for (const value of [{ filePath: "/workspace/report.md" }, { ...writeResult(), type: "unknown" }, { ...writeResult(), structuredPatch: [{}] }, { ...editResult(), replaceAll: "false" }]) {
    expect(candidates([user, ...operation("bad", "Write", value), reply]).size).toBe(0);
  }
});

test("paths are never guessed or cleaned up, including legitimate punctuation in filenames", () => {
  for (const filePath of ["report.md", "./report.md", "~/report.md", "～/report.md", "file:///tmp/report.md", "moss-knowledge://resource/id", "/tmp/bad\u0000.md"]) {
    expect(candidates([user, ...operation("write", "Write", writeResult(filePath)), reply]).size).toBe(0);
  }
  for (const filePath of ["/tmp/《报告》.pdf", "/tmp/report.md:12", "/tmp/空 格.md ", "C:\\Downloads\\报告.md"]) {
    expect(candidates([user, ...operation("write", "Write", writeResult(filePath)), reply]).get("final")?.[0].target.path).toBe(filePath);
  }
});

test("identical repeated results are deduplicated while conflicting results reject the call", () => {
  const [call, result] = operation();
  expect(candidates([user, call, result, result, reply]).get("final")).toHaveLength(1);
  const conflict = { ...result, structuredResult: writeResult("/other.md") } as ToolResultRenderMessage;
  expect(candidates([user, call, result, conflict, reply]).size).toBe(0);
});

test("only the final reply after the tool result owns files, scoped to its turn", async () => {
  const progress = { ...reply, id: "progress", content: "正在生成" };
  expect(candidates([user, progress, ...operation()]).size).toBe(0);
  expect(candidates([user, ...operation(), { ...reply, streaming: true }]).size).toBe(0);
  const messages = [user, progress, ...operation(), reply, { ...user, id: "user-2", turnId: "turn-2" }, { ...reply, id: "final-2", turnId: "turn-2" }];
  expect([...(await resolve(messages)).keys()]).toEqual(["final"]);
});

test("no cards are available before validation or for rejected files", async () => {
  let finish!: (value: Awaited<ReturnType<ResolveOutputFiles>>) => void;
  let completed = false;
  const pending = resolve(history(), () => new Promise((resolve) => { finish = resolve; })).then((files) => { completed = true; return files; });
  await Promise.resolve();
  expect(completed).toBe(false);
  finish([{ inputPath: "/workspace/report.md", error: "ENOENT" }]);
  expect((await pending).size).toBe(0);
  expect((await resolveAssistantOutputFiles(candidates(), "", acceptFiles)).size).toBe(0);
});

test("canonical paths deduplicate aliases per turn without merging different same-named files", async () => {
  const messages = [user, ...operation(), ...operation("edit", "Edit", editResult("/alias/report.md")), ...operation("other", "Write", writeResult("/other/report.md")), reply];
  const files = (await resolve(messages, async ({ paths }) => paths.map((inputPath) => ({ inputPath, file: {
    path: inputPath === "/alias/report.md" ? "/workspace/report.md" : inputPath, name: "report.md", size: 8,
  } })))).get("final")!;
  expect(files.map((file) => file.path)).toEqual(["/workspace/report.md", "/other/report.md"]);
  expect(files[0].sourcePaths).toEqual(["/workspace/report.md", "/alias/report.md"]);
  expect(files[0].operation).toBe("create");
  const nextTurn = [
    { ...user, id: "user-2", turnId: "turn-2" },
    ...operation("edit-2", "Edit", editResult()).map((entry) => ({ ...entry, turnId: "turn-2" })),
    { ...reply, id: "final-2", turnId: "turn-2" },
  ];
  expect([...(await resolve([...messages, ...nextTurn])).keys()]).toEqual(["final", "final-2"]);
});

function runtimeHistory(field = "tool_use_result", value: unknown = writeResult()) {
  return [
    { type: "user", uuid: "turn-1", message: { role: "user", content: "生成文档" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "write-1", name: "Write", input: { file_path: "/workspace/report.md", content: "# Report" } }] } },
    { type: "user", [field]: value, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "write-1", content: "File created successfully at /workspace/report.md" }] } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "完成" }] } },
    { type: "result", subtype: "success" },
  ];
}

test("live SDK and persisted transcript side channels produce the same candidates", () => {
  const live = renderHistory(runtimeHistory());
  const replay = renderHistory(runtimeHistory("toolUseResult"));
  expect([...candidates(live)]).toEqual([...candidates(replay)]);
  expect([...candidates(live).values()].flat()).toHaveLength(1);
  expect(live.find((entry) => entry.type === "tool_result")?.structuredResult).toEqual(writeResult());
});

test("plain tool-result JSON and multi-result envelopes never become structured evidence", () => {
  const plain = runtimeHistory("unused");
  (plain[2].message!.content as any[])[0].content = JSON.stringify(writeResult());
  expect(candidates(renderHistory(plain)).size).toBe(0);
  const multiple = runtimeHistory();
  (multiple[2].message!.content as any[]).push({ type: "tool_result", tool_use_id: "other", content: "done" });
  expect(candidates(renderHistory(multiple)).size).toBe(0);
});

test("rendering, validation and replay leave model messages and compaction records unchanged", async () => {
  const events = [{ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 100 } }, ...runtimeHistory()];
  const before = JSON.stringify(events);
  const modelMessages = () => JSON.stringify(events.flatMap((event) => "message" in event && event.message ? [event.message] : []));
  const requestBefore = modelMessages();
  const freeze = (value: any) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(events);
  for (let replay = 0; replay < 2; replay++) {
    expect((await resolve(renderHistory(events))).size).toBe(1);
    expect(JSON.stringify(events)).toBe(before);
    expect(modelMessages()).toBe(requestBefore);
  }
});

test("verified output cards render operation labels and replace exact duplicate attachments", async () => {
  const files = (await resolve()).get("final")!;
  const markup = renderToStaticMarkup(<AssistantMessage message={{ ...reply, attachments: [{ kind: "file", path: "/workspace/report.md" }] }} outputFiles={files} sessionId="local" />);
  expect(markup.match(/aria-label="文件：/g)).toHaveLength(1);
  expect(markup).toContain("已创建");
  expect(markup).toContain("MARKDOWN");
  expect(markup).toContain("打开方式");
  expect(markup.indexOf("已完成。")).toBeLessThan(markup.indexOf('aria-label="文件：'));
  expect(markup.indexOf('aria-label="文件：')).toBeLessThan(markup.indexOf("复制回复"));
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
