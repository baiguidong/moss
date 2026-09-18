import * as React from 'react';
import { createPortal } from 'react-dom';
import { Cloud, LoaderCircle, Monitor, Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { SessionSearchResult } from '../types';

function HighlightedText({ text, query }: { text: string; query: string }) {
  const normalized = query.trim();
  if (!normalized) return <>{text}</>;
  const index = text.toLocaleLowerCase().indexOf(normalized.toLocaleLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-amber-300/45 px-0.5 text-inherit dark:bg-amber-500/30">
        {text.slice(index, index + normalized.length)}
      </mark>
      {text.slice(index + normalized.length)}
    </>
  );
}

export function GlobalSessionSearch({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (result: SessionSearchResult) => void | Promise<void>;
}) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<SessionSearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const requestIdRef = React.useRef(0);

  React.useEffect(() => {
    if (!open) return;
    setSelectedIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const normalized = query.trim();
    const requestId = ++requestIdRef.current;
    if (!normalized) {
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      void window.agentDesktop.searchSessions({ query: normalized, limit: 50 })
        .then((next) => {
          if (requestId !== requestIdRef.current) return;
          setResults(next);
          setSelectedIndex(0);
        })
        .catch((reason) => {
          if (requestId !== requestIdRef.current) return;
          setResults([]);
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  React.useEffect(() => {
    if (!open) requestIdRef.current += 1;
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-background/70 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelectedIndex((current) => Math.min(current + 1, Math.max(0, results.length - 1)));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex((current) => Math.max(0, current - 1));
              }
              if (event.key === 'Enter' && results[selectedIndex]) {
                event.preventDefault();
                void onSelect(results[selectedIndex]);
              }
            }}
            placeholder="搜索所有会话的标题与消息正文"
            className="h-14 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="关闭搜索">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-24 overflow-y-auto p-2">
          {!query.trim() ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">输入关键词搜索所有可见会话</p>
          ) : error ? (
            <p className="px-3 py-8 text-center text-sm text-destructive">{error}</p>
          ) : !loading && results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">没有找到匹配消息</p>
          ) : (
            <div className="space-y-1">
              {results.map((result, index) => {
                const ModeIcon = result.agentMode === 'remote-direct' ? Cloud : Monitor;
                return (
                  <button
                    key={`${result.sessionId}:${result.messageId || 'title'}:${index}`}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => void onSelect(result)}
                    className={cn(
                      'w-full rounded-xl px-3 py-2.5 text-left transition-colors',
                      index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                    )}
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ModeIcon className="h-3.5 w-3.5" />
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{result.sessionTitle}</span>
                      <span>{result.role === 'user' ? '你' : result.role === 'assistant' ? 'Moss' : '标题'}</span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-sm leading-5 text-muted-foreground">
                      <HighlightedText text={result.snippet} query={query} />
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          ↑↓ 选择 · Enter 打开 · Esc 关闭
        </div>
      </div>
    </div>,
    document.body,
  );
}
