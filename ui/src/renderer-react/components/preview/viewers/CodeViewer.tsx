"use client";

import * as React from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { mossSyntaxTheme } from "@/theme/syntax";
import { ScrollArea } from "@/components/ui/scroll-area";

export function CodeViewer({
  content,
  language,
  line,
  column,
}: {
  content: string;
  language?: string;
  line?: number;
  column?: number;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { if (line) container.current?.querySelector('[data-source-line="' + line + '"]')?.scrollIntoView({ block: 'center' }); }, [content, line, column]);


  return (
    <div ref={container} className="h-full min-h-0"><ScrollArea className="h-full bg-background/70">
      <SyntaxHighlighter
        language={language || "text"}
        style={mossSyntaxTheme}
        customStyle={{
          margin: 0,
          minHeight: "100%",
          background: "transparent",
          padding: "1.25rem",
          fontSize: "var(--moss-code-size, 12px)",
            fontFamily: "var(--font-mono)",
        }}
        wrapLongLines
        showLineNumbers
        wrapLines
        lineProps={number => ({ 'data-source-line': number, style: number === line ? { background: 'var(--color-primary-10, rgba(59,130,246,.14))', display: 'block' } : undefined })}
      >
        {content}
      </SyntaxHighlighter>
    </ScrollArea></div>
  );
}
