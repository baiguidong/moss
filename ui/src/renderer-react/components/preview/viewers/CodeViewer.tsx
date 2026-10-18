"use client";

import * as React from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneDark, atomOneLight } from "react-syntax-highlighter/dist/esm/styles/hljs";
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
  const [dark, setDark] = React.useState(() => document.documentElement.classList.contains("dark"));

  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={container} className="h-full min-h-0"><ScrollArea className="h-full bg-background/70">
      <SyntaxHighlighter
        language={language || "text"}
        style={dark ? atomOneDark : atomOneLight}
        customStyle={{
          margin: 0,
          minHeight: "100%",
          background: "transparent",
          padding: "1.25rem",
          fontSize: "12px",
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
