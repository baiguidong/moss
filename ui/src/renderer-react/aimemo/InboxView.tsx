/**
 * 收件箱 - 备忘列表 + AI 分类/摘要/标签
 */

import * as React from 'react';
import { Loader2, Trash2, RefreshCw, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { aiMemoAPI } from './ipc/aiMemo.ipc';
import type { MemoNote } from './ipc/types';

export function InboxView() {
  const [notes, setNotes] = React.useState<MemoNote[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [analyzingIds, setAnalyzingIds] = React.useState<Set<number>>(new Set());

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await aiMemoAPI.getNotes();
      setNotes(data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    const off = aiMemoAPI.onAnalyzeProgress((p) => {
      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        if (p.status === 'analyzing') next.add(p.noteId);
        else next.delete(p.noteId);
        return next;
      });
      if (p.status === 'done' || p.status === 'error') load();
    });
    return off;
  }, [load]);

  const handleDelete = async (id: number) => {
    try {
      await aiMemoAPI.deleteNote(id);
    } finally {
      load();
    }
  };

  const handleReanalyze = async (id: number) => {
    setAnalyzingIds((prev) => new Set(prev).add(id));
    try {
      await aiMemoAPI.analyzeNote(id);
    } catch {
      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (notes.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">还没有备忘,去「记录」写一条吧</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-3">
        {notes.map((note) => {
          const analyzing = analyzingIds.has(note.id);
          return (
            <div key={note.id} className="rounded-lg border border-border/50 bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {note.category ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                      style={{ backgroundColor: note.category.color || '#94a3b8' }}
                    >
                      {note.category.name}
                    </span>
                  ) : analyzing ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> 分析中…
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">未分类</span>
                  )}
                  {note.source === 'voice' && <Mic className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => handleReanalyze(note.id)} disabled={analyzing}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(note.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {note.summary && <div className="mb-1 text-sm font-medium">{note.summary}</div>}
              <div className="whitespace-pre-wrap text-sm text-muted-foreground">{note.raw_text}</div>

              {note.tags && note.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {note.tags.map((t) => (
                    <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-2 text-[11px] text-muted-foreground/70">
                {new Date(note.created_at).toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default InboxView;
