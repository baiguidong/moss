import * as React from 'react';
import { Clock, Pencil, X } from 'lucide-react';
import type { QueuedMessage } from '@/lib/composer-queue';

export function QueuedMessages({ messages, onEdit, onRemove }: {
  messages: QueuedMessage[];
  onEdit?: (id: string) => void;
  onRemove?: (id: string) => void;
}) {
  if (!messages.length) return null;
  return <div className="mb-2 space-y-1">{messages.map((item, index) => (
    <div key={item.id} className="rounded-xl border border-border/60 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <Clock className="h-3 w-3 shrink-0" />
        <span className="shrink-0">#{index + 1} {item.status === 'draft' ? '已保留草稿' : item.status === 'dispatching' ? '发送中' : '排队中'}</span>
        <span className="min-w-0 flex-1 truncate">{item.prompt || `[${item.files?.length ?? 0} 个附件]`}</span>
        <button type="button" disabled={item.status === 'dispatching'} className="shrink-0 rounded p-1 disabled:opacity-40"
          onClick={() => onEdit?.(item.id)} title={item.status === 'draft' ? '编辑草稿' : '撤回编辑'} aria-label={item.status === 'draft' ? '编辑草稿' : '撤回编辑'}><Pencil className="h-3 w-3" /></button>
        <button type="button" disabled={item.status === 'dispatching'} className="shrink-0 rounded p-1 disabled:opacity-40"
          onClick={() => onRemove?.(item.id)} title="移除排队消息" aria-label="移除排队消息"><X className="h-3 w-3" /></button>
      </div>
      {(item.files?.length || item.skills?.length || item.agentType || item.appSelection) ? <div className="mt-1 truncate">
        {[item.files?.length ? `${item.files.length} 个附件` : '', item.skills?.length ? `${item.skills.length} 个技能` : '',
          item.agentType ? `Agent · ${item.agentType}` : '', item.appSelection ? '含 App 资源' : ''].filter(Boolean).join(' · ')}
      </div> : null}
      {item.notice && <div className="mt-1" role="status">{item.notice}</div>}
    </div>
  ))}</div>;
}
