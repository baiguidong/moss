import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectWorkspace } from '@/components/projects/project-workspace';
import { AppToolSelectionContext } from '@/lib/app-tool-selection';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Project } from '@/types';
import '@/globals.css';
const actions: string[] = [];
const assets: any[] = [];
(window as any).projectFixture = { actions };
const projects: Project[] = Array.from({ length: 75 }, (_, index) => ({
  id: `project-${index}`, name: `项目 ${String(index + 1).padStart(2, '0')}`,
  icon: index === 0 ? { kind: 'generated', color: 'violet', paths: ['M4 20 12 4l8 16Z'] } : index === 1 ? { kind: 'builtin', name: 'book', color: 'blue' } : undefined,
  instructions: index === 23 ? '# 协作规则\n\n' + '- 按最新资料推进任务。\n'.repeat(40) : index === 74 ? '寻找这段独特的客户研究描述' : '持续收集用户反馈，分析需求，整理可执行的改进建议和项目成果。',
  skillIds: ['research', 'writing'], expertIds: ['analyst'], connectorIds: [], appIds: ['docs'],
  createdAt: 1700000000000 + index * 3600000, updatedAt: 1800000000000 - index * 3600000,
  sessionCount: index + 1, assetCount: index % 4,
}));
window.agentDesktop = {
  getProject: async ({ projectId }) => projects.find(project => project.id === projectId),
  listProjectAssets: async ({ projectId }) => assets.filter(asset => asset.projectId === projectId),
  pickFiles: async () => [{ path: '/tmp/reference.md', name: 'reference.md' }],
  addProjectAsset: async ({ projectId, sourcePath, fileName }) => { actions.push('upload'); assets.push({ id: 'asset-1', projectId, path: sourcePath, name: fileName }); },
  organizeProjectMemory: async () => { actions.push('organize'); return {}; },
  projectResources: async (payload: any) => {
    const resources = ['research', 'writing', 'analyst', 'docs'].map(id => ({ id, kind: payload.kind, displayName: id, installed: true }));
    return payload.action === 'inspect' ? resources.find(entry => entry.id === payload.id) : { resources, total: resources.length, hasMore: false };
  }, listProjectTasks: async () => [], listProjectEvents: async () => [],
  getProjectMemory: async () => ({ overview: '' }),
  listApps: async () => [], onAppsChanged: () => () => {},
  createProject: async input => {
    const project = { ...input, id: 'created-manual', createdAt: Date.now(), updatedAt: Date.now(), connectorIds: [] } as Project;
    projects.push(project); return project;
  },
  updateProject: async ({ projectId, updates }) => {
    const project = projects.find(item => item.id === projectId)!;
    Object.assign(project, updates); return { ...project };
  },
} as unknown as Window['agentDesktop'];
function Fixture() {
  const [managerOpen, setManagerOpen] = React.useState(false);
  const managerContext = React.useContext(AppToolSelectionContext);
  const [items, setItems] = React.useState(projects.slice());
  const [activeProjectId, setActiveProjectId] = React.useState<string | null>(null);
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState<string[]>([]);
  return <TooltipProvider><main className="h-screen overflow-hidden">
    <AppToolSelectionContext.Provider value={{ ...managerContext, openManager: () => setManagerOpen(true) }}>{managerOpen ? <button onClick={() => setManagerOpen(false)}>返回项目编辑</button> : <ProjectWorkspace projects={items} activeProjectId={activeProjectId} refreshSignal={0} onActiveProjectChange={setActiveProjectId}
      onProjectsChange={async () => setItems(projects.slice())} onOpenSession={() => {}} onNewSession={() => actions.push('session')}
      creationPrompt={prompt} onCreationPromptChange={setPrompt} creatingProjectSession={busy}
      onCreateProjectConversation={async value => { setBusy(true); setSent(previous => [...previous, value]); await new Promise(resolve => setTimeout(resolve, 150)); setPrompt(''); setBusy(false); }} />}</AppToolSelectionContext.Provider>
    <output data-sent hidden>{JSON.stringify(sent)}</output>
  </main></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
