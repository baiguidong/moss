"use client";

import * as React from "react";
import {
  BadgeCheck,
  Check,
  FilePenLine,
  FileText,
  FolderOpen,
  Globe2,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import { DiffViewer } from "@/components/chat/diff-viewer";
import type {
  AskUserQuestionAnnotations,
  AskUserQuestionRequest,
} from "../../types";

type Props = {
  request: AskUserQuestionRequest;
  onSubmit: (
    request: AskUserQuestionRequest,
    answers: Record<string, string>,
    annotations?: AskUserQuestionAnnotations,
  ) => Promise<void>;
  onReject: (request: AskUserQuestionRequest) => Promise<void>;
};

type ToolKind = "edit" | "write" | "read" | "bash" | "web" | "other";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function getToolKind(toolName: string, input: Record<string, unknown>): ToolKind {
  const name = toolName.toLowerCase();
  const action = typeof input.action === "string" ? input.action.toLowerCase() : "";
  if (action.startsWith("browser_")) return "web";
  if (name.includes("edit") || name.includes("patch")) return "edit";
  if (name.includes("write")) return "write";
  if (name.includes("read")) return "read";
  if (name === "bash" || name.includes("shell") || name.includes("command")) return "bash";
  if (name.includes("web") || name.includes("fetch") || name.includes("browser")) return "web";
  return "other";
}

function baseName(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) || filePath;
}

function toolLabel(toolName: string, kind: ToolKind) {
  if (kind === "web" && toolName.toLowerCase() === "moss") return "浏览器";
  if (toolName.trim()) return toolName.trim();
  if (kind === "edit") return "Edit";
  if (kind === "write") return "Write";
  if (kind === "read") return "Read";
  if (kind === "bash") return "Bash";
  return "工具";
}

function permissionTitle(toolName: string, kind: ToolKind, filePath: string) {
  const label = toolLabel(toolName, kind);
  if ((kind === "edit" || kind === "write" || kind === "read") && filePath) {
    return `允许 Moss ${label} ${baseName(filePath)}?`;
  }
  if (kind === "bash") return "允许 Moss 执行此命令？";
  if (kind === "web") return "允许 Moss 操作当前网页？";
  return `允许 Moss 使用 ${label}？`;
}

function ToolIcon({ kind }: { kind: ToolKind }) {
  const className = "h-5 w-5";
  if (kind === "edit" || kind === "write") return <FilePenLine className={className} />;
  if (kind === "read") return <FileText className={className} />;
  if (kind === "bash") return <TerminalSquare className={className} />;
  if (kind === "web") return <Globe2 className={className} />;
  return <ShieldCheck className={className} />;
}

export function ToolPermissionCard({ request, onSubmit, onReject }: Props) {
  const metadata = asRecord(request.input?.metadata);
  const toolName = typeof metadata.toolName === "string" ? metadata.toolName : "";
  const input = asRecord(metadata.toolInput);
  const kind = getToolKind(toolName, input);
  const filePath = getString(input, ["file_path", "filePath", "notebook_path", "path"]);
  const command = getString(input, ["command", "cmd"]);
  const description = getString(input, ["description"]);
  const oldString = typeof input.old_string === "string" ? input.old_string : "";
  const newString = typeof input.new_string === "string"
    ? input.new_string
    : typeof input.content === "string" ? input.content : "";
  const question = request.input?.questions?.[0] ?? null;
  const options = question?.options ?? [];
  const detail = options.find((option) => option.preview)?.preview || "";
  const [submittingLabel, setSubmittingLabel] = React.useState("");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    setSubmittingLabel("");
    setError("");
  }, [request.requestId]);

  const respond = React.useCallback(async (label: string) => {
    if (!question || submittingLabel) return;
    setSubmittingLabel(label);
    setError("");
    try {
      await onSubmit(request, { [question.question]: label });
    } catch (responseError) {
      setError(responseError instanceof Error ? responseError.message : String(responseError));
      setSubmittingLabel("");
    }
  }, [onSubmit, question, request, submittingLabel]);

  const reject = React.useCallback(async () => {
    if (submittingLabel) return;
    setSubmittingLabel("拒绝");
    setError("");
    try {
      await onReject(request);
    } catch (responseError) {
      setError(responseError instanceof Error ? responseError.message : String(responseError));
      setSubmittingLabel("");
    }
  }, [onReject, request, submittingLabel]);

  const primaryOption = options[0] ?? null;
  const rememberedOptions = options.slice(1);
  const hasFileDiff = Boolean(
    filePath
    && ((kind === "edit" && (oldString || newString)) || (kind === "write" && newString)),
  );
  const fallbackDetail = detail || (Object.keys(input).length > 0 ? JSON.stringify(input, null, 2) : "");

  return (
    <section
      role="group"
      aria-label={permissionTitle(toolName, kind, filePath)}
      className="mb-3 overflow-hidden rounded-[18px] border border-[#a57820] bg-card shadow-[0_16px_44px_-36px_rgba(74,48,10,0.75)] dark:border-[#c69a43]"
    >
      <header className="flex items-center gap-3 bg-[#fbfaf8] px-4 py-3.5 dark:bg-[#24231f]">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#a24632]/10 text-[#a24632] dark:bg-[#e07860]/15 dark:text-[#ef8d78]">
          <ToolIcon kind={kind} />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
          {permissionTitle(toolName, kind, filePath)}
        </h3>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#fbefd5] px-2.5 py-1 text-[11px] font-medium text-[#8d651f] dark:bg-[#6a4d1e]/45 dark:text-[#edc778]">
          <span className="h-2 w-2 rounded-full bg-[#c39335]" />
          等待审批
        </span>
      </header>

      <div className="border-t border-border/65 px-4 py-4">
        {filePath ? (
          <div className="mb-3 flex min-w-0 items-center gap-2 rounded-lg bg-muted/45 px-3 py-2.5 font-mono text-xs text-muted-foreground">
            <FolderOpen className="h-4 w-4 shrink-0 opacity-55" />
            <span className="min-w-0 flex-1 truncate">{filePath}</span>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(filePath)}
              className="shrink-0 rounded-md border border-border/80 bg-background px-2.5 py-1 font-sans text-[11px] text-foreground transition-colors hover:bg-muted"
            >
              复制路径
            </button>
          </div>
        ) : null}

        {hasFileDiff ? (
          <DiffViewer
            filePath={filePath}
            oldString={kind === "write" ? "" : oldString}
            newString={newString}
            maxLines={28}
          />
        ) : kind === "bash" && command ? (
          <pre className="max-h-[320px] overflow-auto rounded-lg bg-[#222321] px-4 py-3 font-mono text-xs leading-6 text-[#ecebe6]">
            <span className="select-none text-[#87c995]">$ </span>{command}
          </pre>
        ) : fallbackDetail ? (
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 px-3 py-3 font-mono text-xs leading-6 text-foreground">
            {fallbackDetail}
          </pre>
        ) : null}

        {(kind === "edit" || kind === "write") ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {kind === "edit" ? "替换文件内容" : "写入文件内容"}
          </p>
        ) : description ? (
          <p className="mt-3 text-xs text-muted-foreground">{description}</p>
        ) : null}

        {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-border/65 bg-[#faf9f7] px-4 py-3 dark:bg-[#22221f]">
        {primaryOption ? (
          <button
            type="button"
            onClick={() => void respond(primaryOption.label)}
            disabled={Boolean(submittingLabel)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#202020] px-4 text-xs font-medium text-white shadow-sm transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-55 dark:bg-[#ecebe8] dark:text-[#202020] dark:hover:bg-white"
          >
            <Check className="h-4 w-4" />
            {submittingLabel === primaryOption.label ? "处理中..." : "允许"}
          </button>
        ) : null}
        {rememberedOptions.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => void respond(option.label)}
            disabled={Boolean(submittingLabel)}
            className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-55"
          >
            <BadgeCheck className="h-4 w-4" />
            {submittingLabel === option.label ? "处理中..." : option.label}
          </button>
        ))}
        <span className="min-w-2 flex-1" />
        <button
          type="button"
          onClick={() => void reject()}
          disabled={Boolean(submittingLabel)}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#ce493c] px-4 text-xs font-medium text-white transition-colors hover:bg-[#ba3e33] disabled:cursor-not-allowed disabled:opacity-55"
        >
          <X className="h-4 w-4" />
          {submittingLabel === "拒绝" ? "处理中..." : "拒绝"}
        </button>
      </footer>
    </section>
  );
}
