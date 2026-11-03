import * as React from 'react';
import {
  ArrowLeft,
  RefreshCw,
  FileText,
  FolderKanban,
  ListChecks,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ProjectCreationComposer } from '@/components/projects/project-creation-composer';
import { ProjectIcon, ProjectIconPicker } from '@/components/projects/project-icon';
import { ResourceHubSearch } from '@/components/resource-hub-search';
import { ProjectDefaultsFields } from '@/components/projects/project-defaults-fields';
import { ProjectResourcePicker } from '@/components/projects/project-resource-picker';
import { ProjectTasksTab } from '@/components/projects/project-tasks-tab';
import { MarkdownRenderer } from '@/components/markdown/markdown-renderer';
import { cn } from '@/lib/utils';
import { ProjectInstructionsField } from './project-instructions-field';
import { PanelResizeHandle } from '@/components/panel-resize-handle';
import { useSessionPanelLayout, type SessionPanelLayout } from '@/lib/use-session-panel-layout';
import { formatProjectMemoryForDisplay } from '../../../shared/project-memory.mjs';
import type {
  Project,
  ProjectAsset,
  ProjectEvent,
  ProjectMemory,
  ProjectTask,
} from '@/types';

type ProjectTab = 'activity' | 'tasks' | 'assets';

type ProjectWorkspaceProps = {
  projects: Project[];
  activeProjectId: string | null;
  refreshSignal: number;
  onActiveProjectChange: (projectId: string | null) => void;
  onProjectsChange: () => Promise<void>;
  onOpenSession: (sessionId: string) => void;
  creationPrompt: string;
  onCreationPromptChange: (value: string) => void;
  creatingProjectSession: boolean;
  onCreateProjectConversation: (prompt: string) => Promise<void>;
  onNewSession: (project: Project) => void;
};

type ProjectFormState = Partial<Omit<Project, 'connectorIds'>> & {
  name: string;
  instructions: string;
  templateId: string | null;
  expertIds: string[];
  skillIds: string[];
};

const EMPTY_FORM: ProjectFormState = {
  name: '',
  instructions: '',
  templateId: null,
  expertIds: [],
  skillIds: [],
  permissionMode: 'bypassPermissions',
};

const NEW_PROJECT_DRAFT_KEY = 'ui.newProjectDraft';
const projectDraftKey = (id: string) => `ui.projectConfigDraft:${id}`;
function readFormDraft(key: string, updatedAt?: number): ProjectFormState | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    return saved?.form && saved.updatedAt === updatedAt ? saved.form : null;
  } catch { return null; }
}
function saveFormDraft(key: string, form: ProjectFormState | null, updatedAt?: number) {
  try {
    if (form) sessionStorage.setItem(key, JSON.stringify({ form, updatedAt }));
    else sessionStorage.removeItem(key);
  } catch {}
}

function projectFormFromProject(project: Project): ProjectFormState {
  const { connectorIds: _legacyConnectorIds, ...rest } = project;
  const resourceId = (kind: string, id: string) => project.resourceBindings?.find(entry => entry.kind === kind && (entry.id === id || entry.runtimeId === id))?.id || id;
  return {
    ...rest,
    name: project.name,
    instructions: project.instructions,
    templateId: project.templateId || null,
    expertIds: (project.expertIds || []).map(id => resourceId('expert', id)),
    skillIds: (project.skillIds || []).map(id => resourceId('skill', id)),
    assistantName: project.assistantName ? resourceId('expert', project.assistantName) : project.assistantName,
  };
}

const TABS: Array<{ id: ProjectTab; label: string }> = [
  { id: 'activity', label: '概览' },
  { id: 'tasks', label: '会话' },
  { id: 'assets', label: '成果' },
];

function formatTime(timestamp?: number | null) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(size?: number) {
  const value = Number(size) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function projectEventIcon(type: string) {
  if (type.startsWith('decision.')) return <MessageSquarePlus className="h-4 w-4 text-amber-600" />;
  if (type.startsWith('task.')) return <ListChecks className="h-4 w-4 text-primary" />;
  if (type.startsWith('asset.')) return <FileText className="h-4 w-4 text-primary" />;
  if (type.startsWith('session.')) return <MessageSquarePlus className="h-4 w-4 text-primary" />;
  return <FolderKanban className="h-4 w-4 text-muted-foreground" />;
}

function NewProjectDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const [form, setForm] = React.useState<ProjectFormState>(() => readFormDraft(NEW_PROJECT_DRAFT_KEY) || EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);
  const [savingStatus, setSavingStatus] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setForm(readFormDraft(NEW_PROJECT_DRAFT_KEY) || EMPTY_FORM);
      setSavingStatus('');
      setError('');
    }
  }, [open]);

  React.useEffect(() => { if (open) saveFormDraft(NEW_PROJECT_DRAFT_KEY, form); }, [open, form]);
  const close = () => { saveFormDraft(NEW_PROJECT_DRAFT_KEY, null); onClose(); };

  if (!open) return null;

  const createProject = async () => {
    if (!form.name.trim()) {
      setError('项目名称不能为空');
      return;
    }
    setSaving(true);
    setSavingStatus('正在准备项目...');
    setError('');
    try {
      setSavingStatus('正在创建项目...');
      const project = await window.agentDesktop.createProject({
        ...form,
        name: form.name.trim(),
        instructions: form.instructions,
        templateId: form.templateId,
        expertIds: form.expertIds,
        skillIds: form.skillIds,
      });
      onCreated(project);
      close();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
      setSavingStatus('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm">
      <div className="flex h-[86vh] max-h-[760px] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
        <div className="shrink-0 flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-foreground">新建项目</div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={close} disabled={saving}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1 overflow-hidden">
          <div className="space-y-5 p-5 pb-8">
            <ProjectIconPicker value={form.icon} disabled={saving} onChange={icon => setForm(current => ({ ...current, icon }))} />
            <div className="grid gap-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>项目名称</span>
                <span>{form.name.length}/30</span>
              </div>
              <Input
                value={form.name}
                maxLength={30}
                placeholder="项目"
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>

            <ProjectInstructionsField value={form.instructions} disabled={saving} onChange={instructions => setForm(current => ({ ...current, instructions }))} />

            <ProjectResourcePicker
              kind="skill"
              title="添加技能"
              selectedIds={form.skillIds}
              onChange={(skillIds) => setForm((prev) => ({ ...prev, skillIds }))}
            />
            <ProjectResourcePicker
              kind="expert"
              multiple={false}
              title="默认助手"
              selectedIds={form.expertIds}
              onChange={(expertIds) => setForm((prev) => ({ ...prev, expertIds, assistantName: expertIds.length === 1 ? expertIds[0] : '' }))}
            />
            <ProjectDefaultsFields value={form} onChange={patch => setForm(current => ({ ...current, ...patch }))} />
            {error && <div className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</div>}
          </div>
        </ScrollArea>
        <div className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-t border-border bg-background px-5 py-4">
          <div aria-live="polite" className="min-w-0 truncate text-xs text-muted-foreground">
            {savingStatus}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={close} disabled={saving}>取消</Button>
            <Button className="min-w-[112px]" onClick={createProject} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderKanban className="h-4 w-4" />}
              {saving ? '创建中' : '创建项目'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectList({
  projects,
  query,
  onQueryChange,
  onOpen,
  onRename,
  onDelete,
  creationPrompt,
  onCreationPromptChange,
  creatingProjectSession,
  onCreateProjectConversation,
  onNew,
}: {
  projects: Project[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpen: (projectId: string) => void;
  onRename: (project: Project, name: string) => Promise<void>;
  onDelete: (project: Project) => Promise<void>;
  creationPrompt: string;
  onCreationPromptChange: (value: string) => void;
  creatingProjectSession: boolean;
  onCreateProjectConversation: (prompt: string) => Promise<void>;
  onNew: () => void;
}) {
  const [deletingProjectId, setDeletingProjectId] = React.useState<string | null>(null);
  const [deleteError, setDeleteError] = React.useState('');
  const [renameTarget, setRenameTarget] = React.useState<Project | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [renaming, setRenaming] = React.useState(false);
  const [renameError, setRenameError] = React.useState('');
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const renameFocusRequestedRef = React.useRef(false);
  const [sort, setSort] = React.useState('updated');
  const [visibleCount, setVisibleCount] = React.useState(24);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLElement>(null);
  const moreRef = React.useRef<HTMLDivElement>(null);
  const filtered = React.useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return projects.filter(project => [project.name, project.instructions, project.id].some(value => value?.toLocaleLowerCase().includes(needle)))
      .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : (sort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id));
  }, [projects, query, sort]);
  const shown = filtered.slice(0, visibleCount);
  const hasMore = shown.length < filtered.length;
  React.useEffect(() => { setVisibleCount(24); }, [query, sort]);
  React.useEffect(() => {
    if (!hasMore || !moreRef.current || !scrollRef.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisibleCount(count => Math.min(count + 24, filtered.length));
    }, { root: scrollRef.current, rootMargin: '0px 0px 240px 0px' });
    observer.observe(moreRef.current);
    return () => observer.disconnect();
  }, [hasMore, visibleCount, filtered.length]);
  const scrollToList = () => {
    const viewport = scrollRef.current, list = listRef.current;
    if (viewport && list) viewport.scrollTop += list.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  };

  React.useEffect(() => {
    if (!renameTarget) return;
    const timer = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 100);
    return () => window.clearTimeout(timer);
  }, [renameTarget]);

  const openRenameDialog = (project: Project) => {
    renameFocusRequestedRef.current = true;
    setRenameTarget(project);
    setRenameValue(project.name);
    setRenameError('');
  };

  const closeRenameDialog = () => {
    if (renaming) return;
    renameFocusRequestedRef.current = false;
    setRenameTarget(null);
    setRenameValue('');
    setRenameError('');
  };

  const renameProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) {
      setRenameError('项目名称不能为空');
      return;
    }
    if (name === renameTarget.name) {
      closeRenameDialog();
      return;
    }
    setRenaming(true);
    setRenameError('');
    try {
      await onRename(renameTarget, name);
      setRenameTarget(null);
      setRenameValue('');
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenaming(false);
    }
  };

  const deleteProject = async (project: Project) => {
    if (!window.confirm(`删除项目「${project.name}」？\n\n项目将从列表中隐藏，相关任务、资产、会话和文件仍会保留。`)) return;
    setDeletingProjectId(project.id);
    setDeleteError('');
    try {
      await onDelete(project);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingProjectId(null);
    }
  };

  return (
    <div ref={scrollRef} data-project-list-scroll className="h-full min-h-0 min-w-0 overflow-y-auto overscroll-contain bg-background [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-5">
        <ProjectCreationComposer value={creationPrompt} onChange={onCreationPromptChange} busy={creatingProjectSession} onSend={onCreateProjectConversation} />
        <section ref={listRef} aria-label="我的项目" className="pb-6">
          <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 bg-background/95 px-1 py-3 backdrop-blur">
            <h2 className="mr-1 shrink-0 text-sm font-semibold">我的项目 <span className="ml-1 font-normal text-muted-foreground">{filtered.length}</span></h2>
            <ResourceHubSearch value={query} onChange={value => { onQueryChange(value); scrollToList(); }} label="搜索项目" placeholder="搜索项目名称或描述" />
            <select aria-label="项目排序" className="h-8 rounded-lg border border-border/50 bg-muted/40 px-2 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={sort} onChange={event => { setSort(event.target.value); scrollToList(); }}>
              <option value="updated">最近更新</option><option value="created">最近创建</option><option value="name">名称排序</option>
            </select>
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground" onClick={onNew}><Plus className="h-3.5 w-3.5" />使用表单创建</Button></TooltipTrigger><TooltipContent>手动填写项目名称、指令、资源和默认设置</TooltipContent></Tooltip>
          </div>
          {deleteError ? (
            <div className="mt-3 text-sm text-destructive">{deleteError}</div>
          ) : null}
          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((project) => (
                <div
                  key={project.id}
                  data-project-card={project.id}
                  className="group relative min-w-0 rounded-lg border border-border/70 bg-card/82 p-2.5"
                >
                  <button type="button" aria-label={`打开项目：${project.name}`} onClick={() => onOpen(project.id)}
                    className="absolute inset-0 cursor-pointer rounded-lg transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" />
                  <div className="pointer-events-none relative flex min-w-0 items-start gap-2.5">
                    <ProjectIcon icon={project.icon} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate pr-8 text-sm font-semibold text-foreground" title={project.name}>{project.name}</h3>
                      <p className="mt-0.5 truncate pr-8 text-xs text-muted-foreground">{formatTime(project.updatedAt)} 更新</p>
                      <p className="mt-2 line-clamp-2 h-9 text-xs leading-[18px] text-muted-foreground">{project.instructions || '汇集项目会话、资源和成果'}</p>
                      <p className="mt-2 truncate text-xs text-muted-foreground">{[
                        project.skillIds?.length ? `${project.skillIds.length} 技能` : '',
                        project.expertIds?.length ? `${project.expertIds.length} 专家` : '',
                        project.appIds?.length ? `${project.appIds.length} App` : '',
                        project.appServiceIds?.length ? `${project.appServiceIds.length} 服务` : '',
                      ].filter(Boolean).join(' · ') || '暂未配置资源'}</p>
                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground"><span>{project.sessionCount || 0} 会话</span><span>{project.assetCount || 0} 成果</span></div>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="absolute right-2 top-2 h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                        disabled={deletingProjectId !== null}
                        title={`${project.name} 更多操作`}
                        aria-label={`${project.name} 更多操作`}
                      >
                        {deletingProjectId === project.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MoreHorizontal className="h-4 w-4" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-36"
                      onCloseAutoFocus={(event) => {
                        if (!renameFocusRequestedRef.current) return;
                        event.preventDefault();
                        renameFocusRequestedRef.current = false;
                      }}
                    >
                      <DropdownMenuItem onSelect={() => openRenameDialog(project)}>
                        <Pencil className="h-4 w-4" />
                        重命名
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => void deleteProject(project)}>
                        <Trash2 className="h-4 w-4" />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
              <div className="text-sm font-medium text-foreground">{query ? '未找到相关项目' : '暂无项目'}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {query ? '试试其他关键词，或清空搜索查看全部项目' : '在上方描述你的目标，开始创建第一个项目。'}
              </div>
            </div>
          )}
          {filtered.length > 0 && <div ref={moreRef} className="flex h-16 items-center justify-center text-xs text-muted-foreground">
            {hasMore ? <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={() => setVisibleCount(count => count + 24)}>继续下滑加载更多</Button> : <span>已显示全部 {filtered.length} 个项目</span>}
          </div>}
        </section>
      </div>
      {renameTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeRenameDialog();
          }}
        >
          <form
            className="w-full max-w-sm overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
            onSubmit={renameProject}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="text-sm font-semibold text-foreground">重命名项目</div>
              <Button type="button" variant="ghost" size="icon-sm" onClick={closeRenameDialog} disabled={renaming}>
                <X className="h-4 w-4" />
                <span className="sr-only">关闭</span>
              </Button>
            </div>
            <div className="p-4">
              <label className="mb-2 block text-xs font-medium text-muted-foreground" htmlFor="rename-project-name">
                项目名称
              </label>
              <Input
                id="rename-project-name"
                ref={renameInputRef}
                maxLength={30}
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                disabled={renaming}
              />
              {renameError ? <div className="mt-2 text-xs text-destructive">{renameError}</div> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button type="button" variant="outline" onClick={closeRenameDialog} disabled={renaming}>取消</Button>
              <Button type="submit" disabled={renaming || !renameValue.trim()}>
                {renaming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                保存
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ProjectConfigPanel({
  project,
  open,
  onSaved,
  width,
  onBeginResize,
  onRestoreSplit,
}: {
  project: Project;
  open: boolean;
  width: number;
  onBeginResize: () => (delta: number) => void;
  onRestoreSplit: () => void;
  onSaved: (project: Project) => void;
}) {
  const [draft, setDraft] = React.useState<ProjectFormState>(() => readFormDraft(projectDraftKey(project.id), project.updatedAt) || projectFormFromProject(project));
  const [saving, setSaving] = React.useState(false);
  const [savingStatus, setSavingStatus] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    saveFormDraft(projectDraftKey(project.id), JSON.stringify(draft) === JSON.stringify(projectFormFromProject(project)) ? null : draft, project.updatedAt);
  }, [draft, project]);

  const save = async () => {
    if (!draft.name.trim()) {
      setError('项目名称不能为空');
      return;
    }
    setSaving(true);
    setSavingStatus('正在准备资源并保存...');
    setError('');
    try {
      const saved = await window.agentDesktop.updateProject({
        projectId: project.id,
        updates: draft,
      });
      setDraft(projectFormFromProject(saved));
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setSavingStatus('');
    }
  };

  if (!open) return null;

  return (
    <aside aria-label="项目设置" style={{ width }} className="relative flex h-full min-h-0 max-w-full shrink-0 flex-col border-l border-border bg-background">
      <PanelResizeHandle width={width} onBeginResize={onBeginResize} onRestoreSplit={onRestoreSplit} label="调整项目设置宽度" />
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          <ProjectIconPicker value={draft.icon} disabled={saving} onChange={icon => setDraft(current => ({ ...current, icon }))} />
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">项目名称</div>
            <Input
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              className="h-8 text-xs"
            />
          </div>
          <ProjectInstructionsField value={draft.instructions} disabled={saving} onChange={instructions => setDraft(current => ({ ...current, instructions }))} />
          <ProjectResourcePicker
            kind="skill"
            title="添加技能"
            selectedIds={draft.skillIds}
            onChange={(skillIds) => setDraft((prev) => ({ ...prev, skillIds }))}
          />
          <ProjectResourcePicker
            kind="expert"
            multiple={false}
            title="默认助手"
            selectedIds={draft.expertIds}
            onChange={(expertIds) => setDraft((prev) => ({ ...prev, expertIds, assistantName: expertIds.length === 1 ? expertIds[0] : '' }))}
          />
          <ProjectDefaultsFields value={draft} onChange={patch => setDraft(current => ({ ...current, ...patch }))} />
          {error ? <div className="text-xs text-destructive">{error}</div> : null}
        </div>
      </ScrollArea>
      <div className="border-t border-border p-4">
        {savingStatus ? (
          <div aria-live="polite" className="mb-2 truncate text-xs text-muted-foreground">{savingStatus}</div>
        ) : null}
        <Button className="w-full" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saving ? '保存中' : '保存配置'}
        </Button>
      </div>
    </aside>
  );
}

// Registered session results and imported project references.
function ProjectAssetsTab({
  projectId,
  assets,
  onReload,
  onOpenSession,
}: {
  projectId: string;
  assets: ProjectAsset[];
  onReload: () => Promise<void>;
  onOpenSession: (sessionId: string) => void;
}) {
  const [error, setError] = React.useState('');
  const [busyAssetId, setBusyAssetId] = React.useState<string | null>(null);
  const [assetQuery, setAssetQuery] = React.useState('');

  const remove = async (assetId: string) => {
    setBusyAssetId(assetId);
    setError('');
    try {
      await window.agentDesktop.removeProjectAsset({ projectId, assetId });
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAssetId(null);
    }
  };

  const open = async (asset: ProjectAsset) => {
    setError('');
    try {
      await window.agentDesktop.shell.openFile(asset.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const visibleAssets = assets.filter((asset) => {
    if (!assetQuery.trim()) return true;
    return asset.name.toLocaleLowerCase().includes(assetQuery.trim().toLocaleLowerCase());
  });

  return (
    <div className="grid min-h-0 gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative min-w-0 max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder={`${assets.length} 项成果和资料中搜索`} className="pl-8" />
        </div>
      </div>
      {error ? <div className="text-sm text-destructive">{error}</div> : null}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="hidden grid-cols-[minmax(0,1fr)_100px_110px_120px] border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground md:grid">
          <div>名称</div>
          <div>大小</div>
          <div>更新</div>
          <div className="text-right">操作</div>
        </div>
        {visibleAssets.length > 0 ? visibleAssets.map((asset) => {
                return (
          <div key={asset.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-border/70 px-4 py-3 text-sm last:border-b-0 md:grid-cols-[minmax(0,1fr)_100px_110px_120px] md:gap-0 md:py-2">
            <div className="col-span-2 min-w-0 md:col-span-1">
              <div className="truncate font-medium text-foreground">{asset.name}</div>
              <div className="truncate text-xs text-muted-foreground">{asset.relativePath || asset.fileName || asset.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{asset.sourceType === 'session_output' ? '会话成果' : '项目资料'}
                {asset.sourceSessionId && <button type="button" className="ml-2 text-primary hover:underline" onClick={() => onOpenSession(asset.sourceSessionId!)}>查看来源会话</button>}
              </div>
            </div>
            <div className="hidden text-xs text-muted-foreground md:block">{formatBytes(asset.size)}</div>
            <div className="hidden text-xs text-muted-foreground md:block">{formatTime(asset.updatedAt)}</div>

            <div className="flex justify-end gap-1">

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void open(asset)}
                disabled={busyAssetId !== null}
                title="打开成果"
                aria-label={`打开成果：${asset.name}`}
              >
                <FileText className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void remove(asset.id)}
                disabled={busyAssetId !== null}
                title="移除成果"
                aria-label={`移除成果：${asset.name}`}
              >
                {busyAssetId === asset.id
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Trash2 className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          );
        }) : (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">{assets.length ? '没有匹配的成果' : '暂无成果'}</div>
        )}
      </div>
    </div>
  );
}

// The project page aggregates ordinary sessions and their results.
function ProjectDetail({
  project,
  refreshSignal,
  onBack,
  onProjectSaved,
  onProjectsChange,
  onOpenSession,
  onNewSession,
}: {
  project: Project;
  refreshSignal: number;
  onBack: () => void;
  onProjectSaved: (project: Project) => void;
  onProjectsChange: () => Promise<void>;
  onOpenSession: (sessionId: string) => void;
  onNewSession: (project: Project) => void;
}) {
  const [activeTab, setActiveTab] = React.useState<ProjectTab>('activity');
  const [detail, setDetail] = React.useState<Project>(project);
  const [assets, setAssets] = React.useState<ProjectAsset[]>([]);
  const [tasks, setTasks] = React.useState<ProjectTask[]>([]);
  const [events, setEvents] = React.useState<ProjectEvent[]>([]);
  const [memory, setMemory] = React.useState<ProjectMemory | null>(null);
  const [memoryNote, setMemoryNote] = React.useState('');
  const [memoryPending, setMemoryPending] = React.useState(false);
  const [loadError, setLoadError] = React.useState('');
  const [uploading, setUploading] = React.useState(false);
  const [layout, setLayout] = React.useState<SessionPanelLayout>(() => {
    let width = 360;
    try { width = Number(localStorage.getItem('ui.projectSettingsWidth')) || width; } catch {}
    return { rightWidth: Math.max(320, width), rightCollapsed: true, rightExpanded: false };
  });
  const configOpen = !layout.rightCollapsed;
  const setConfigOpen = (open: boolean) => setLayout(current => ({ ...current, rightCollapsed: !open, rightExpanded: false }));
  const updateLayout = React.useCallback((patch: Partial<SessionPanelLayout>) => setLayout(current => ({ ...current, ...patch })), []);
  const panel = useSessionPanelLayout({ enabled: true, layout, onChange: updateLayout });
  React.useEffect(() => { try { localStorage.setItem('ui.projectSettingsWidth', String(layout.rightWidth)); } catch {} }, [layout.rightWidth]);
  const reloadRequestIdRef = React.useRef(0);

  const reload = React.useCallback(async () => {
    const requestId = ++reloadRequestIdRef.current;
    try {
      const [nextProject, nextAssets, nextTasks, nextEvents, nextMemory] = await Promise.all([
        window.agentDesktop.getProject({ projectId: project.id }),
        window.agentDesktop.listProjectAssets({ projectId: project.id }),
        window.agentDesktop.listProjectTasks({ projectId: project.id }),
        window.agentDesktop.listProjectEvents({ projectId: project.id }),
        window.agentDesktop.getProjectMemory({ projectId: project.id }),
      ]);
      if (reloadRequestIdRef.current !== requestId) return;
      setDetail(nextProject);
      setAssets(nextAssets);
      setTasks(nextTasks);
      setEvents(nextEvents);
      setMemory(nextMemory);
      setLoadError('');
      await onProjectsChange();
    } catch (err) {
      if (reloadRequestIdRef.current === requestId) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
      throw err;
    }
  }, [onProjectsChange, project.id]);

  React.useEffect(() => {
    reloadRequestIdRef.current += 1;
    setDetail(project);
    setAssets([]);
    setTasks([]);
    setEvents([]);
    setMemory(null);
    setLoadError('');
    setConfigOpen(Boolean(readFormDraft(projectDraftKey(project.id), project.updatedAt)));
  }, [project.id]);

  React.useEffect(() => {
    void reload().catch(() => {});
  }, [reload, refreshSignal]);

  React.useEffect(() => {
    if (memory?.maintenance?.phase !== 'running') return;
    const timer = setInterval(() => { void reload().catch(() => {}); }, 2000);
    return () => clearInterval(timer);
  }, [memory?.maintenance?.phase, reload]);
  const updateMemory = async (note = false) => {
    setMemoryPending(true);
    try {
      if (note) {
        await window.agentDesktop.noteProjectMemory({ projectId: project.id, text: memoryNote });
        setMemoryNote('');
      } else await window.agentDesktop.organizeProjectMemory({ projectId: project.id });
      await reload();
    } catch (error) { setLoadError(error instanceof Error ? error.message : String(error)); }
    finally { setMemoryPending(false); }
  };

  const upload = async () => {
    if (uploading) return;
    setUploading(true);
    setLoadError('');
    try {
      const files = await window.agentDesktop.pickFiles();
      if (!files.length) return;
      for (const file of files) await window.agentDesktop.addProjectAsset({ projectId: project.id, sourcePath: file.path, fileName: file.name });
      await reload();
      setActiveTab('assets');
    } catch (error) {
      await reload().catch(() => {});
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally { setUploading(false); }
  };

  const recentEvents = events.slice(0, 30);
  const memoryOverview = formatProjectMemoryForDisplay(memory?.overview || '');

  const openEventTarget = (event: ProjectEvent) => {
    if (event.targetType === 'session' && event.targetId) {
      onOpenSession(event.targetId);
    } else if (event.targetType === 'task') {
      setActiveTab('tasks');
    } else if (event.targetType === 'asset') {
      setActiveTab('assets');
    } else if (event.targetType === 'decision') {
      // Historical decision events still link to their original conversation.
      const sessionId = event.metadata?.parentSessionId;
      if (typeof sessionId === 'string' && sessionId) onOpenSession(sessionId);
      else setActiveTab('tasks');
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2" data-project-toolbar>
            <Button variant="ghost" size="sm" className="shrink-0 px-2" onClick={onBack} aria-label="返回项目" title="返回项目">
              <ArrowLeft className="h-4 w-4" /><span className="hidden xl:inline">返回项目</span>
            </Button>
            <ProjectIcon icon={detail.icon} className="h-8 w-8" />
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground" title={detail.name}>{detail.name}</h1>
            <Button variant="ghost" size="sm" className="shrink-0 px-2" onClick={() => onNewSession(detail)} aria-label="新会话" title="新会话">
              <MessageSquarePlus className="h-4 w-4" /><span className="hidden md:inline">新会话</span>
            </Button>
            <Button variant="ghost" size="sm" className="shrink-0 px-2" onClick={() => void upload()} disabled={uploading} aria-label="添加资料" title="添加资料">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}<span className="hidden md:inline">添加资料</span>
            </Button>
            <Button variant="ghost" size="sm" className="shrink-0 px-2" onClick={() => void updateMemory()} disabled={memoryPending || memory?.maintenance?.phase === 'running'} aria-label="整理项目" title="整理项目">
              {memoryPending || memory?.maintenance?.phase === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}<span className="hidden md:inline">{memoryPending || memory?.maintenance?.phase === 'running' ? '正在整理…' : '整理项目'}</span>
            </Button>
            <Button variant={configOpen ? 'secondary' : 'ghost'} size="icon-sm" className="shrink-0" onClick={() => setConfigOpen(!configOpen)} aria-label="项目设置" title="项目设置" aria-expanded={configOpen}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5 border-b border-border/0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition',
                  activeTab === tab.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      <div ref={panel.containerRef} className="flex min-h-0 flex-1">
      <div className={cn('flex min-w-0 flex-1 flex-col', configOpen && panel.tabbed && 'hidden')}>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-6">
            {loadError ? (
              <div className="mb-4 rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive">
                {loadError}
              </div>
            ) : null}
            {activeTab === 'activity' && (
              <div className="grid gap-6">
                <section>
                  <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                    <div className="text-sm font-medium text-foreground">项目沉淀</div>
                    <div className="text-xs text-muted-foreground">
                      {memory?.finalizedSessionCount
                        ? `${memory.finalizedSessionCount} 个来源会话${memory.updatedAt ? ` · ${formatTime(memory.updatedAt)}` : ''}`
                        : '尚未沉淀'}
                    </div>
                  </div>
                  {memory?.maintenance?.message && <p role="status" className="mt-2 text-xs text-muted-foreground">{memory.maintenance.message}</p>}
                  {memory?.maintenance?.error && <p className="mt-2 text-xs text-destructive">{memory.maintenance.error}</p>}
                  <div className="max-h-[320px] overflow-auto py-3 text-sm text-muted-foreground">
                    {memoryOverview ? (
                      <MarkdownRenderer
                        content={memoryOverview}
                        variant="compact"
                        sourceId={`project-memory:${detail.id}:${memory?.version || 0}`}
                      />
                    ) : (
                      <div className="py-3 text-sm text-muted-foreground">暂无项目沉淀</div>
                    )}
                  </div>
                  {!!memory?.sourceIds?.length && <div className="flex flex-wrap gap-2 py-2 text-xs">来源会话：{memory.sourceIds.map(id =>
                    <button key={id} type="button" className="text-primary hover:underline" onClick={() => onOpenSession(id)}>{tasks.find(task => task.sessionId === id)?.subject || id.slice(0, 12)}</button>)}</div>}
                  {!!memory?.corrections?.length && <div className="grid gap-1 py-2 text-xs text-muted-foreground">待合并的修正（共 {memory.correctionCount || memory.corrections.length} 条）：{memory.corrections.map(note => <p key={note.id}>{note.text}</p>)}</div>}
                  <div className="flex gap-2 pt-2">
                    <Input aria-label="项目记忆修正" value={memoryNote} onChange={event => setMemoryNote(event.target.value)} placeholder="记住、更正或忘记某项项目知识…" maxLength={12000} />
                    <Button variant="outline" disabled={!memoryNote.trim() || memoryPending} onClick={() => void updateMemory(true)}>保存修正</Button>
                  </div>
                </section>
                <section className="grid gap-2">
                  <div className="flex h-7 items-center justify-between border-b border-border pb-2">
                    <div className="text-sm font-medium text-foreground">项目动态</div>
                    {recentEvents.length > 0 ? <div className="text-xs text-muted-foreground">最近 {recentEvents.length} 条</div> : null}
                  </div>
                  {recentEvents.length > 0 ? (
                    <div className="overflow-hidden rounded-md border border-border">
                      {recentEvents.map((event, index) => {
                        const actionable = ['session', 'task', 'asset', 'decision'].includes(event.targetType);
                        return (
                          <button
                            key={event.id}
                            type="button"
                            disabled={!actionable}
                            onClick={() => openEventTarget(event)}
                            className={cn(
                              'grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 text-left text-sm outline-none',
                              index > 0 && 'border-t border-border',
                              actionable && 'transition-colors hover:bg-accent/45 focus-visible:bg-accent/55',
                            )}
                          >
                            {projectEventIcon(event.type)}
                            <span className="truncate text-foreground" title={event.summary}>{event.summary}</span>
                            <span className="text-xs text-muted-foreground">{formatTime(event.createdAt)}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">暂无动态</div>
                  )}
                </section>
              </div>
            )}
            {activeTab === 'tasks' && (
              <ProjectTasksTab
                project={detail}
                tasks={tasks}
                onOpenSession={onOpenSession}
                onReload={reload}
              />
            )}
            {activeTab === 'assets' && (
              <ProjectAssetsTab
                projectId={detail.id}
                assets={assets}
                onOpenSession={onOpenSession}
                onReload={reload}
              />
            )}
          </div>
        </ScrollArea>
      </div>
      <ProjectConfigPanel
        key={detail.id}
        project={detail}
        open={configOpen}
        width={panel.rightWidth}
        onBeginResize={panel.beginResize}
        onRestoreSplit={panel.restoreSplit}
        onSaved={(saved) => {
          setDetail(saved);
          onProjectSaved(saved);
          void reload().catch(() => {});
        }}
      />
      </div>
    </div>
  );
}

export function ProjectWorkspace({
  projects,
  activeProjectId,
  refreshSignal,
  onActiveProjectChange,
  onProjectsChange,
  onOpenSession,
  creationPrompt,
  onCreationPromptChange,
  creatingProjectSession,
  onCreateProjectConversation,
  onNewSession,
}: ProjectWorkspaceProps) {
  const [query, setQuery] = React.useState('');
  const [dialogOpen, setDialogOpen] = React.useState(() => Boolean(readFormDraft(NEW_PROJECT_DRAFT_KEY)));
  const activeProject = activeProjectId
    ? projects.find((project) => project.id === activeProjectId) || null
    : null;

  React.useEffect(() => {
    if (activeProjectId && !projects.some((project) => project.id === activeProjectId)) {
      onActiveProjectChange(null);
    }
  }, [activeProjectId, onActiveProjectChange, projects]);

  return (
    <>
      {activeProject && (
        <ProjectDetail
          project={activeProject}
          refreshSignal={refreshSignal}
          onBack={() => onActiveProjectChange(null)}
          onProjectSaved={async () => {
            await onProjectsChange();
          }}
          onProjectsChange={onProjectsChange}
          onOpenSession={onOpenSession}
          onNewSession={onNewSession}
        />
      )}
      <div className={activeProject ? 'hidden' : 'h-full min-h-0 min-w-0'} aria-hidden={activeProject ? true : undefined}>
        <ProjectList
          projects={projects}
          query={query}
          onQueryChange={setQuery}
          onOpen={onActiveProjectChange}
          onRename={async (project, name) => {
            await window.agentDesktop.updateProject({
              projectId: project.id,
              updates: { name },
            });
            await onProjectsChange();
          }}
          onDelete={async (project) => {
            await window.agentDesktop.archiveProject({ projectId: project.id });
            await onProjectsChange();
          }}
          creationPrompt={creationPrompt}
          onCreationPromptChange={onCreationPromptChange}
          creatingProjectSession={creatingProjectSession}
          onCreateProjectConversation={onCreateProjectConversation}
          onNew={() => setDialogOpen(true)}
        />
      </div>
      <NewProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={async (project) => {
          await onProjectsChange();
          onActiveProjectChange(project.id);
        }}
      />
    </>
  );
}
