"use client";

import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { LocalImage } from "@/components/local-image";
import { CodeViewer } from "@/components/chat/code-viewer";
import { normalizeCodeLanguage, renderStructuredCodeBlock } from "@/components/structured/structured-renderer-registry";
import { fileLinkLabel, handleMarkdownLinkClick, markdownUrlTransform, normalizeMarkdownHref } from "@/lib/markdown-links";
import { remarkFileReferences } from '@/lib/remark-file-references';
import { cleanIpcErrorMessage } from "@/lib/app-notifications";
import { isInlineFileReference } from '../../../shared/file-reference.mjs';
import { resolveVisibleFileReference } from '@/lib/file-reference-cache';

function FileCode({ code, sessionId, onError, children, ...props }: any) {
  const [available, setAvailable] = React.useState(false);
  React.useEffect(() => {
    let active = true; setAvailable(false);
    if (sessionId && isInlineFileReference(code)) void resolveVisibleFileReference(sessionId, code).then(value => { if (active) setAvailable(value); });
    return () => { active = false; };
  }, [code, sessionId]);
  const content = <code {...props}>{children}</code>;
  return available ? <a href={code} className="text-primary hover:underline" onClick={event => void handleMarkdownLinkClick(event, code, window.agentDesktop, sessionId).catch(onError)}>{content}</a> : content;
}

function looksInline(code: string) {
  return !code.includes("\n");
}

function MarkdownLink({ href, children, sessionId, validate, onError }: { href?: string; children: React.ReactNode; sessionId?: string; validate: boolean; onError: (error: unknown) => void }) {
  const target = normalizeMarkdownHref(href);
  const [available, setAvailable] = React.useState(!validate);
  React.useEffect(() => {
    let active = true;
    if (!validate) { setAvailable(true); return; }
    setAvailable(false);
    if (sessionId && target) void resolveVisibleFileReference(sessionId, target).then(value => { if (active) setAvailable(value); });
    return () => { active = false; };
  }, [target, sessionId, validate]);
  if (!available) return <>{children}</>;
  const label = typeof children === 'string' ? fileLinkLabel(target, children) : null;
  return <a href={target} title={label ? target : undefined} target="_blank" rel="noopener noreferrer"
    className="text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary"
    onClick={event => void handleMarkdownLinkClick(event, target, window.agentDesktop, sessionId).catch(onError)}>{label || children}</a>;
}

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
  variant = "default",
  sourceId = "markdown",
  chatDensity = false,
  sessionId,
}: {
  content: string;
  variant?: "default" | "document" | "compact";
  sourceId?: string;
  chatDensity?: boolean;
  sessionId?: string;
}) {
  const compact = variant === "compact";
  const contentRef = React.useRef(content); contentRef.current = content;
  const [linkError, setLinkError] = React.useState("");
  React.useEffect(() => setLinkError(""), [content]);
  // Component types must survive content and parent updates, otherwise React
  // replaces selected text nodes even when the displayed paragraph is unchanged.
  const components = React.useMemo<Components>(() => ({
    code: ({ className, children, ...props }: any) => {
      const code = String(children || "").replace(/\n$/, "");
      const match = /language-([\w-]+)/.exec(className || "");
      const language = normalizeCodeLanguage(match?.[1] || "text");
      const offset = props.node?.position?.start?.offset ?? props.node?.position?.start?.line ?? code.length;
      const blockId = `${sourceId}:code:${language}:${offset}`;

      const fenced = /^(?:```|~~~)/.test(contentRef.current.slice(props.node?.position?.start?.offset || 0));
      if (looksInline(code) && !match && !fenced) {
        return (
          <FileCode code={code} sessionId={sessionId} onError={(error: unknown) => setLinkError(cleanIpcErrorMessage(error))}
            className={cn("rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.9em]", className)}
            {...props}
          >
            {children}
          </FileCode>
        );
      }

      const structured = renderStructuredCodeBlock({ code, language, blockId });
      if (structured) return structured;

      return <CodeViewer code={code} language={language} maxLines={24} showLineNumbers />;
    },
    pre: ({ children }) => <>{children}</>,
    a: ({ href, children, ...props }: any) => <MarkdownLink href={href} sessionId={sessionId} validate={Boolean(props['data-file-reference'])} onError={error => setLinkError(`无法打开链接：${cleanIpcErrorMessage(error)}`)}>{children}</MarkdownLink>,
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
    p: ({ children }) => (
      <p
        className={compact ? "my-1 whitespace-pre-wrap break-words leading-6" : chatDensity ? "my-2 whitespace-pre-wrap break-words" : "my-2 whitespace-pre-wrap break-words leading-7"}
        style={chatDensity ? { lineHeight: "var(--chat-line-height, 1.55)" } : undefined}
      >
        {children}
      </p>
    ),
    ul: ({ children }) => <ul className={compact ? "my-1 list-disc pl-4" : "my-3 list-disc pl-5"}>{children}</ul>,
    ol: ({ children }) => <ol className={compact ? "my-1 list-decimal pl-4" : "my-3 list-decimal pl-5"}>{children}</ol>,
    li: ({ children }) => (
      <li
        className={compact ? "my-0.5 break-words leading-6" : "my-1.5 break-words"}
        style={chatDensity ? { lineHeight: "var(--chat-line-height, 1.55)" } : undefined}
      >
        {children}
      </li>
    ),
    img: ({ src, alt }) => (
      <LocalImage
        src={typeof src === "string" ? src : ""}
        alt={alt}
        className="my-3 max-h-[420px] max-w-full rounded-2xl border border-border/60 object-contain"
      />
    ),
  }), [compact, chatDensity, sourceId, sessionId]);
  return (
    <div
      className={cn(
        "prose prose-sm min-w-0 max-w-none break-words dark:prose-invert [overflow-wrap:anywhere] [&_*]:max-w-full",
        variant === "document" && "prose-headings:scroll-mt-20 prose-pre:my-0",
      )}
      style={chatDensity ? {
        fontSize: "var(--chat-font-size, 14px)",
        lineHeight: "var(--chat-line-height, 1.55)",
      } : undefined}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFileReferences]}
        urlTransform={markdownUrlTransform}
        components={components}
      >
        {content}
      </ReactMarkdown>
      {linkError && <p role="alert" className="text-sm text-destructive">{linkError}</p>}
    </div>
  );
});
