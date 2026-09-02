import { describe, expect, test } from "bun:test";

import { buildGroupRoomMemberTranscript } from "../renderer-react/lib/group-room-transcript";
import type { GroupRoom } from "../renderer-react/types";

function roomFixture(): GroupRoom {
  const turn = {
    id: "turn-1",
    runId: "run-1",
    roomId: "room-1",
    memberId: "member-1",
    assignment: "Inspect the build",
    ordinal: 0,
    contextSnapshotSeq: 1,
    outputMessageId: "output-1",
    resourceFingerprint: "resources",
    status: "completed",
    trace: [
      { type: "tool_call", toolUseId: "tool-1", name: "Bash", input: { command: "bun test" }, timestamp: 2 },
      { type: "tool_result", toolUseId: "tool-1", name: "Bash", content: "10 pass", timestamp: 3 },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
    error: "",
    createdAt: 1,
    startedAt: 2,
    completedAt: 4,
  };
  return {
    id: "room-1",
    title: "Review",
    topic: "Review build",
    workspace: "/tmp/workspace",
    status: "idle",
    revision: 1,
    summary: "",
    summaryThroughSeq: 0,
    settings: {},
    createdAt: 1,
    updatedAt: 4,
    members: [{
      id: "member-1",
      roomId: "room-1",
      displayName: "Reviewer",
      role: "reviewer",
      status: "idle",
      ordinal: 0,
      source: { kind: "custom", id: "source-1", memberId: null, hash: "hash" },
      resourceSnapshot: { assistantName: "Reviewer", enabledSkills: [], skillCommands: [], sourceType: "custom", sourceHash: "hash" },
      grants: { connectors: [], skills: [] },
      runtimeSessionId: null,
      createdAt: 1,
      updatedAt: 4,
    }],
    messages: [{
      id: "output-1",
      roomId: "room-1",
      runId: "run-1",
      seq: 2,
      authorType: "agent",
      authorId: "member-1",
      audience: ["room"],
      causationId: null,
      correlationId: null,
      kind: "conclusion",
      content: "The build passes.",
      status: "completed",
      visibility: "public",
      createdAt: 4,
      updatedAt: 4,
    }],
    activeRun: null,
    recentRuns: [{
      id: "run-1",
      roomId: "room-1",
      triggerMessageId: null,
      mode: "conversation",
      contextSnapshotSeq: 1,
      status: "completed",
      stopReason: "",
      createdAt: 1,
      startedAt: 1,
      completedAt: 4,
      turns: [turn],
    }],
  };
}

describe("buildGroupRoomMemberTranscript", () => {
  test("adapts assignments, tool calls, results, and conclusions to the normal transcript model", () => {
    const transcript = buildGroupRoomMemberTranscript({
      room: roomFixture(),
      memberId: "member-1",
      streams: {},
      liveTraces: {},
    });

    expect(transcript.map((message) => message.type)).toEqual([
      "user_text",
      "tool_use",
      "tool_result",
      "assistant_text",
    ]);
    expect(transcript[1]).toMatchObject({ toolName: "Bash", status: "success" });
    expect(transcript[3]).toMatchObject({
      content: "The build passes.",
      tokenUsage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  test("uses live trace and streaming output for an active turn", () => {
    const room = roomFixture();
    const turn = { ...room.recentRuns[0].turns[0], status: "running", trace: [] };
    room.recentRuns = [{ ...room.recentRuns[0], status: "running", turns: [turn] }];
    room.activeRun = room.recentRuns[0];
    room.messages = [];
    const transcript = buildGroupRoomMemberTranscript({
      room,
      memberId: "member-1",
      streams: { "turn-1": "Working..." },
      liveTraces: { "turn-1": [{ type: "tool_call", toolUseId: "tool-live", name: "Read", input: {} }] },
    });

    expect(transcript[1]).toMatchObject({ type: "tool_use", status: "running" });
    expect(transcript[2]).toMatchObject({ type: "assistant_text", content: "Working...", streaming: true });
  });
});
