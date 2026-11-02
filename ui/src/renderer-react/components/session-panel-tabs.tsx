import * as React from 'react';
import { Columns2, MessageCircle, PanelsTopLeft, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SessionPanelTabs({ conversationTitle, presentationTitle, activeTab, onSelect, onRestoreSplit, onClosePresentation }: {
  conversationTitle: string;
  presentationTitle: string;
  activeTab: 'conversation' | 'presentation';
  onSelect: (tab: 'conversation' | 'presentation') => void;
  onRestoreSplit: () => void;
  onClosePresentation: () => void;
}) {
  const tabs = [
    { id: 'conversation' as const, title: conversationTitle, label: '会话', icon: MessageCircle },
    { id: 'presentation' as const, title: presentationTitle, label: '内容', icon: PanelsTopLeft },
  ];
  return <div className="moss-no-drag flex h-9 min-w-0 items-center gap-1 px-2" data-session-panel-tabs>
    <div role="tablist" aria-label="会话与内容" className="flex h-full min-w-0 flex-1 items-center gap-1">
      {tabs.map(({ id, title, label, icon: Icon }) => <div key={id} className={cn('flex h-8 min-w-0 max-w-[50%] items-center rounded-md', activeTab === id && 'bg-muted')}>
        <button type="button" role="tab" aria-selected={activeTab === id} aria-label={`${label}：${title}`} tabIndex={activeTab === id ? 0 : -1}
          title={title} className={cn('flex h-full min-w-0 items-center gap-2 rounded-md px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', activeTab === id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
          onClick={() => onSelect(id)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'conversation' : event.key === 'End' ? 'presentation' : id === 'conversation' ? 'presentation' : 'conversation';
            onSelect(next);
            const buttons = event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
            buttons?.[next === 'conversation' ? 0 : 1].focus();
          }}><Icon size={14} className="shrink-0"/><span className="truncate">{title}</span></button>
        {id === 'presentation' && <button type="button" aria-label="关闭内容面板" title="关闭内容面板" className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground" onClick={onClosePresentation}><X size={13}/></button>}
      </div>)}
    </div>
    <button type="button" aria-label="恢复左右分栏" title="恢复左右分栏" onClick={onRestoreSplit} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><Columns2 size={15}/></button>
  </div>;
}
