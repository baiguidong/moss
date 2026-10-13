import React from 'react';
import { createRoot } from 'react-dom/client';
import { SessionEffortSelector } from '@/components/session-effort-selector';
import { MemoryDreamControl } from '@/components/memory-dream-control';
import '@/globals.css';

const values = { a: 'xhigh', b: null };
const describe = sessionId => ({ model: 'gpt-5.5', configured: values[sessionId], applied: values[sessionId], levels: ['low', 'medium', 'high', 'xhigh'], overridden: false });
(window as any).writes = [];
window.agentDesktop = {
  getSessionEffort: async ({ sessionId }) => describe(sessionId),
  setSessionEffort: async ({ sessionId, effort }) => { values[sessionId] = effort; (window as any).writes.push({ sessionId, effort }); return describe(sessionId); },
  memory: {
    dreamStatus: async () => ({ phase: 'idle', message: '', result: null }),
    startDream: async () => ({ phase: 'completed', message: '长期记忆整理完成。', result: { summary: '已合并重复记忆。', filesTouched: [], sessionsReviewed: 3 } }),
    stopDream: async () => ({ phase: 'canceled', message: '已停止整理', result: null }),
  },
} as unknown as typeof window.agentDesktop;

function Fixture() {
  const [sessionId, setSession] = React.useState('a');
  return <main className="min-h-screen bg-background p-8 text-foreground">
    <div className="mx-auto mt-12 max-w-lg rounded-3xl border border-border bg-card p-6">
      <h2 className="text-sm font-medium">全局记忆设置</h2>
      <p className="my-3 text-xs text-muted-foreground">立即整理本机共享的长期记忆。</p>
      <MemoryDreamControl enabled />
    </div>
    <div className="mx-auto mt-24 max-w-lg rounded-3xl border border-border bg-card p-5">
      <textarea className="h-16 w-full resize-none bg-transparent outline-none" placeholder="继续处理任务…" />
      <div className="flex justify-end gap-3"><SessionEffortSelector key={sessionId} sessionId={sessionId} /><button data-switch onClick={() => setSession(id => id === 'a' ? 'b' : 'a')}>切换会话</button></div>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
