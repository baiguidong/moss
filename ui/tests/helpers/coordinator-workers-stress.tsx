import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CoordinatorWorkersView } from '../../src/renderer-react/components/coordinator-workers-view';
import { SessionTabBar } from '../../src/renderer-react/components/chat-area';
import type { SessionSummary } from '../../src/renderer-react/types';

const longTitle = '检查 Boss 模式 · 👩🏽‍💻 Unicode 中文 é 🚀 '.repeat(35);
function workers(count: number, round = 0): SessionSummary[] {
  return Array.from({ length: count }, (_, i) => {
    const status = (['running', 'failed', 'completed'] as const)[(i + round) % 3];
    return {
      id: `worker-${i}`, title: `${i}: ${longTitle}`,
      agentMode: 'local', workspace: '/tmp/fixture', createdAt: 1000, updatedAt: 2000 + i + round,
      busy: status === 'running', subagentStatus: status, messageCount: 4,
      preview: '连续无空格长文本'.repeat(150), isSubAgent: true,
      workerName: `worker-${i}-${'very-long-name'.repeat(20)}`, assistantName: 'general-purpose', parentSessionId: 'boss',
    };
  });
}

function Fixture() {
  const [items, setItems] = React.useState<SessionSummary[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(true);
  React.useLayoutEffect(() => {
    Object.assign(window, { stress: {
      update: (count: number, round = 0, selectedId: string | null = null) => {
        const started = performance.now();
        flushSync(() => { setItems(workers(count, round)); setSelected(selectedId); setOpen(true); });
        return performance.now() - started;
      },
      select: (id: string) => flushSync(() => setSelected(id)),
      setStatus: (status: 'running' | 'failed' | 'completed') => flushSync(() => {
        setSelected(null);
        setItems(previous => previous.map(worker => ({ ...worker, subagentStatus: status, busy: status === 'running' })));
      }),
    } });
  }, []);
  return <div className="flex h-screen flex-col bg-background text-foreground">
    <SessionTabBar title={longTitle} leftCollapsed rightCollapsed leftPanelName="会话" rightPanelName="检查器"
      onToggleLeft={() => {}} onToggleRight={() => {}} toolDisplayMode="expanded" sessionToolDisplayMode={null}
      globalToolDisplayMode="expanded" onToolDisplayModeChange={() => {}} toolDisplaySettingBusy={false}
      outline={[]} onJumpToOutlineItem={() => {}} messages={[]} childSessions={items}
      onOpenWorkers={() => setOpen(true)} onSelectWorker={id => { setSelected(id); setOpen(true); }} />
    {open ? <CoordinatorWorkersView workers={items} selectedWorkerId={selected} onClose={() => setOpen(false)}
      onOpenWorker={id => { (window as any).openedWorker = id; }} /> : <div>主会话</div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
