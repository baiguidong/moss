import type { TranscriptRenderMessage, TurnTokenUsage } from "@/lib/agent-transcript";
import type {
  GroupRoom,
  GroupRoomTraceEvent,
  GroupRoomTurn,
} from "../types";

function eventTime(turn: GroupRoomTurn, event: GroupRoomTraceEvent, index: number) {
  return new Date(Number(event.timestamp) || Number(turn.startedAt) || turn.createdAt + index);
}

function eventText(value: unknown) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value ?? ""); }
}

function turnErrorText(value: string) {
  if (value === "Interrupted by the room host" || value === "Stopped by the room host") return "已由主持人停止";
  if (value === "Superseded by a host intervention") return "已被主持人的新插话取代";
  if (value === "Room token budget reached") return "已达到房间 token 预算";
  if (value === "Group Room member turn timed out") return "成员执行超时";
  return value;
}

function usageNumber(usage: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(usage[key]);
    if (Number.isFinite(value)) return Math.max(0, value);
  }
  return 0;
}

function normalizeUsage(usage: Record<string, unknown> | null): TurnTokenUsage | undefined {
  if (!usage) return undefined;
  const normalized = {
    inputTokens: usageNumber(usage, "inputTokens", "input_tokens"),
    outputTokens: usageNumber(usage, "outputTokens", "output_tokens"),
    cacheRead: usageNumber(usage, "cacheRead", "cache_read_input_tokens"),
    cacheWrite: usageNumber(usage, "cacheWrite", "cache_creation_input_tokens"),
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function memberTurns(room: GroupRoom, memberId: string) {
  const turns = new Map<string, GroupRoomTurn>();
  for (const run of [...room.recentRuns].reverse()) {
    for (const turn of run.turns) {
      if (turn.memberId === memberId) turns.set(turn.id, turn);
    }
  }
  for (const turn of room.activeRun?.turns || []) {
    if (turn.memberId === memberId) turns.set(turn.id, turn);
  }
  return [...turns.values()].sort((a, b) => a.createdAt - b.createdAt || a.ordinal - b.ordinal);
}

function traceMessages(
  turn: GroupRoomTurn,
  trace: GroupRoomTraceEvent[],
): TranscriptRenderMessage[] {
  const results = new Map<string, GroupRoomTraceEvent>();
  for (const event of trace) {
    if (event.type === "tool_result" && event.toolUseId) results.set(event.toolUseId, event);
  }
  return trace.flatMap((event, index): TranscriptRenderMessage[] => {
    const toolUseId = event.toolUseId || `${turn.id}-tool-${index}`;
    const toolName = event.name || "Tool";
    if (event.type === "tool_call") {
      const result = results.get(toolUseId);
      return [{
        id: `${turn.id}-trace-${index}`,
        type: "tool_use",
        role: "assistant",
        timestamp: eventTime(turn, event, index),
        toolUseId,
        toolName,
        displayName: toolName,
        input: event.input,
        inputText: eventText(event.input),
        status: result ? (result.isError ? "error" : "success") : turn.status === "running" ? "running" : "success",
      }];
    }
    if (event.type === "tool_result") {
      return [{
        id: `${turn.id}-trace-${index}`,
        type: "tool_result",
        role: "assistant",
        timestamp: eventTime(turn, event, index),
        toolUseId,
        toolName,
        content: eventText(event.content),
        rawContent: event.content,
        isError: event.isError,
      }];
    }
    return [];
  });
}

export function buildGroupRoomMemberTranscript({
  room,
  memberId,
  streams,
  liveTraces,
}: {
  room: GroupRoom;
  memberId: string;
  streams: Record<string, string>;
  liveTraces: Record<string, GroupRoomTraceEvent[]>;
}): TranscriptRenderMessage[] {
  const messagesById = new Map(room.messages.map((message) => [message.id, message]));
  const transcript: TranscriptRenderMessage[] = [];

  for (const turn of memberTurns(room, memberId)) {
    transcript.push({
      id: `${turn.id}-assignment`,
      type: "user_text",
      role: "user",
      content: turn.assignment,
      timestamp: new Date(turn.createdAt),
    });
    const trace = turn.trace.length > 0 ? turn.trace : liveTraces[turn.id] || [];
    transcript.push(...traceMessages(turn, trace));

    const output = messagesById.get(turn.outputMessageId);
    if (output?.content) {
      transcript.push({
        id: output.id,
        type: "assistant_text",
        role: "assistant",
        content: output.content,
        timestamp: new Date(output.updatedAt || output.createdAt),
        tokenUsage: normalizeUsage(turn.usage),
      });
    } else if (streams[turn.id]) {
      transcript.push({
        id: `${turn.id}-stream`,
        type: "assistant_text",
        role: "assistant",
        content: streams[turn.id],
        timestamp: new Date(turn.startedAt || turn.createdAt),
        streaming: turn.status === "running",
      });
    }

    if (turn.error) {
      transcript.push({
        id: `${turn.id}-error`,
        type: "system",
        role: "system",
        content: turnErrorText(turn.error),
        timestamp: new Date(turn.completedAt || turn.createdAt),
      });
    }
  }
  return transcript;
}
