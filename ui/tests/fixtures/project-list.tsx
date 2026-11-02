import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectWorkspace } from '@/components/projects/project-workspace';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Project } from '@/types';
import '@/globals.css';
const projects: Project[] = Array.from({ length: 75 }, (_, index) => ({
  id: `project-${index}`, name: `项目 ${String(index + 1).padStart(2, '0')}`,
  icon: index === 0 ? { kind: 'generated', color: 'violet', paths: ['M4 20 12 4l8 16Z'] } : index === 1 ? { kind: 'builtin', name: 'book', color: 'blue' } : undefined,
  instructions: index === 74 ? '寻找这段独特的客户研究描述' : '持续收集用户反馈，分析需求，整理可执行的改进建议和项目成果。',
  skillIds: ['research', 'writing'], expertIds: ['analyst'], connectorIds: [], appIds: ['docs'],
  createdAt: 1700000000000 + index * 3600000, updatedAt: 1800000000000 - index * 3600000,
  sessionCount: index + 1, assetCount: index % 4,
}));
window.agentDesktop = {
  getProject: async ({ projectId }) => projects.find(project => project.id === projectId),
  listProjectAssets: async () => [], listProjectTasks: async () => [], listProjectEvents: async () => [],
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
  const [items, setItems] = React.useState(projects.slice());
  const [activeProjectId, setActiveProjectId] = React.useState<string | null>(null);
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState<string[]>([]);
  return <TooltipProvider><main className="h-screen overflow-hidden">
    <ProjectWorkspace projects={items} activeProjectId={activeProjectId} refreshSignal={0} onActiveProjectChange={setActiveProjectId}
      onProjectsChange={async () => setItems(projects.slice())} onOpenSession={() => {}} onNewSession={() => {}}
      creationPrompt={prompt} onCreationPromptChange={setPrompt} creatingProjectSession={busy}
      onCreateProjectConversation={async value => { setBusy(true); setSent(previous => [...previous, value]); await new Promise(resolve => setTimeout(resolve, 150)); setPrompt(''); setBusy(false); }} />
    <output data-sent hidden>{JSON.stringify(sent)}</output>
  </main></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
