"use client";

import * as React from "react";
import {
  ChevronDown,
  Wrench,
} from "lucide-react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneLight } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { cn } from "@/lib/utils";
import {
  DiffViewer,
  getDiffPatchText,
  getDiffStats,
  getStructuredDiffStats,
  type StructuredPatchLike,
} from "@/components/chat/diff-viewer";
import { replDarkSyntaxTheme } from "@/components/chat/repl-syntax-theme";
import {
  getToolExecutionState,
  shouldAutoCollapseToolCall,
  useToolDisplaySettings,
} from "@/components/chat/tool-display-settings";
import {
  TOOL_CALL_FRAME_CLASS_NAME,
  TOOL_CALL_HEADER_CLASS_NAME,
} from "@/components/chat/tool-call-frame";
import {
  extractShellResult,
  extractTextContent,
  formatLocator,
  getInputRecord,
  getInputString,
  getToolCommand,
  getToolFilePath,
  getToolKind,
  isRecord,
  stripAnsi,
  summarizeToolLabel,
  ToolKind,
} from "@/components/chat/tool-utils";
import { CopyButton } from "@/components/shared/copy-button";
import type {
  ToolResultRenderMessage,
  ToolUseRenderMessage,
} from "@/lib/agent-transcript";

const OUTPUT_PREVIEW_LINES = 4;

function StatusDot({
  executionState,
}: {
  executionState: ReturnType<typeof getToolExecutionState>;
}) {
  const label = executionState === "failed"
    ? "Failed"
    : executionState === "running"
      ? "Running"
      : "Completed";
  if (executionState === "running") {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-repl-success)]"
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full",
        executionState === "failed"
          ? "bg-[var(--color-repl-error)]"
          : "bg-[var(--color-repl-success)]",
      )}
    />
  );
}

function InlineSyntax({ code, language }: { code: string; language: string }) {
  const [dark, setDark] = React.useState(
    () => document.documentElement.getAttribute("data-theme") === "dark",
  );

  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.getAttribute("data-theme") === "dark");
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <SyntaxHighlighter
      language={language}
      style={dark ? replDarkSyntaxTheme : atomOneLight}
      PreTag="span"
      CodeTag="span"
      customStyle={{
        display: "inline",
        margin: 0,
        padding: 0,
        overflow: "visible",
        background: "transparent",
        fontFamily: "inherit",
        fontSize: "inherit",
        lineHeight: "inherit",
        whiteSpace: "pre-wrap",
      }}
    >
      {code}
    </SyntaxHighlighter>
  );
}

function buildHeadline(toolCall: ToolUseRenderMessage, kind: ToolKind) {
  switch (kind) {
    case "bash":
      return "Ran";
    case "read":
      return "Read";
    case "search":
      return "Searched";
    case "write":
      return "Wrote";
    case "edit":
      return "Edited";
    case "web":
      return "Fetched";
    case "agent":
      return "Delegated";
    case "db":
      return "Queried";
    default:
      return toolCall.displayName;
  }
}

function buildSubject(toolCall: ToolUseRenderMessage, kind: ToolKind) {
  if (kind === "bash") {
    return getToolCommand(toolCall) || summarizeToolLabel(toolCall);
  }
  const summary = summarizeToolLabel(toolCall);
  return summary === toolCall.displayName ? "" : summary;
}

function RowToolIcon({ active }: {
  active: boolean;
}) {
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[color:var(--color-repl-border)] bg-[var(--color-repl-header-bg)]",
        active ? "text-primary" : "text-muted-foreground",
      )}
      title="工具调用"
      role="img"
      aria-label="工具调用"
    >
      <Wrench className="h-3.5 w-3.5" strokeWidth={1.8} />
    </span>
  );
}

export function formatToolDuration(duration?: number) {
  if (typeof duration !== "number" || duration < 0) return "";
  if (duration < 1000) return `${Math.round(duration)}ms`;
  const totalSeconds = Math.round(duration / 1000);
  if (totalSeconds < 10) return `${(duration / 1000).toFixed(1)}s`;
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m${totalSeconds % 60}s`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

type OutputLine = {
  text: string;
  isError: boolean;
};

type InlineDiff = {
  filePath: string;
  oldString: string;
  newString: string;
  structuredPatch?: StructuredPatchLike[];
};

function extractStructuredDiff(rawContent: unknown): InlineDiff | undefined {
  if (!isRecord(rawContent) || !Array.isArray(rawContent.structuredPatch)) return undefined;
  const structuredPatch = rawContent.structuredPatch.filter((hunk): hunk is StructuredPatchLike => (
    isRecord(hunk)
    && typeof hunk.oldStart === "number"
    && typeof hunk.oldLines === "number"
    && typeof hunk.newStart === "number"
    && typeof hunk.newLines === "number"
    && Array.isArray(hunk.lines)
    && hunk.lines.every((line) => typeof line === "string")
  ));
  if (structuredPatch.length === 0) return undefined;
  return {
    filePath: typeof rawContent.filePath === "string" ? rawContent.filePath : "file",
    oldString: "",
    newString: "",
    structuredPatch,
  };
}

function outputLines(segments: Array<{ text?: string; isError?: boolean }>): OutputLine[] {
  return segments.flatMap((segment) => {
    const normalized = stripAnsi(segment.text || "").replace(/\s+$/, "");
    if (!normalized) return [];
    return normalized.split("\n").map((text) => ({
      text,
      isError: Boolean(segment.isError),
    }));
  });
}

function TranscriptOutput({
  segments,
  expanded,
  emptyLabel,
  onExpand,
}: {
  segments: Array<{ text?: string; isError?: boolean }>;
  expanded: boolean;
  emptyLabel?: string;
  onExpand?: () => void;
}) {
  const lines = React.useMemo(() => outputLines(segments), [segments]);
  const visibleLines = expanded ? lines : lines.slice(0, OUTPUT_PREVIEW_LINES);
  const hiddenCount = lines.length - visibleLines.length;

  if (lines.length === 0 && !emptyLabel) return null;

  return (
    <div className="mt-1 grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] text-[12px] leading-[1.55]">
      <span className="select-none font-mono text-[color:var(--color-repl-muted)] opacity-70">⎿</span>
      <div className="min-w-0 font-mono text-[color:var(--color-repl-muted)] select-text">
        {visibleLines.length > 0 ? (
          <pre className="overflow-x-auto whitespace-pre-wrap break-words">
            {visibleLines.map((line, index) => (
              <React.Fragment key={`${index}:${line.text}`}>
                {index > 0 ? "\n" : null}
                <span className={line.isError ? "text-[color:var(--color-repl-error)]" : undefined}>{line.text || " "}</span>
              </React.Fragment>
            ))}
          </pre>
        ) : (
          <span>{emptyLabel}</span>
        )}
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={onExpand}
            className="mt-0.5 text-left text-[11px] text-[color:var(--color-repl-muted)] opacity-70 transition-opacity hover:opacity-100"
          >
            … +{hiddenCount} lines (click to expand)
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ExpandedInput({
  toolCall,
  kind,
  inlineDiff,
  transcriptDiff = false,
}: {
  toolCall: ToolUseRenderMessage;
  kind: ToolKind;
  inlineDiff?: InlineDiff;
  transcriptDiff?: boolean;
}) {
  const input = getInputRecord(toolCall);
  if (inlineDiff) {
    return (
      <DiffViewer
        filePath={inlineDiff.filePath}
        oldString={inlineDiff.oldString}
        newString={inlineDiff.newString}
        structuredPatch={inlineDiff.structuredPatch}
        maxLines={transcriptDiff ? 28 : 16}
        variant={transcriptDiff ? "transcript" : "card"}
      />
    );
  }

  if (kind === "agent") {
    const prompt = getInputString(input, ["prompt", "query"]);
    if (prompt) return <TranscriptOutput segments={[{ text: prompt }]} expanded />;
  }

  if (kind !== "bash" && toolCall.inputText) {
    return <TranscriptOutput segments={[{ text: toolCall.inputText }]} expanded />;
  }

  return null;
}

function hasExpandedInput(toolCall: ToolUseRenderMessage, kind: ToolKind) {
  const input = getInputRecord(toolCall);
  if (kind === "edit" || kind === "write") return false;
  if (kind === "agent") return Boolean(getInputString(input, ["prompt", "query"]));
  return kind !== "bash" && Boolean(toolCall.inputText);
}

export function ToolCallBlock({
  toolCall,
  result,
  children,
  focused = false,
  expandForFocus = false,
  defaultCollapsed = false,
  chrome = "card",
}: {
  toolCall: ToolUseRenderMessage;
  result?: ToolResultRenderMessage;
  children?: React.ReactNode;
  focused?: boolean;
  expandForFocus?: boolean;
  defaultCollapsed?: boolean;
  chrome?: "card" | "row";
}) {
  const { toolDisplayMode } = useToolDisplaySettings();
  const isRow = chrome === "row";
  const kind = getToolKind(toolCall.toolName, toolCall.input);
  const isRunning = toolCall.status === "running" || toolCall.status === "pending";
  const shell = extractShellResult(result?.rawContent);
  const input = getInputRecord(toolCall);
  const resultDiff = kind === "edit" || kind === "write"
    ? extractStructuredDiff(result?.rawContent)
    : undefined;
  const inputDiff: InlineDiff | undefined = kind === "edit" && typeof input.old_string === "string" && typeof input.new_string === "string"
    ? {
        filePath: getToolFilePath(toolCall) || "file",
        oldString: input.old_string,
        newString: input.new_string,
      }
    : kind === "write" && typeof input.content === "string"
      ? {
          filePath: getToolFilePath(toolCall) || "file",
          oldString: "",
          newString: input.content,
        }
      : undefined;
  const inlineDiff = resultDiff || inputDiff;
  const diffStats = inlineDiff?.structuredPatch
    ? getStructuredDiffStats(inlineDiff.structuredPatch)
    : inlineDiff
      ? getDiffStats(inlineDiff.oldString, inlineDiff.newString)
      : undefined;
  const failed = toolCall.status === "error" || Boolean(result?.isError) || Boolean(shell?.exitCode);
  const resultText = inlineDiff && !failed
    ? ""
    : shell
    ? [shell.stdout, shell.stderr].filter(Boolean).join("\n")
    : result
      ? extractTextContent(result.rawContent ?? result.content).trim() || result.content
      : "";
  const segments = inlineDiff && !failed
    ? []
    : shell
    ? [
        { text: shell.stdout, isError: false },
        { text: shell.stderr, isError: false },
      ]
    : [{ text: resultText, isError: Boolean(result?.isError) }];
  const lineCount = outputLines(segments).length;
  const hasDetailInput = hasExpandedInput(toolCall, kind);
  const hasResponse = Boolean(inlineDiff)
    || lineCount > 0
    || isRunning
    || Boolean(result)
    || Boolean(children)
    || Boolean(result?.attachments?.length);
  const hasResult = Boolean(result);
  const executionState = getToolExecutionState({
    status: toolCall.status,
    failed,
    hasResult,
  });
  const shouldAutoCollapse = shouldAutoCollapseToolCall({
    mode: toolDisplayMode,
    status: toolCall.status,
    failed,
    hasResult,
  });
  const focusRequested = focused || expandForFocus;
  const [collapsed, setCollapsed] = React.useState(
    (defaultCollapsed || shouldAutoCollapse) && !focusRequested,
  );
  const [outputExpanded, setOutputExpanded] = React.useState(focusRequested);
  const autoCollapseWasEnabledRef = React.useRef(toolDisplayMode === "collapsed");
  const focusWasRequestedRef = React.useRef(focusRequested);

  React.useEffect(() => {
    if (focusRequested) {
      setCollapsed(false);
      setOutputExpanded(true);
    } else if (defaultCollapsed) {
      if (focusWasRequestedRef.current) setCollapsed(true);
    } else if (toolDisplayMode === "collapsed") {
      setCollapsed(shouldAutoCollapse);
    } else if (autoCollapseWasEnabledRef.current) {
      setCollapsed(false);
    }
    autoCollapseWasEnabledRef.current = toolDisplayMode === "collapsed";
    focusWasRequestedRef.current = focusRequested;
  }, [
    defaultCollapsed,
    failed,
    focusRequested,
    hasResult,
    shouldAutoCollapse,
    toolDisplayMode,
    toolCall.status,
  ]);

  const command = getToolCommand(toolCall);
  const diffText = inlineDiff
    ? getDiffPatchText(
        inlineDiff.filePath,
        inlineDiff.oldString,
        inlineDiff.newString,
        inlineDiff.structuredPatch,
      )
    : "";
  const copyText = [command ? `$ ${command}` : toolCall.inputText, diffText || resultText]
    .filter(Boolean)
    .join("\n");
  const subject = buildSubject(toolCall, kind) || formatLocator(inlineDiff?.filePath) || "";
  const rowResultSummary = executionState === "running"
    ? "执行中"
    : executionState === "failed"
      ? "失败"
      : diffStats
        ? "已完成"
        : lineCount > 1
          ? `${lineCount} 行输出`
          : resultText
            ? (resultText.replace(/\s+/g, " ").trim().slice(0, 36) || "已完成")
            : "已完成";
  const durationSummary = executionState === "completed" || executionState === "failed"
    ? formatToolDuration(toolCall.duration)
    : "";

  return (
    <div
      data-tool-use-id={toolCall.toolUseId}
      data-tool-call-chrome={chrome}
      className={cn(
        isRow
          ? "group/tool-call min-w-0 rounded-md transition-colors"
          : TOOL_CALL_FRAME_CLASS_NAME,
        focused && "scroll-mt-16 bg-primary/5 ring-2 ring-primary/70",
      )}
    >
      <div
        className={cn(
          isRow
            ? "-mx-2 flex min-h-7 w-[calc(100%+1rem)] min-w-0 items-center gap-3 rounded-md px-2 py-1 transition-colors hover:bg-muted/45"
            : TOOL_CALL_HEADER_CLASS_NAME,
          !isRow && hasResponse && !collapsed && "border-b border-[color:var(--color-repl-border)]",
        )}
      >
        {isRow ? (
          <RowToolIcon active={executionState === "running"} />
        ) : (
          <StatusDot executionState={executionState} />
        )}
        <button
          type="button"
          disabled={!hasResponse}
          aria-expanded={hasResponse ? !collapsed : undefined}
          onClick={() => setCollapsed((value) => !value)}
          className={cn(
            "min-w-0 flex-1 text-left leading-[1.55] disabled:pointer-events-none",
            isRow ? "text-[12.5px]" : "text-[13px]",
            hasResponse ? "cursor-pointer" : "cursor-default",
          )}
        >
          <span className="block truncate whitespace-nowrap">
            <span className={cn(
              "font-semibold",
              isRow
                ? executionState === "running" ? "text-primary" : "text-muted-foreground"
                : "text-[color:var(--color-repl-fg)]",
            )}>
              {isRow ? toolCall.displayName || toolCall.toolName : buildHeadline(toolCall, kind)}
            </span>
            {subject ? (
              <span className={cn(
                "ml-1",
                isRow ? "text-muted-foreground" : "text-[color:var(--color-repl-code-fg)]",
                kind === "bash" && "font-mono",
              )}>
                {kind === "bash" ? <InlineSyntax code={subject} language="bash" /> : subject}
              </span>
            ) : null}
            {diffStats ? (
              <span className="ml-1 font-mono text-[color:var(--color-repl-muted)]">
                (<span className="text-[color:var(--color-repl-diff-added-fg)]">+{diffStats.additions}</span>{" "}
                <span className="text-[color:var(--color-repl-diff-removed-fg)]">-{diffStats.deletions}</span>)
              </span>
            ) : null}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {isRow ? (
            <span className={cn(
              "max-w-[38%] truncate text-[11.5px]",
              executionState === "failed" ? "font-medium text-destructive" : "text-muted-foreground",
            )}>
              {rowResultSummary}
            </span>
          ) : null}
          {isRow && durationSummary ? (
            <span className={cn(
              "font-mono text-[11px] tabular-nums",
              executionState === "failed" ? "text-destructive" : "text-muted-foreground",
            )}>
              {durationSummary}
            </span>
          ) : null}
          <CopyButton
            text={copyText}
            label="复制工具记录"
            showLabel={false}
            className="h-6 w-6 justify-center rounded-sm border-0 bg-transparent p-0 text-[color:var(--color-repl-muted)] opacity-0 transition-opacity hover:bg-white/10 hover:text-[color:var(--color-repl-fg)] group-hover/tool-call:opacity-100 focus:opacity-100"
          />
          {hasResponse ? (
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-[color:var(--color-repl-muted)] transition-colors hover:bg-white/10 hover:text-[color:var(--color-repl-fg)]"
              title={collapsed ? "展开工具记录" : "折叠到一行"}
              aria-label={collapsed ? "展开工具记录" : "折叠到一行"}
              aria-expanded={!collapsed}
            >
              <ChevronDown className={cn(
                "transition-transform",
                isRow ? "h-3 w-3" : "h-3.5 w-3.5",
                collapsed && "-rotate-90",
              )} />
            </button>
          ) : null}
        </div>
      </div>

      {hasResponse && !collapsed ? (
        <div className={cn(
          "min-w-0",
          isRow
            ? "mb-2 ml-2 mt-1 border-l border-border/70 py-1 pl-3"
            : "bg-[var(--color-repl-bg)] px-2.5 py-1.5",
        )}>
          <div className="ml-3.5 min-w-0">
            <TranscriptOutput
              segments={segments}
              expanded={outputExpanded}
              emptyLabel={inlineDiff
                ? undefined
                : executionState === "failed"
                  ? "Failed"
                  : executionState === "running"
                    ? "Running…"
                    : "Done"}
              onExpand={() => setOutputExpanded(true)}
            />

            {outputExpanded && !inlineDiff && hasDetailInput ? (
              <ExpandedInput
                toolCall={toolCall}
                kind={kind}
              />
            ) : null}

            {result?.attachments?.length ? (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 pl-4 font-mono text-[11px] text-[color:var(--color-repl-muted)]">
                {result.attachments.map((attachment) => (
                  <span key={`${attachment.kind}:${attachment.path}`}>{attachment.path}</span>
                ))}
              </div>
            ) : null}

            {children ? <div className="mt-2">{children}</div> : null}
          </div>

          {inlineDiff ? (
            <ExpandedInput
              toolCall={toolCall}
              kind={kind}
              inlineDiff={inlineDiff}
              transcriptDiff
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
