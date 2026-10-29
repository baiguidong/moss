import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ResourceHubView, type ResourceHubTab } from '@/components/resource-hub-view';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@/globals.css';

let skills = [
  { name: 'research', slug: 'research', displayName: '资料整理', description: '整理研究资料，提取要点并生成可追溯的摘要。', version: '1.0.0', source: '/fixture/skills/research', isHubInstalled: true },
  { name: 'builtin', slug: 'builtin', displayName: '内置技能', description: '随 Moss 提供的技能。', source: '/fixture/builtin/skill', isBuiltin: true },
];
let experts = [
  { id: 'analyst', name: 'analyst', displayName: '分析专家', description: '分析问题并提供有依据的建议。', type: 'agent', promptFile: 'assistant.md', source: '/fixture/assistants/analyst' },
  { id: 'team', name: 'team', displayName: '研究团队', description: '协作完成研究任务。', type: 'team', members: [{ id: 'member', displayName: '研究员', localPromptFile: 'member.md' }], source: '/fixture/assistants/team' },
];
const remoteSkills = [...skills];
const remoteExperts = [...experts];
const state = {
  calls: [] as { kind: string; sourcePath: string }[],
  mode: 'success',
  confirm: true,
  confirmations: [] as string[],
  finish: () => {},
};
(window as any).__uninstall = state;
window.confirm = message => { state.confirmations.push(String(message)); return state.confirm; };
async function uninstall(kind: string, { sourcePath }: { sourcePath: string }) {
  state.calls.push({ kind, sourcePath });
  if (state.mode === 'fail') return { success: false, error: '测试卸载失败，请重试' };
  if (state.mode === 'throw') throw new Error('测试连接中断');
  if (state.mode === 'pending') await new Promise<void>(resolve => { state.finish = resolve; });
  if (kind === 'skill') skills = skills.filter(item => item.source !== sourcePath);
  else experts = experts.filter(item => item.source !== sourcePath);
  return { success: true };
}
(window as any).agentDesktop = {
  skillHub: {
    getInstalled: async () => ({ success: true, data: [...skills] }),
    fetchCategories: async () => ({ success: true, data: [] }),
    fetchSkills: async () => ({ success: true, data: { skills: remoteSkills, total: remoteSkills.length } }),
    fetchDetail: async ({ slug }: any) => ({ success: true, data: { skill: remoteSkills.find(item => item.slug === slug) } }),
    uninstall: (input: any) => uninstall('skill', input),
  },
  expertHub: {
    getInstalled: async () => ({ success: true, data: [...experts] }),
    fetchCategories: async () => ({ success: true, data: { categories: [] } }),
    fetchScenes: async () => ({ success: true, data: { scenes: [] } }),
    fetchFeatured: async () => ({ success: true, data: { experts: remoteExperts, hasMore: false } }),
    fetchExperts: async () => ({ success: true, data: { experts: remoteExperts, hasMore: false } }),
    fetchDetail: async ({ expertId }: any) => ({ success: true, data: remoteExperts.find(item => item.id === expertId) }),
    uninstall: (input: any) => uninstall('expert', input),
  },
  preview: { readFile: async () => ({ contentType: 'markdown', content: '# 资源说明\n测试说明内容。' }) },
};
function Fixture() {
  const [tab, setTab] = React.useState<ResourceHubTab>('common');
  return <TooltipProvider><main className="h-screen overflow-hidden"><ResourceHubView activeTab={tab} onChangeTab={setTab} apps={[]} appsContent={null} /></main></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
