"use client";

import * as React from "react";
import { Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import {
  shouldExpandThinking,
  useToolDisplaySettings,
} from "@/components/chat/tool-display-settings";

const THINKING_PREVIEW_MAX_CHARS = 160;
const THINKING_OPENER_MAX_CHARS = 24;

function cleanThinkingLines(content: string) {
  return content.split("\n").flatMap((rawLine) => {
    const line = rawLine
      .trim()
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^>\s*/, "")
      .replace(/^\d+\.\s+/, "")
      .trim();
    return !line || line === "---" ? [] : [line];
  });
}

export function thinkingPreview(
  content: string,
  options: { streaming?: boolean } = {},
) {
  const lines = cleanThinkingLines(content);
  if (lines.length === 0) return "";

  const first = lines[0]!;
  const settled = first.length <= THINKING_OPENER_MAX_CHARS && /[:：]$/.test(first)
    ? lines[1] ?? first
    : first;
  const picked = options.streaming ? lines.at(-1)! : settled;
  return picked.length > THINKING_PREVIEW_MAX_CHARS
    ? `${picked.slice(0, THINKING_PREVIEW_MAX_CHARS)}…`
    : picked;
}

export function ThinkingBlock({
  content,
  isActive = false,
}: {
  content: string;
  isActive?: boolean;
}) {
  const { toolDisplayMode } = useToolDisplaySettings();
  const modeExpanded = shouldExpandThinking(toolDisplayMode, isActive);
  const [expanded, setExpanded] = React.useState(modeExpanded);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const displayContent = React.useMemo(
    () => content.replace(/\r\n?/g, "\n").trimEnd(),
    [content],
  );
  const preview = React.useMemo(
    () => thinkingPreview(displayContent, { streaming: isActive }),
    [displayContent, isActive],
  );

  React.useEffect(() => {
    setExpanded(modeExpanded);
  }, [modeExpanded, toolDisplayMode]);

  React.useEffect(() => {
    if (expanded && isActive && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [displayContent, expanded, isActive]);

  return (
    <div data-thinking-row="true">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[color:var(--color-repl-border)] bg-[var(--color-repl-header-bg)]",
            isActive ? "text-primary" : "text-muted-foreground",
          )}
          title="思考"
          role="img"
          aria-label="思考"
        >
          <Brain className="h-3.5 w-3.5" strokeWidth={1.8} />
        </span>
        <span className={cn(
          "shrink-0 text-[12.5px] italic",
          isActive ? "text-primary" : "text-muted-foreground",
        )}>
          {isActive ? "思考中" : "已思考"}
          {isActive ? <span className="ml-0.5 inline-block animate-pulse">...</span> : null}
        </span>
        {preview ? (
          <span className="min-w-0 flex-1 truncate text-[12.5px] italic leading-[1.7] text-muted-foreground">
            {preview}
          </span>
        ) : <span className="flex-1" />}
        <span aria-hidden="true" className="shrink-0 text-[9px] text-muted-foreground">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded && displayContent.trim() ? (
        <div
          ref={contentRef}
          data-thinking-content="expanded"
          className="relative mb-2 mt-1 max-h-[300px] overflow-y-auto rounded-md border border-border/70 bg-muted/20 px-3 py-2.5 text-[11px] text-muted-foreground"
        >
          <MarkdownRenderer
            content={displayContent}
            variant="compact"
            sourceId="thinking"
          />
          {isActive ? (
            <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-muted-foreground align-text-bottom" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
