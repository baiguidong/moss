import { describe, expect, it } from "bun:test";
import { buildRenderModel } from "@/components/chat/message-list";
import {
  getExplorationSummary,
  groupToolCallsForDisplay,
  isExplorationToolCall,
  shouldExpandExploredGroup,
} from "@/components/chat/tool-call-group";
import {
  getDiffPatchText,
  getDiffStats,
  getStructuredDiffStats,
} from "@/components/chat/diff-viewer";
import { buildMainChatRenderMessagesFromHistory } from "@/lib/agent-transcript";

function assistantTool(id: string, name: string, input: unknown = {}) {
  return {
    type: "assistant",
    timestamp: "2026-08-13T00:00:01.000Z",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name, input }],
    },
  };
}

function toolResult(id: string, content: string, rawContent?: unknown) {
  return {
    type: "user",
    timestamp: "2026-08-13T00:00:02.000Z",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content }],
    },
    toolUseResult: rawContent,
  };
}

describe("agent transcript tool rendering", () => {
  it("keeps source message ids so search results can jump to exact bubbles", () => {
    const messages = buildMainChatRenderMessagesFromHistory([
      {
        type: "user",
        uuid: "source-user-1",
        timestamp: "2026-09-18T00:00:00.000Z",
        message: { role: "user", content: "定位这个问题" },
      },
      {
        type: "assistant",
        uuid: "source-assistant-1",
        timestamp: "2026-09-18T00:00:01.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "定位这个回答" }] },
      },
    ]);

    expect(messages.find((message) => message.type === "user_text")?.sourceMessageIds)
      .toEqual(["source-user-1"]);
    expect(messages.find((message) => message.type === "assistant_text")?.sourceMessageIds)
      .toEqual(["source-assistant-1"]);
  });

  it("carries the source user UUID through every item in the assistant turn", () => {
    const messages = buildMainChatRenderMessagesFromHistory([
      {
        type: "user",
        uuid: "user-turn-1",
        timestamp: "2026-08-13T00:00:00.000Z",
        message: { role: "user", content: "change the file" },
      },
      assistantTool("edit-1", "Edit", { file_path: "/repo/a.ts" }),
      toolResult("edit-1", "done", { filePath: "/repo/a.ts" }),
      {
        type: "assistant",
        timestamp: "2026-08-13T00:00:03.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "完成" }] },
      },
    ]);

    expect(messages.map((message) => message.turnId)).toEqual([
      "user-turn-1",
      "user-turn-1",
      "user-turn-1",
      "user-turn-1",
    ]);
  });

  it("keeps Date timestamps and uses the previous event time when a timestamp is missing", () => {
    const messages = buildMainChatRenderMessagesFromHistory([
      {
        type: "user",
        uuid: "user-turn-time",
        timestamp: new Date("2026-09-11T02:18:45.000Z"),
        message: { role: "user", content: "upload files" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "Preparing uploads" }],
        },
      },
      {
        type: "assistant",
        timestamp: "2026-09-11T02:18:46.000Z",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "upload-1", name: "Bash", input: { command: "curl" } }],
        },
      },
      {
        type: "user",
        timestamp: "2026-09-11T02:18:49.000Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "upload-1", content: "done" }],
        },
      },
    ] as any);

    const user = messages.find((message) => message.type === "user_text");
    const thinking = messages.find((message) => message.type === "thinking");
    const toolCall = messages.find((message) => message.type === "tool_use");
    expect(user?.timestamp.toISOString()).toBe("2026-09-11T02:18:45.000Z");
    expect(thinking?.timestamp.toISOString()).toBe("2026-09-11T02:18:45.000Z");
    expect(toolCall?.timestamp.toISOString()).toBe("2026-09-11T02:18:46.000Z");
    expect(toolCall?.type === "tool_use" ? toolCall.duration : undefined).toBe(3_000);
  });

  it("replays structured Library references with their stable display names", () => {
    const messages = buildMainChatRenderMessagesFromHistory([{
      type: "user",
      prompt: "对比这些资料",
      resources: [{
        uri: "moss-library://collection/collection-123?name=Research",
        resourceId: "collection-123",
        kind: "collection",
        selection: "search-scope",
        displayName: "客户研究资料",
        revision: null,
      }],
    }]);

    expect(messages[0]).toEqual(expect.objectContaining({
      type: "user_text",
      attachments: [{
        kind: "file",
        path: "moss-library://collection/collection-123?name=Research",
        name: "客户研究资料",
      }],
    }));
  });

  it("hides SDK synthetic skill context from the user transcript", () => {
    const messages = buildMainChatRenderMessagesFromHistory([
      {
        type: "user",
        message: { role: "user", content: "查询北京数牍近况" },
      },
      {
        type: "user",
        isSynthetic: true,
        sourceToolUseID: "skill-call-1",
        message: {
          role: "user",
          content: [{
            type: "text",
            text: "Base directory for this skill: /tmp/tyc-mcp\n\n# 天眼查 Connector Skill",
          }],
        },
      },
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "查询完成" }] },
      },
    ]);

    expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(messages.some((message) => message.content.includes("Base directory for this skill"))).toBe(false);
  });

  it("renders connector authorization status as a visible system message", () => {
    const messages = buildMainChatRenderMessagesFromHistory([{
      type: "system",
      subtype: "connector_auth",
      status: "success",
      content: "「企查查」连接器授权成功，已加入当前会话。",
      timestamp: "2026-09-03T00:00:00.000Z",
    }]);

    expect(messages).toEqual([expect.objectContaining({
      type: "system",
      role: "system",
      variant: "connector_auth",
      status: "success",
      content: "「企查查」连接器授权成功，已加入当前会话。",
    })]);
  });

  it("promotes a real browser snapshot artifact into the assistant conversation", () => {
    const screenshotPath = "/tmp/workspace/screenshots/browser-snapshot.png";
    const messages = buildMainChatRenderMessagesFromHistory([
      {
        type: "user",
        uuid: "user-screenshot",
        timestamp: "2026-09-18T00:00:00.000Z",
        message: { role: "user", content: "截图发我" },
      },
      assistantTool("snapshot-1", "browser_snapshot", { full_page: false }),
      toolResult("snapshot-1", "captured", {
        ok: true,
        fileKind: "image",
        filePath: screenshotPath,
        filePaths: [screenshotPath],
        browser: { snapshotId: "browser-state-1" },
      }),
      {
        type: "assistant",
        timestamp: "2026-09-18T00:00:03.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "已截图。" }] },
      },
    ]);

    expect(messages).toContainEqual(expect.objectContaining({
      type: "assistant_text",
      attachments: [{ kind: "image", path: screenshotPath }],
    }));
  });

  it("separates built-in exploration tools without grouping business search tools", () => {
    const model = buildRenderModel(buildMainChatRenderMessagesFromHistory([
      assistantTool("read-1", "Read", { file_path: "/repo/src/one.ts" }),
      assistantTool("search-1", "Grep", { pattern: "TODO", path: "/repo/src" }),
      assistantTool("business-1", "mcp__mail__search_messages", { query: "invoice" }),
      assistantTool("bash-1", "Bash", { command: "bun test" }),
      assistantTool("glob-1", "Glob", { pattern: "**/*.test.ts" }),
    ]));
    const toolGroup = model.renderItems.find((item) => item.kind === "tool_group");
    const toolCalls = toolGroup?.kind === "tool_group" ? toolGroup.toolCalls : [];

    expect(isExplorationToolCall(toolCalls[0]!)).toBe(true);
    expect(isExplorationToolCall(toolCalls[2]!)).toBe(false);
    toolCalls[1]!.status = "error";
    expect(getExplorationSummary(toolCalls, model.resultMap)).toEqual({
      read: 1,
      search: 2,
      failed: 1,
      running: 2,
    });
    expect(groupToolCallsForDisplay(toolCalls).map((run) => ({
      kind: run.kind,
      ids: run.toolCalls.map((toolCall) => toolCall.toolUseId),
    }))).toEqual([
      { kind: "exploration", ids: ["read-1", "search-1"] },
      { kind: "tools", ids: ["business-1", "bash-1"] },
      { kind: "exploration", ids: ["glob-1"] },
    ]);
  });

  it("lets the display switch control only the Explored parent", () => {
    expect(shouldExpandExploredGroup('collapsed', false)).toBe(false);
    expect(shouldExpandExploredGroup('expanded', false)).toBe(true);
    expect(shouldExpandExploredGroup('merged', true)).toBe(true);
  });

  it("keeps sibling tool calls and attaches their results by tool_use_id", () => {
    const messages = buildMainChatRenderMessagesFromHistory([
      {
        type: "user",
        timestamp: "2026-08-13T00:00:00.000Z",
        message: { role: "user", content: "inspect files" },
      },
      assistantTool("read-1", "Read", { file_path: "/tmp/a.md" }),
      assistantTool("bash-1", "Bash", { command: "rg heading /tmp/a.md" }),
      toolResult("bash-1", "1:# Heading", {
        stdout: "1:# Heading",
        stderr: "",
        exitCode: 0,
      }),
      toolResult("read-1", "1\t# Heading"),
      {
        type: "assistant",
        timestamp: "2026-08-13T00:00:03.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done." }],
        },
      },
    ]);

    const model = buildRenderModel(messages);
    const groups = model.renderItems.filter((item) => item.kind === "tool_group");

    expect(groups).toHaveLength(1);
    expect(groups[0]?.toolCalls.map((toolCall) => toolCall.toolName)).toEqual([
      "Read",
      "Bash",
    ]);
    expect(model.resultMap.get("read-1")?.content).toBe("1\t# Heading");
    expect(model.resultMap.get("bash-1")?.content).toBe("1:# Heading");
    expect(model.resultMap.get("bash-1")?.rawContent).toEqual({
      stdout: "1:# Heading",
      stderr: "",
      exitCode: 0,
    });
    expect(
      model.renderItems.some(
        (item) => item.kind === "message" && item.message.type === "tool_result",
      ),
    ).toBe(false);
  });

  it("keeps command and output when adapting legacy bash messages", () => {
    const model = buildRenderModel([
      {
        id: "bash-message-1",
        timestamp: new Date("2026-08-13T00:00:00.000Z"),
        type: "bash",
        role: "user",
        command: "git status --short",
        output: "M ui/src/App.tsx",
        exitCode: 0,
      },
    ]);
    const group = model.renderItems.find((item) => item.kind === "tool_group");
    const toolCall = group?.kind === "tool_group" ? group.toolCalls[0] : undefined;

    expect(toolCall?.input).toEqual({ command: "git status --short" });
    expect(model.resultMap.get(toolCall!.toolUseId)?.rawContent).toEqual({
      stdout: "M ui/src/App.tsx",
      stderr: "",
      exitCode: 0,
    });
  });

  it("counts a new file as additions without a synthetic empty deletion", () => {
    expect(getDiffStats("", "first\nsecond")).toEqual({
      additions: 2,
      deletions: 0,
    });
  });

  it("does not count a terminal newline as an extra diff line", () => {
    expect(getDiffStats("", "hello\n")).toEqual({ additions: 1, deletions: 0 });
    expect(getDiffStats("hello\n", "")).toEqual({ additions: 0, deletions: 1 });
    expect(getDiffPatchText("ui/test.ts", "", "hello\n")).toBe([
      "--- ui/test.ts",
      "+++ ui/test.ts",
      "+hello",
    ].join("\n"));
  });

  it("keeps additions and deletions accurate for large replacements", () => {
    const oldString = Array.from({ length: 300 }, (_, index) => `old ${index}`).join("\n");
    const newString = Array.from({ length: 300 }, (_, index) => `new ${index}`).join("\n");
    expect(getDiffStats(oldString, newString)).toEqual({ additions: 300, deletions: 300 });

    const sharedLines = Array.from({ length: 300 }, (_, index) => `shared ${index}`);
    expect(getDiffStats(sharedLines.join("\n"), sharedLines.join("\n"))).toEqual({
      additions: 0,
      deletions: 0,
    });
    const changedLines = [...sharedLines];
    changedLines[150] = "changed middle";
    expect(getDiffStats(sharedLines.join("\n"), changedLines.join("\n"))).toEqual({
      additions: 1,
      deletions: 1,
    });
  });

  it("uses structured patch line counts", () => {
    const patch = [{
      oldStart: 77,
      oldLines: 2,
      newStart: 77,
      newLines: 3,
      lines: [" unchanged", "+added one", "+added two", "-removed"],
    }];

    expect(getStructuredDiffStats(patch)).toEqual({ additions: 2, deletions: 1 });
    expect(getDiffPatchText("ui/test.ts", "", "", patch)).toBe([
      "--- ui/test.ts",
      "+++ ui/test.ts",
      " unchanged",
      "+added one",
      "+added two",
      "-removed",
    ].join("\n"));
  });

  it("keeps assistant commentary between consecutive tool groups", () => {
    const messages = buildMainChatRenderMessagesFromHistory([
      assistantTool("bash-before", "Bash", { command: "git status --short" }),
      toolResult("bash-before", "clean", { stdout: "clean", stderr: "", exitCode: 0 }),
      {
        type: "assistant",
        timestamp: "2026-08-13T00:00:03.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "Checking the diff next." }] },
      },
      assistantTool("bash-after", "Bash", { command: "git diff --stat" }),
      toolResult("bash-after", "1 file changed", { stdout: "1 file changed", stderr: "", exitCode: 0 }),
    ]);
    const model = buildRenderModel(messages);

    expect(model.renderItems.map((item) => item.kind)).toEqual([
      "tool_group",
      "message",
      "tool_group",
    ]);
    expect(model.renderItems[0]?.kind === "tool_group" && model.renderItems[0].toolCalls[0]?.toolUseId).toBe("bash-before");
    expect(model.renderItems[2]?.kind === "tool_group" && model.renderItems[2].toolCalls[0]?.toolUseId).toBe("bash-after");
  });

  it("keeps thinking and ordinary tools in one ordered activity run", () => {
    const model = buildRenderModel([
      { id: "thinking-1", timestamp: new Date(), type: "thinking", role: "assistant", content: "Inspecting" },
      {
        id: "read-message",
        timestamp: new Date(),
        type: "tool_use",
        role: "assistant",
        toolUseId: "read-1",
        toolName: "Read",
        displayName: "Read",
        input: { file_path: "/tmp/a" },
        status: "running",
      },
      { id: "thinking-2", timestamp: new Date(), type: "thinking", role: "assistant", content: "Checking" },
    ]);
    const group = model.renderItems[0];

    expect(model.renderItems).toHaveLength(1);
    expect(group?.kind === "tool_group" && group.steps.map((step) => step.kind)).toEqual([
      "thinking",
      "tool",
      "thinking",
    ]);
  });

  it("keeps dedicated Agent tools outside ordinary merged activity runs", () => {
    const model = buildRenderModel([
      { id: "thinking-1", timestamp: new Date(), type: "thinking", role: "assistant", content: "Planning" },
      {
        id: "agent-message",
        timestamp: new Date(),
        type: "tool_use",
        role: "assistant",
        toolUseId: "agent-1",
        toolName: "Agent",
        displayName: "Agent",
        input: { prompt: "Inspect" },
        status: "running",
      },
    ]);

    expect(model.renderItems).toHaveLength(2);
    expect(model.renderItems[0]?.kind === "tool_group" && model.renderItems[0].mergeable).toBe(true);
    expect(model.renderItems[1]?.kind === "tool_group" && model.renderItems[1].mergeable).toBe(false);
  });
});
