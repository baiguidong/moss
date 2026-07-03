/**
 * AI 备忘录 - 主容器组件
 */

import * as React from 'react';
import { Mic, Inbox, ListTodo, Tags } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { RecordView } from './RecordView';
import { InboxView } from './InboxView';
import { PlansView } from './PlansView';
import { CategoryManager } from './CategoryManager';
import './ipc/aiMemo.ipc';

type TabId = 'record' | 'inbox' | 'plans' | 'categories';

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'record', label: '记录', icon: Mic },
  { id: 'inbox', label: '收件箱', icon: Inbox },
  { id: 'plans', label: '规划', icon: ListTodo },
  { id: 'categories', label: '分类', icon: Tags },
];

export interface AiMemoProps {
  className?: string;
  /** 把一条任务交给 agent 执行,返回新会话 id */
  onRunTaskWithAgent?: (prompt: string, title: string) => Promise<string | null>;
}

export function AiMemo({ className, onRunTaskWithAgent }: AiMemoProps) {
  const [activeTab, setActiveTab] = React.useState<TabId>('record');

  const renderContent = () => {
    switch (activeTab) {
      case 'record':
        return <RecordView onSaved={() => setActiveTab('inbox')} />;
      case 'inbox':
        return <InboxView />;
      case 'plans':
        return <PlansView onRunTaskWithAgent={onRunTaskWithAgent} />;
      case 'categories':
        return <CategoryManager />;
      default:
        return null;
    }
  };

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex items-center gap-1 border-b border-border/40 px-4 py-2">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
            className="gap-2"
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </Button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">{renderContent()}</div>
    </div>
  );
}

export default AiMemo;
