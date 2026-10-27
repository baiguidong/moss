import type { AskUserQuestionRequest } from "../types";
import type { TranscriptRenderMessage } from "./agent-transcript";

export type AgentActivityKind =
  | "preparing"
  | "waiting"
  | "requesting"
  | "thinking"
  | "tool"
  | "responding"
  | "compacting"
  | "working";

export type AgentActivity = {
  label: string;
  kind: AgentActivityKind;
};

export type AgentActivityOptions = {
  toolPermissionRequest?: AskUserQuestionRequest | null;
  questionRequest?: AskUserQuestionRequest | null;
  pendingPlanApproval?: boolean;
};

function requestToolName(request: AskUserQuestionRequest | null | undefined): string {
  const metadata = request?.input?.metadata;
  if (!metadata || typeof metadata !== "object") return "";
  const name = (metadata as Record<string, unknown>).toolName;
  return typeof name === "string" ? name.trim() : "";
}

function lastUserIndex(messages: TranscriptRenderMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type === "user_text" || messages[index]?.type === "bash") return index;
  }
  return -1;
}

function isCompactionMessage(message: TranscriptRenderMessage): boolean {
  return message.type === "system" && (
    message.variant === "compact" || /压缩上下文|compacting|compacted/i.test(message.content)
  );
}

/**
 * Mirrors Claude Code's spinner state model for the desktop activity strip.
 * The transcript already contains the live stream markers, so no extra
 * renderer state is needed: the latest active item determines the phase and
 * waiting requests take precedence over model activity.
 */
export function deriveAgentActivity(
  messages: TranscriptRenderMessage[],
  loading: boolean,
  options: AgentActivityOptions = {},
): AgentActivity | null {
  if (options.toolPermissionRequest) {
    const toolName = requestToolName(options.toolPermissionRequest);
    return { label: toolName ? `等待确认：${toolName}` : "等待确认使用工具", kind: "waiting" };
  }
  if (options.questionRequest) {
    return { label: "等待你的回答", kind: "waiting" };
  }
  if (options.pendingPlanApproval) {
    return { label: "等待批准执行计划", kind: "waiting" };
  }

  if (!loading) return null;

  const turn = messages.slice(lastUserIndex(messages) + 1);
  const last = turn.at(-1);
  if (last && isCompactionMessage(last)) {
    return { label: "正在压缩上下文", kind: "compacting" };
  }

  // Scan in transcript order so a newer streamed response wins over a stale
  // running tool from the previous model request.
  let latestActive: TranscriptRenderMessage | undefined;
  for (const message of turn) {
    if (message.type === "tool_use" && (message.status === "running" || message.status === "pending")) {
      latestActive = message;
    } else if (message.type === "thinking" && message.streaming) {
      latestActive = message;
    } else if (message.type === "assistant_text" && message.streaming) {
      latestActive = message;
    }
  }

  if (latestActive?.type === "tool_use") {
    const activeTools = turn.filter((message) => (
      message.type === "tool_use" && (message.status === "running" || message.status === "pending")
    ));
    if (activeTools.length > 1) {
      return { label: `正在并行执行 ${activeTools.length} 个工具`, kind: "tool" };
    }
    return {
      label: `正在执行 ${latestActive.displayName || latestActive.toolName || "工具"}`,
      kind: "tool",
    };
  }
  if (latestActive?.type === "thinking") {
    const lines = latestActive.content.trim().split("\n").filter(Boolean);
    const tail = lines.at(-1) || "";
    return {
      label: tail.length > 64 ? `正在思考：…${tail.slice(-64)}` : tail ? `正在思考：${tail}` : "正在思考",
      kind: "thinking",
    };
  }
  if (latestActive?.type === "assistant_text") {
    return { label: "正在输出回复", kind: "responding" };
  }

  // A tool result or a completed model block means Claude Code is about to
  // make the next request. This is the otherwise invisible gap that used to
  // be rendered as the literal `working...`.
  if (last?.type === "tool_result" || last?.type === "tool_use" || last?.type === "assistant_text" || last?.type === "thinking") {
    return { label: "正在请求模型", kind: "requesting" };
  }
  return { label: "正在处理", kind: "working" };
}
