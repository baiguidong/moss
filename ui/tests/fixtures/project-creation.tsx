import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectCreationDraftCard } from '@/components/projects/project-creation-draft-card';
import type { ProjectCreationDraft } from '@/types';
import '@/globals.css';

const initial: ProjectCreationDraft = {
  id: 'draft-fixture', sessionId: 'session-fixture', version: 1, status: 'awaiting_confirmation',
  project: { name: '客户研究', icon: { kind: 'generated', color: 'violet', paths: ['M15 9a6 6 0 1 1-12 0 6 6 0 0 1 12 0', 'M13 13l8 8', 'M6 9h6M9 6v6'] }, instructions: '收集用户反馈\n分析客户需求\n给出改进建议\n保留来源\n完整展示第五行指令', workspaces: [], mode: 'chat', permissionMode: 'default', agentTeamsEnabled: true },
  resources: [
    { kind: 'skill', id: 'research', displayName: '用户研究', installed: false, version: '1.0', source: 'marketplace' },
    { kind: 'expert', id: 'analyst', displayName: '分析专家', installed: true, source: 'builtin' },
    { kind: 'app', id: 'docs', displayName: '文档', installed: true, source: 'installed', toolSelection: 'services', permissions: ['document:read'], services: [{ id: '["docs","read"]', title: '读取文档', available: true }, { id: '["docs","write"]', title: '写入文档', available: false }] },
  ], createdAt: 1, updatedAt: 1,
};
window.agentDesktop = { pickDirectory: async () => '/tmp/project-fixture' } as unknown as Window['agentDesktop'];
function Fixture() {
  const [draft, setDraft] = React.useState(initial);
  const [action, setAction] = React.useState('');
  const [patch, setPatch] = React.useState({});
  return <main className="mx-auto max-w-3xl p-4">
    <ProjectCreationDraftCard draft={draft} onConfirm={() => { setAction('confirmed'); setDraft({ ...draft, status: 'awaiting_authorization', pendingActions: [{ appId: 'docs', displayName: '文档', message: '请先连接' }] }); }}
      onCancel={() => { setAction('cancelled'); setDraft({ ...draft, status: 'cancelled' }); }}
      onSave={async patch => { setPatch(patch); setDraft({ ...draft, version: draft.version + 1, project: { ...draft.project, ...patch }, firstTask: patch.firstTask, resources: draft.resources.filter(entry => (patch[`${entry.kind}Ids`] || []).includes(entry.id)) }); }}
      onConfigureApp={id => setAction(`configure:${id}`)} onDiscuss={() => setAction('discuss')}
      onOpenProject={() => setAction('project')} onOpenSession={id => setAction(`session:${id}`)} />
    <output data-action>{action}</output><output data-patch>{JSON.stringify(patch)}</output>
    <button onClick={() => setDraft({ ...draft, status: 'failed', error: '下载失败' })}>模拟安装失败</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
