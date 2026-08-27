"use client";

import * as React from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneLight } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { CopyButton } from "@/components/shared/copy-button";
import { inferLanguage } from "@/components/chat/tool-utils";
import { replDarkSyntaxTheme } from "@/components/chat/repl-syntax-theme";
import { cn } from "@/lib/utils";

type DiffLine = {
  type: "added" | "removed" | "unchanged" | "separator";
  oldNumber?: number;
  newNumber?: number;
  text: string;
};

export type StructuredPatchLike = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

function buildLcsTable(a: string[], b: string[]) {
  const table = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
  }
  return table;
}

function splitLogicalLines(value: string) {
  if (value === "") return [];
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function buildLargeDiffLines(oldLines: string[], newLines: string[]): DiffLine[] {
  let prefixLength = 0;
  while (
    prefixLength < oldLines.length
    && prefixLength < newLines.length
    && oldLines[prefixLength] === newLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < oldLines.length - prefixLength
    && suffixLength < newLines.length - prefixLength
    && oldLines[oldLines.length - suffixLength - 1] === newLines[newLines.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const result: DiffLine[] = [];
  for (let index = 0; index < prefixLength; index += 1) {
    result.push({
      type: "unchanged",
      oldNumber: index + 1,
      newNumber: index + 1,
      text: oldLines[index]!,
    });
  }
  for (let index = prefixLength; index < oldLines.length - suffixLength; index += 1) {
    result.push({ type: "removed", oldNumber: index + 1, text: oldLines[index]! });
  }
  for (let index = prefixLength; index < newLines.length - suffixLength; index += 1) {
    result.push({ type: "added", newNumber: index + 1, text: newLines[index]! });
  }
  for (let offset = suffixLength; offset > 0; offset -= 1) {
    const oldIndex = oldLines.length - offset;
    const newIndex = newLines.length - offset;
    result.push({
      type: "unchanged",
      oldNumber: oldIndex + 1,
      newNumber: newIndex + 1,
      text: oldLines[oldIndex]!,
    });
  }
  return result;
}

function buildDiffLines(oldString: string, newString: string): DiffLine[] {
  const oldLines = splitLogicalLines(oldString);
  const newLines = splitLogicalLines(newString);

  if (oldLines.length * newLines.length > 80_000) {
    return buildLargeDiffLines(oldLines, newLines);
  }

  const table = buildLcsTable(oldLines, newLines);
  const result: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      result.push({
        type: "unchanged",
        oldNumber: oldIndex + 1,
        newNumber: newIndex + 1,
        text: oldLines[oldIndex]!,
      });
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      result.push({
        type: "removed",
        oldNumber: oldIndex + 1,
        text: oldLines[oldIndex]!,
      });
      oldIndex += 1;
    } else {
      result.push({
        type: "added",
        newNumber: newIndex + 1,
        text: newLines[newIndex]!,
      });
      newIndex += 1;
    }
  }

  while (oldIndex < oldLines.length) {
    result.push({
      type: "removed",
      oldNumber: oldIndex + 1,
      text: oldLines[oldIndex]!,
    });
    oldIndex += 1;
  }

  while (newIndex < newLines.length) {
    result.push({
      type: "added",
      newNumber: newIndex + 1,
      text: newLines[newIndex]!,
    });
    newIndex += 1;
  }

  return result;
}

function buildStructuredDiffLines(patch: StructuredPatchLike[]): DiffLine[] {
  const result: DiffLine[] = [];
  patch.forEach((hunk, hunkIndex) => {
    if (hunkIndex > 0) result.push({ type: "separator", text: "…" });
    let oldNumber = hunk.oldStart;
    let newNumber = hunk.newStart;

    for (const rawLine of hunk.lines) {
      const marker = rawLine[0];
      const text = marker === "+" || marker === "-" || marker === " "
        ? rawLine.slice(1)
        : rawLine;
      if (marker === "+") {
        result.push({ type: "added", newNumber, text });
        newNumber += 1;
      } else if (marker === "-") {
        result.push({ type: "removed", oldNumber, text });
        oldNumber += 1;
      } else if (marker === "\\") {
        result.push({ type: "separator", text });
      } else {
        result.push({ type: "unchanged", oldNumber, newNumber, text });
        oldNumber += 1;
        newNumber += 1;
      }
    }
  });
  return result;
}

function diffStats(lines: DiffLine[]) {
  return {
    additions: lines.filter((line) => line.type === "added").length,
    deletions: lines.filter((line) => line.type === "removed").length,
  };
}

export function getDiffStats(oldString: string, newString: string) {
  return diffStats(buildDiffLines(oldString, newString));
}

export function getStructuredDiffStats(patch: StructuredPatchLike[]) {
  return diffStats(buildStructuredDiffLines(patch));
}

export function getDiffPatchText(
  filePath: string,
  oldString: string,
  newString: string,
  structuredPatch?: StructuredPatchLike[],
) {
  const lines = structuredPatch?.length
    ? buildStructuredDiffLines(structuredPatch)
    : buildDiffLines(oldString, newString);
  return [
    `--- ${filePath}`,
    `+++ ${filePath}`,
    ...lines.map((line) => {
      if (line.type === "added") return `+${line.text}`;
      if (line.type === "removed") return `-${line.text}`;
      if (line.type === "separator") return line.text;
      return ` ${line.text}`;
    }),
  ].join("\n");
}

function getDiffLineClassName(type: DiffLine["type"]) {
  if (type === "added") {
    return "bg-[var(--color-diff-added-bg)] text-[var(--color-text-primary)]";
  }
  if (type === "removed") {
    return "bg-[var(--color-diff-removed-bg)] text-[var(--color-text-primary)]";
  }
  if (type === "separator") return "bg-[var(--color-code-bg)] text-muted-foreground";
  return "bg-[var(--color-code-bg)] text-[var(--color-code-fg)]";
}

function getTranscriptDiffLineClassName(type: DiffLine["type"]) {
  if (type === "added") {
    return "bg-[var(--color-repl-diff-added-bg)] text-[color:var(--color-repl-code-fg)]";
  }
  if (type === "removed") {
    return "bg-[var(--color-repl-diff-removed-bg)] text-[color:var(--color-repl-code-fg)]";
  }
  if (type === "separator") {
    return "bg-[var(--color-repl-bg)] text-[color:var(--color-repl-muted)]";
  }
  return "bg-[var(--color-repl-bg)] text-[color:var(--color-repl-code-fg)]";
}

export function DiffViewer({
  filePath,
  oldString,
  newString,
  structuredPatch,
  maxLines = 16,
  variant = "card",
}: {
  filePath: string;
  oldString: string;
  newString: string;
  structuredPatch?: StructuredPatchLike[];
  maxLines?: number;
  variant?: "card" | "transcript";
}) {
  const [expanded, setExpanded] = React.useState(false);
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
  const diffLines = React.useMemo(
    () => structuredPatch?.length
      ? buildStructuredDiffLines(structuredPatch)
      : buildDiffLines(oldString, newString),
    [newString, oldString, structuredPatch],
  );
  const visibleLines = expanded ? diffLines : diffLines.slice(0, maxLines);
  const additions = diffLines.filter((line) => line.type === "added").length;
  const deletions = diffLines.filter((line) => line.type === "removed").length;
  const language = inferLanguage(filePath, "diff");
  const patchText = React.useMemo(
    () => getDiffPatchText(filePath, oldString, newString, structuredPatch),
    [filePath, newString, oldString, structuredPatch],
  );

  if (variant === "transcript") {
    return (
      <div className="mt-1.5 min-w-0 overflow-hidden font-mono text-[12px] leading-[1.65] select-text">
        <div className="max-h-[420px] overflow-auto">
          {visibleLines.map((line, index) => {
            const lineNumber = line.type === "removed" ? line.oldNumber : line.newNumber;
            const sign = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
            return (
              <div
                key={`${line.type}-${line.oldNumber ?? "x"}-${line.newNumber ?? "y"}-${index}`}
                className={`grid min-w-max grid-cols-[3rem_1rem_minmax(0,1fr)] ${getTranscriptDiffLineClassName(line.type)}`}
              >
                <span className="select-none px-2 text-right text-[color:var(--color-repl-muted)] opacity-75">{lineNumber ?? ""}</span>
                <span
                  className={cn(
                    "select-none",
                    line.type === "added" && "text-[color:var(--color-repl-diff-added-fg)]",
                    line.type === "removed" && "text-[color:var(--color-repl-diff-removed-fg)]",
                  )}
                >
                  {sign}
                </span>
                {line.type === "separator" ? (
                  <span className="pr-4">{line.text}</span>
                ) : (
                  <SyntaxHighlighter
                    language={language}
                    style={dark ? replDarkSyntaxTheme : atomOneLight}
                    PreTag="span"
                    CodeTag="span"
                    customStyle={{
                      display: "block",
                      minWidth: 0,
                      margin: 0,
                      padding: "0 1rem 0 0",
                      overflow: "visible",
                      background: "transparent",
                      fontFamily: "inherit",
                      fontSize: "inherit",
                      lineHeight: "inherit",
                      whiteSpace: "pre",
                    }}
                  >
                    {line.text || " "}
                  </SyntaxHighlighter>
                )}
              </div>
            );
          })}
        </div>
        {diffLines.length > maxLines ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="ml-4 mt-1 text-[11px] text-[color:var(--color-repl-muted)] opacity-70 transition-opacity hover:opacity-100"
          >
            {expanded ? "Collapse diff" : `… +${diffLines.length - maxLines} lines (click to expand)`}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[18px] border border-border/60 bg-[var(--color-surface-container-low)]">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-[var(--color-surface-container)] px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-[11px] text-[var(--color-text-secondary)]">{filePath}</div>
          <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em]">
            <span className="rounded-full bg-[var(--color-diff-added-bg)] px-2 py-0.5 text-[var(--color-diff-added-text)]">+{additions}</span>
            <span className="rounded-full bg-[var(--color-diff-removed-bg)] px-2 py-0.5 text-[var(--color-diff-removed-text)]">-{deletions}</span>
            <span className="text-[var(--color-text-tertiary)]">{language}</span>
          </div>
        </div>
        <CopyButton text={patchText} label="复制 diff" />
      </div>

      <div className="max-h-[420px] overflow-auto bg-[var(--color-code-bg)] font-mono text-[12px] leading-6 select-text">
        {visibleLines.map((line, index) => (
          <div
            key={`${line.type}-${line.oldNumber ?? "x"}-${line.newNumber ?? "y"}-${index}`}
            className={`grid grid-cols-[56px_56px_1fr] gap-0 ${getDiffLineClassName(line.type)}`}
          >
            <div className="select-none border-r border-black/5 px-2 py-0.5 text-right text-[10px] text-[var(--color-text-tertiary)]">
              {line.oldNumber ?? ""}
            </div>
            <div className="select-none border-r border-black/5 px-2 py-0.5 text-right text-[10px] text-[var(--color-text-tertiary)]">
              {line.newNumber ?? ""}
            </div>
            <pre className="overflow-x-auto px-3 py-0.5 whitespace-pre-wrap break-words">{line.text || " "}</pre>
          </div>
        ))}
      </div>

      {diffLines.length > maxLines ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="w-full border-t border-border/60 bg-[var(--color-surface-container)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)]"
        >
          {expanded ? "收起" : `显示剩余 ${diffLines.length - maxLines} 行`}
        </button>
      ) : null}
    </div>
  );
}
