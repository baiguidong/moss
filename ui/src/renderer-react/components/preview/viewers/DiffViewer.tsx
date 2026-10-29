"use client";

import { ScrollArea } from "@/components/ui/scroll-area";

export function DiffViewer({ content }: { content: string }) {
  const lines = content.split("\n");
  return <ScrollArea className="h-full bg-background"><pre className="m-0 p-4 leading-relaxed" data-code-viewer>{lines.map((line, index) => {
    const added = line.startsWith("+") && !line.startsWith("+++"), removed = line.startsWith("-") && !line.startsWith("---");
    return <span key={index} className="block min-h-[1.5em] whitespace-pre-wrap break-words" style={{
      background: added ? 'var(--color-diff-added-bg)' : removed ? 'var(--color-diff-removed-bg)' : undefined,
      color: added ? 'var(--color-diff-added-text)' : removed ? 'var(--color-diff-removed-text)' : undefined,
    }}>{added || removed ? <><span className="moss-diff-marker select-none">{line[0]}</span>{line.slice(1)}</> : line}{index < lines.length - 1 ? '\n' : ''}</span>;
  })}</pre></ScrollArea>;
}
