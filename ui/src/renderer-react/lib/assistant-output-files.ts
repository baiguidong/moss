import { marked, type Token } from "marked";
import type { TranscriptRenderMessage, ToolResultRenderMessage } from "./agent-transcript";
import type { TurnChangeSummary } from "../types";

export type AssistantOutputFile = { path: string; name: string; subtitle: string; type: string };

const artifactExtensions = new Set("md markdown mdx txt html htm pdf doc docx odt rtf pages xls xlsx xlsm ods numbers csv tsv ppt pptx odp key png jpg jpeg gif webp avif svg bmp mp3 wav m4a mp4 mov webm zip".split(" "));
const sourceExtensions = new Set("ts tsx js jsx json yaml yml py go rs java css scss sh sql c cpp h vue svelte".split(" "));
const extensionOf = (path: string) => path.split("/").at(-1)?.split(".").at(-1)?.toLowerCase() || "";

export function normalizeOutputPath(value: string, workspace = ""): string | null {
  let path = value.trim();
  if (/^file:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname && url.hostname !== "localhost") return null;
      path = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/, "$1");
    } catch { return null; }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[A-Za-z]:[\\/]/.test(path)) {
    return null;
  }
  path = path.replace(/\\/g, "/").replace(/^～\//, "~/").replace(/(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/i, "");
  if (!path || /[\n\r<>\u0000]/.test(path) || path.endsWith("/")) return null;
  if (!path.startsWith("/") && !path.startsWith("~/") && !/^[A-Za-z]:\//.test(path)) {
    if (!workspace) return null;
    path = `${workspace.replace(/\\/g, "/").replace(/\/$/, "")}/${path}`;
  }
  const prefix = path.match(/^(?:[A-Za-z]:\/|~\/|\/\/|\/)/)?.[0] || "";
  const parts: string[] = [];
  for (const part of path.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { parts.pop(); continue; }
    parts.push(part);
  }
  return prefix + parts.join("/");
}

export function isOutputInsideWorkspace(path: string, workspace: string): boolean {
  if (!workspace.trim()) return false;
  const root = normalizeOutputPath(`${workspace.replace(/[\\/]$/, "")}/.`, "");
  if (!root) return false;
  const normalizedRoot = root.replace(/\/$/, "");
  return path.startsWith(`${normalizedRoot}/`);
}

function describeOutputFile(path: string, workspace: string): AssistantOutputFile {
  const ext = extensionOf(path);
  return {
    path,
    name: path.split("/").at(-1) || path,
    subtitle: isOutputInsideWorkspace(path, workspace) ? path.slice(workspace.replace(/\\/g, "/").replace(/\/$/, "").length + 1) : path,
    type: ["md", "mdx", "markdown"].includes(ext) ? "MARKDOWN" : ext.toUpperCase() || "FILE",
  };
}

// The Markdown lexer skips fenced code and resolves reference links and escaped
// destinations; snippets and external URLs must not become generated files.
export function extractOutputFileReferences(content: string): string[] {
  const paths: string[] = [];
  const visit = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === "code" || token.type === "html") continue;
      if (token.type === "link" || token.type === "image") { paths.push(token.href); continue; }
      if (token.type === "codespan") { paths.push(token.text); continue; }
      if (token.type === "table") {
        for (const cell of [...token.header, ...token.rows.flat()]) visit(cell.tokens);
      } else if (token.type === "list") {
        for (const item of token.items) visit(item.tokens);
      } else if ("tokens" in token && token.tokens) visit(token.tokens);
      else if (token.type === "text") {
        for (const match of token.text.matchAll(/(?:https?:\/\/|file:\/\/|[A-Za-z]:[\\/]|[~～]?[\\/]|\.{1,2}[\\/])?[^\s`<>"'，。；：、！？（）【】\[\]()]+\.[a-zA-Z\d]{1,12}(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)?/g)) paths.push(match[0]);
      }
    }
  };
  visit(marked.lexer(content));
  return paths;
}

export function extractAssistantOutputFiles(content: string, workspace: string, changedFiles: string[] = [], attachments: string[] = []): AssistantOutputFile[] {
  const changed = [...new Set(changedFiles.map((path) => normalizeOutputPath(path, workspace)).filter((path): path is string => Boolean(path)))];
  const paths = new Set<string>();
  for (const reference of extractOutputFileReferences(content)) {
    let path = normalizeOutputPath(reference, workspace);
    if (!path) continue;
    const ext = extensionOf(path);
    if (!artifactExtensions.has(ext) && !sourceExtensions.has(ext)) continue;
    // Bare filenames are common in final replies. Use a unique actual write
    // before resolving them against the workspace. Never guess between matches.
    if (!/^(?:[~～]?[\\/]|[A-Za-z]:|file:)/i.test(reference)) {
      const suffix = reference.replace(/\\/g, "/").replace(/^\.\//, "").replace(/(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/i, "");
      const matches = changed.filter((file) => file.endsWith(`/${suffix}`));
      if (matches.length > 1) continue;
      if (matches.length === 1) path = matches[0];
    }
    if (sourceExtensions.has(ext) && !changed.includes(path)) continue;
    paths.add(path);
  }
  for (const path of changed) if (artifactExtensions.has(extensionOf(path))) paths.add(path);
  for (const attachment of attachments) {
    const path = normalizeOutputPath(attachment, workspace);
    if (path) paths.add(path);
  }
  return [...paths].map((path) => describeOutputFile(path, workspace));
}

// Only the final assistant reply in a turn owns its file strip. Tool inputs
// supply live/replayed writes while checkpoints add files missing from the prose.
export function buildAssistantOutputFiles(messages: TranscriptRenderMessage[], workspace: string, turnChanges = new Map<string, TurnChangeSummary>()): Map<string, AssistantOutputFile[]> {
  const results = new Map<string, ToolResultRenderMessage>();
  for (const message of messages) if (message.type === "tool_result") results.set(message.toolUseId, message);
  const turns = new Map<string, { owner?: Extract<TranscriptRenderMessage, { type: "assistant_text" }>; paths: string[]; attachments: string[] }>();
  let currentTurn = "initial";
  for (const message of messages) {
    if (message.type === "user_text") currentTurn = message.turnId || message.id;
    const turnId = message.turnId || currentTurn;
    let turn = turns.get(turnId);
    if (!turn) { turn = { paths: [], attachments: [] }; turns.set(turnId, turn); }
    if (message.type === "assistant_text") {
      turn.owner = message;
      turn.attachments.push(...(message.attachments || []).filter((file) => file.kind !== "image").map((file) => file.path));
    }
    if (message.type === "tool_use" && /^(?:write|edit|multiedit|notebookedit)$/i.test(message.toolName) && message.status === "success" && !results.get(message.toolUseId)?.isError) {
      const input = message.input as Record<string, unknown> | undefined;
      const path = input?.file_path || input?.path || input?.notebook_path;
      if (typeof path === "string") turn.paths.push(path);
    }
    if (message.type === "tool_result" && !message.isError) turn.attachments.push(...(message.attachments || []).filter((file) => file.kind !== "image").map((file) => file.path));
  }
  const files = new Map<string, AssistantOutputFile[]>();
  for (const [id, turn] of turns) {
    if (!turn.owner || turn.owner.streaming) continue;
    const changed = [...turn.paths, ...(turnChanges.get(id)?.files.map((file) => file.filePath) || [])];
    const imagePaths = new Set((turn.owner.attachments || []).filter((file) => file.kind === "image").map((file) => normalizeOutputPath(file.path, workspace)));
    files.set(turn.owner.id, extractAssistantOutputFiles(turn.owner.content, workspace, changed, turn.attachments).filter((file) => !imagePaths.has(file.path)));
  }
  return files;
}
