"use client";

import * as React from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { LocalImage } from "@/components/local-image";
import { CodeViewer } from "@/components/chat/code-viewer";
import { normalizeCodeLanguage, renderStructuredCodeBlock } from "@/components/structured/structured-renderer-registry";

function looksInline(code: string) {
  return !code.includes("\n");
}

function localImageUrlTransform(url: string) {
  if (/^(moss-image|moss-media|file):/i.test(url) || url.startsWith("/") || /^[A-Za-z]:[\\/]/.test(url) || /^[~～][\\/]/.test(url)) {
    return url;
  }
  return defaultUrlTransform(url);
}

export function MarkdownRenderer({
  content,
  variant = "default",
  sourceId = "markdown",
}: {
  content: string;
  variant?: "default" | "document" | "compact";
  sourceId?: string;
}) {
  const compact = variant === "compact";
  return (
    <div
      className={cn(
        "prose prose-sm min-w-0 max-w-none break-words dark:prose-invert [overflow-wrap:anywhere] [&_*]:max-w-full",
        variant === "document" && "prose-headings:scroll-mt-20 prose-pre:my-0",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={localImageUrlTransform}
        components={{
          code: ({ className, children, ...props }: any) => {
            const code = String(children || "").replace(/\n$/, "");
            const match = /language-([\w-]+)/.exec(className || "");
            const language = normalizeCodeLanguage(match?.[1] || "text");
            const offset = props.node?.position?.start?.offset ?? props.node?.position?.start?.line ?? code.length;
            const blockId = `${sourceId}:code:${language}:${offset}`;

            if (looksInline(code)) {
              return (
                <code
                  className={cn("rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.9em]", className)}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            const structured = renderStructuredCodeBlock({ code, language, blockId });
            if (structured) return structured;

            return <CodeViewer code={code} language={language} maxLines={24} showLineNumbers />;
          },
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-4 hover:underline"
              onClick={(event) => {
                if (typeof href === "string" && /^https?:/i.test(href)) {
                  event.preventDefault();
                  void window.agentDesktop.shell.openExternal(href);
                }
              }}
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-2xl border border-border/70">
              <table className="min-w-full">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="bg-muted/60 px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border-t border-border/60 px-3 py-2 align-top">{children}</td>,
          blockquote: ({ children }) => (
            <blockquote className="my-4 rounded-r-2xl border-l-4 border-[var(--color-outline-variant)] bg-[var(--color-surface-container-low)] px-4 py-2 text-[var(--color-text-secondary)]">
              {children}
            </blockquote>
          ),
          h1: ({ children }) => <h1 className={compact ? "mb-2 mt-1 text-base font-semibold" : "mb-4 mt-2 text-2xl font-semibold leading-tight"}>{children}</h1>,
          h2: ({ children }) => <h2 className={compact ? "mb-1.5 mt-4 text-sm font-semibold text-foreground" : "mb-3 mt-8 border-b border-border/70 pb-2 text-xl font-semibold"}>{children}</h2>,
          h3: ({ children }) => <h3 className={compact ? "mb-1 mt-3 text-xs font-semibold text-foreground" : "mb-2 mt-6 text-base font-semibold"}>{children}</h3>,
          p: ({ children }) => <p className={compact ? "my-1 whitespace-pre-wrap break-words leading-6" : "my-2 whitespace-pre-wrap break-words leading-7"}>{children}</p>,
          ul: ({ children }) => <ul className={compact ? "my-1 list-disc pl-4" : "my-3 list-disc pl-5"}>{children}</ul>,
          ol: ({ children }) => <ol className={compact ? "my-1 list-decimal pl-4" : "my-3 list-decimal pl-5"}>{children}</ol>,
          li: ({ children }) => <li className={compact ? "my-0.5 break-words leading-6" : "my-1.5 break-words"}>{children}</li>,
          img: ({ src, alt }) => (
            <LocalImage
              src={typeof src === "string" ? src : ""}
              alt={alt}
              className="my-3 max-h-[420px] max-w-full rounded-2xl border border-border/60 object-contain"
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
