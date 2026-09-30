import type { TranscriptRenderMessage, ToolResultRenderMessage, ToolUseRenderMessage } from "./agent-transcript";
import type { OutputFileResolution } from "../types";

type FileOperation = "create" | "update";
export type OutputCandidate = {
  turnId: string;
  toolUseId: string;
  toolName: string;
  operation: FileOperation;
  target: { kind: "local"; path: string };
};
export type AssistantOutputFile = {
  path: string;
  name: string;
  subtitle: string;
  type: string;
  operation: FileOperation;
  toolUseId: string;
  sourcePaths: string[];
};

type ToolFile = { path: string; operation: FileOperation };
type OutputAdapter = (result: Record<string, unknown>) => ToolFile | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPatch(value: unknown): boolean {
  return Array.isArray(value) && value.every((hunk) => isRecord(hunk)
    && [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines].every(Number.isInteger)
    && Array.isArray(hunk.lines) && hunk.lines.every((line) => typeof line === "string"));
}

// These are exact runtime tool identities, not humanized display names.
// New tools must explicitly validate their own result contract here.
const adapters = new Map<string, OutputAdapter>([
  ["Write", (result) => {
    if (typeof result.filePath !== "string" || !isPatch(result.structuredPatch)
      || (result.type !== "create" && result.type !== "update")
      || typeof result.content !== "string"
      || (result.originalFile !== null && typeof result.originalFile !== "string")) return null;
    return { path: result.filePath, operation: result.type };
  }],
  ["Edit", (result) => {
    if (typeof result.filePath !== "string" || !isPatch(result.structuredPatch)
      || typeof result.oldString !== "string" || typeof result.newString !== "string"
      || typeof result.originalFile !== "string" || typeof result.userModified !== "boolean"
      || typeof result.replaceAll !== "boolean") return null;
    return { path: result.filePath, operation: "update" };
  }],
]);

function adaptToolFile(toolName: string, value: unknown): ToolFile | null {
  const adapter = adapters.get(toolName);
  if (!adapter || !isRecord(value)) return null;
  const file = adapter(value);
  if (!file) return null;
  // Preserve the actual filename (including spaces, punctuation and colons).
  // The host applies the local OS path rules; never infer a working directory.
  if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(file.path) || /[\u0000\r\n]/.test(file.path)) return null;
  return file;
}

// Both live and replayed transcripts use this pure projection. No assistant
// prose, inputs, generic attachments, checkpoints, or result text are sources.
export function collectAssistantOutputCandidates(messages: TranscriptRenderMessage[]): Map<string, OutputCandidate[]> {
  const uses = new Map<string, { call: ToolUseRenderMessage; turnId: string }[]>();
  const results = new Map<string, { result: ToolResultRenderMessage; turnId: string; index: number }[]>();
  const turns = new Map<string, { owner: Extract<TranscriptRenderMessage, { type: "assistant_text" }>; index: number }>();
  let currentTurn = "initial";
  messages.forEach((message, index) => {
    if (message.type === "user_text") currentTurn = message.turnId || message.id;
    const turnId = message.turnId || currentTurn;
    if (message.type === "assistant_text") turns.set(turnId, { owner: message, index });
    if (message.type === "tool_use") {
      const entries = uses.get(message.toolUseId) || [];
      entries.push({ call: message, turnId });
      uses.set(message.toolUseId, entries);
    }
    if (message.type === "tool_result") {
      const entries = results.get(message.toolUseId) || [];
      entries.push({ result: message, turnId, index });
      results.set(message.toolUseId, entries);
    }
  });

  const candidates = new Map<string, OutputCandidate[]>();
  for (const [toolUseId, calls] of uses) {
    // Duplicated call identities, nested agents and missing results are not
    // enough evidence to assign a file to this local turn.
    if (!toolUseId || calls.length !== 1) continue;
    const { call, turnId } = calls[0];
    const turn = turns.get(turnId);
    const matchingResults = results.get(toolUseId);
    if (call.parentToolUseId || call.status !== "success" || !turn || turn.owner.streaming || !matchingResults?.length) continue;
    const files = matchingResults.map(({ result, turnId: resultTurn, index }) => {
      if (resultTurn !== turnId || index >= turn.index || result.isError !== false
        || result.parentToolUseId || result.toolName !== call.toolName) return null;
      return adaptToolFile(call.toolName, result.structuredResult);
    });
    const file = files[0];
    // Identical replayed results are harmless; conflicting results fail closed.
    if (!file || files.some((entry) => !entry || entry.path !== file.path || entry.operation !== file.operation)) continue;
    const entries = candidates.get(turn.owner.id) || [];
    entries.push({ turnId, toolUseId, toolName: call.toolName, operation: file.operation, target: { kind: "local", path: file.path } });
    candidates.set(turn.owner.id, entries);
  }
  return candidates;
}

export type ResolveOutputFiles = (payload: { sessionId: string; paths: string[] }) => Promise<OutputFileResolution[]>;

export async function resolveAssistantOutputFiles(
  candidates: Map<string, OutputCandidate[]>,
  sessionId: string,
  resolveFiles: ResolveOutputFiles,
): Promise<Map<string, AssistantOutputFile[]>> {
  const output = new Map<string, AssistantOutputFile[]>();
  const paths = [...new Set([...candidates.values()].flatMap((entries) => entries.map((entry) => entry.target.path)))];
  if (!sessionId || paths.length === 0) return output;
  const resolved = new Map((await resolveFiles({ sessionId, paths })).map((entry) => [entry.inputPath, entry]));
  for (const [ownerId, entries] of candidates) {
    const files = new Map<string, AssistantOutputFile>();
    for (const candidate of entries) {
      const resolution = resolved.get(candidate.target.path);
      if (!resolution || !("file" in resolution)) continue;
      const { path, name, relativePath } = resolution.file;
      const previous = files.get(path);
      const extension = name.includes(".") ? name.split(".").at(-1)!.toLowerCase() : "";
      files.set(path, {
        path, name, subtitle: relativePath || path,
        type: ["md", "mdx", "markdown"].includes(extension) ? "MARKDOWN" : extension.toUpperCase() || "FILE",
        operation: previous?.operation === "create" ? "create" : candidate.operation,
        toolUseId: candidate.toolUseId,
        sourcePaths: [...new Set([...(previous?.sourcePaths || []), candidate.target.path])],
      });
    }
    if (files.size) output.set(ownerId, [...files.values()]);
  }
  return output;
}
