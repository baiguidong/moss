import type { TranscriptRenderMessage, ToolUseRenderMessage } from "./agent-transcript";
import type { OutputFileResolution, PresentationResource, TurnChangeSummary } from "../types";

type FileOperation = "create" | "update" | "reference";
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

export type OutputEvidence = { resources?: PresentationResource[]; turns?: TurnChangeSummary[] };

// File cards consume host evidence only. Tool names, inputs, text and Write/Edit
// result contracts are deliberately not a fallback for file creation claims.
export function collectAssistantOutputCandidates(messages: TranscriptRenderMessage[], evidence: OutputEvidence = {}): Map<string, OutputCandidate[]> {
  const uses = new Map<string, { call: ToolUseRenderMessage; turnId: string; index: number }[]>();
  const turns = new Map<string, { owner: Extract<TranscriptRenderMessage, { type: "assistant_text" }>; index: number }>();
  let currentTurn = "initial";
  messages.forEach((message, index) => {
    if (message.type === "user_text") currentTurn = message.turnId || message.id;
    const turnId = message.turnId || currentTurn;
    if (message.type === "assistant_text") turns.set(turnId, { owner: message, index });
    if (message.type === "tool_use") uses.set(message.toolUseId, [...(uses.get(message.toolUseId) || []), { call: message, turnId, index }]);
  });
  const candidates = new Map<string, OutputCandidate[]>();
  for (const observation of evidence.turns || []) {
    const turn = turns.get(observation.userMessageId);
    if (!turn || turn.owner.streaming || !['complete', 'partial'].includes(observation.coverage || '')) continue;
    const entries = candidates.get(turn.owner.id) || [];
    for (const file of observation.files) {
      if (file.verified !== true || !['added', 'modified'].includes(file.status || '')) continue;
      if (entries.some(entry => entry.target.path === file.filePath)) continue;
      entries.push({ turnId: observation.userMessageId, toolUseId: '', toolName: 'file-observation', operation: file.status === 'added' ? 'create' : 'update', target: { kind: 'local', path: file.filePath } });
    }
    if (entries.length) candidates.set(turn.owner.id, entries);
  }
  for (const resource of evidence.resources || []) {
    if (resource.source.type !== 'file' || !resource.source.path || resource.isResult === false || ['unavailable', 'expired'].includes(resource.availability || '')) continue;
    for (const binding of resource.bindings || []) {
      const calls = uses.get(binding.sourceToolUseId || '');
      if (calls?.length !== 1 || calls[0].call.parentToolUseId || calls[0].call.status !== 'success') continue;
      const turn = turns.get(calls[0].turnId);
      if (!turn || turn.owner.streaming || calls[0].index >= turn.index) continue;
      const entries = candidates.get(turn.owner.id) || [];
      if (!entries.some(entry => entry.target.path === resource.source.path)) entries.push({ turnId: calls[0].turnId, toolUseId: binding.sourceToolUseId!, toolName: 'presentation', operation: 'reference', target: { kind: 'local', path: resource.source.path } });
      candidates.set(turn.owner.id, entries);
    }
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
