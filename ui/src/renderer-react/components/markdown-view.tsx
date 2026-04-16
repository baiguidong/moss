"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SyntaxHighlighter from 'react-syntax-highlighter';
import { vs, vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface MarkdownViewProps {
  children: string;
}

function CodeBlock({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const language = match?.[1] || 'text';
  const code = String(children).replace(/\n$/, '');
  const isMultiLine = code.includes('\n');
  const isDark = document.documentElement.classList.contains('dark');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  };

  if (!isMultiLine) {
    return (
      <code className={cn("px-1.5 py-0.5 rounded-md bg-muted font-mono text-sm font-medium", className)} {...props}>
        {children}
      </code>
    );
  }

  return (
    <div className="rounded-lg border border-border/70 overflow-hidden my-3">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border/70">
        <span className="text-xs text-muted-foreground font-medium">{language}</span>
        <button
          onClick={handleCopy}
          className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-muted transition-colors"
          title="Copy code"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
      </div>
      <SyntaxHighlighter
        children={code}
        language={language}
        style={isDark ? vs2015 : vs}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: 0,
          background: 'transparent',
          fontSize: '13px',
        }}
      />
    </div>
  );
}

export function MarkdownView({ children }: MarkdownViewProps) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeBlock,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
              onClick={(e) => {
                if (href?.startsWith('http')) {
                  e.preventDefault();
                  window.open(href, '_blank', 'noopener,noreferrer');
                }
              }}
            >
              {children}
            </a>
          ),
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full divide-y divide-border/70 border border-border/70 rounded-lg">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/50">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-sm">
              {children}
            </td>
          ),
          h1: ({ children }) => <h1 className="text-xl font-semibold mt-6 mb-3">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg font-semibold mt-5 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base font-semibold mt-4 mb-2">{children}</h3>,
          ul: ({ children }) => <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside my-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-primary/50 pl-3 my-2 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border/70" />,
          p: ({ children }) => <p className="text-sm leading-relaxed my-2">{children}</p>,
          img: ({ src, alt }) => (
            <img src={src} alt={alt} className="rounded-lg max-w-full my-2" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
