import { describe, expect, it } from "bun:test";
import { buildRenderModel } from "@/components/chat/message-list";
import {
  groupConsecutiveToolCalls,
  summarizeToolCalls,
} from "@/components/chat/tool-call-group";
import {
  buildMainChatRenderMessagesFromHistory,
  type ToolUseRenderMessage,
} from "@/lib/agent-transcript";

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
    expect(
      model.renderItems.some(
        (item) => item.kind === "message" && item.message.type === "tool_result",
      ),
    ).toBe(false);
  });

  it("formats one count summary by tool kind", () => {
    const makeTool = (id: string, toolName: string): ToolUseRenderMessage => ({
      id,
      timestamp: new Date("2026-08-13T00:00:00.000Z"),
      type: "tool_use",
      role: "assistant",
      toolUseId: id,
      toolName,
      displayName: toolName,
      status: "success",
    });

    expect(
      summarizeToolCalls([
        makeTool("bash-1", "Bash"),
        makeTool("bash-2", "Bash"),
        makeTool("read-1", "Read"),
        makeTool("todo-1", "TodoWrite"),
      ]),
    ).toBe("调用 4 个工具 · 2*Bash · 1*Read · 1*Tool");
  });

  it("collapses only consecutive calls and preserves timeline order", () => {
    const makeTool = (id: string, toolName: string, displayName = toolName): ToolUseRenderMessage => ({
      id,
      timestamp: new Date("2026-08-13T00:00:00.000Z"),
      type: "tool_use",
      role: "assistant",
      toolUseId: id,
      toolName,
      displayName,
      status: "success",
    });

    const batches = groupConsecutiveToolCalls([
      makeTool("skill-1", "Skill"),
      makeTool("todo-1", "TodoWrite", "Todo Write"),
      makeTool("search-1", "Grep"),
      makeTool("search-2", "Glob"),
      makeTool("bash-1", "Bash"),
      makeTool("read-1", "Read"),
      makeTool("read-2", "Read"),
      makeTool("search-3", "Grep"),
    ]);

    expect(batches.map((batch) => [batch.label, batch.toolCalls.length])).toEqual([
      ["Skill", 1],
      ["Todo Write", 1],
      ["Search", 2],
      ["Bash", 1],
      ["Read", 2],
      ["Search", 1],
    ]);
  });
});
