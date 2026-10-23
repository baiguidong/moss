import * as React from 'react';
import {
  FileText,
  FolderKanban,
  ListChecks,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ProjectDefaultsFields } from '@/components/projects/project-defaults-fields';
import { ProjectResourcePicker } from '@/components/projects/project-resource-picker';
import { ProjectTasksTab } from '@/components/projects/project-tasks-tab';
import { MarkdownRenderer } from '@/components/markdown/markdown-renderer';
import { cn } from '@/lib/utils';
import { syncProjectMarketplaceResources } from '@/lib/project-resource-sync';
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
};

function projectFormFromProject(project: Project): ProjectFormState {
  const { connectorIds: _legacyConnectorIds, ...rest } = project;
  return {
    ...rest,
    name: project.name,
    instructions: project.instructions,
    templateId: project.templateId || null,
    expertIds: project.expertIds || [],
    skillIds: project.skillIds || [],
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
  const [form, setForm] = React.useState<ProjectFormState>(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);
  const [savingStatus, setSavingStatus] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setSavingStatus('');
      setError('');
    }
  }, [open]);

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
      await syncProjectMarketplaceResources({
        skillIds: form.skillIds,
        expertIds: form.expertIds,
        onProgress: setSavingStatus,
      });
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
      onClose();
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
            <div className="text-xs text-muted-foreground">让会话共享配置，汇集成果并积累项目记忆。</div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} disabled={saving}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1 overflow-hidden">
          <div className="space-y-5 p-5 pb-8">
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

            <div className="grid gap-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>指令</span>
                <span>{form.instructions.length}</span>
              </div>
              <Textarea
                value={form.instructions}
                placeholder="写入项目长期约束、偏好、交付标准或背景信息"
                onChange={(event) => setForm((prev) => ({ ...prev, instructions: event.target.value }))}
                className="min-h-[180px] resize-y text-sm"
              />
            </div>

            <ProjectResourcePicker
              kind="skill"
              title="添加技能"
              description="从技能市场选择项目可使用的技能。"
              selectedIds={form.skillIds}
              onChange={(skillIds) => setForm((prev) => ({ ...prev, skillIds }))}
            />
            <ProjectResourcePicker
              kind="expert"
              multiple={false}
              title="默认助手"
              description="与普通会话一样，选择一个默认助手。"
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
            <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
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
  onNew,
}: {
  projects: Project[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpen: (projectId: string) => void;
  onRename: (project: Project, name: string) => Promise<void>;
  onDelete: (project: Project) => Promise<void>;
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
  const filtered = projects.filter((project) =>
    project.name.toLowerCase().includes(query.toLowerCase()) ||
    project.id.toLowerCase().includes(query.toLowerCase())
  );

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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border/70 px-5 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">项目</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">共享会话配置，汇集成果与项目记忆</p>
          </div>
          <Button onClick={onNew}>
            <Plus className="h-4 w-4" />
            新建项目
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[1180px] px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-baseline gap-2">
              <h2 className="text-base font-semibold text-foreground">我的项目</h2>
              <span className="text-xs text-muted-foreground">{filtered.length}</span>
            </div>
            <div className="relative w-full sm:w-[300px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="搜索项目"
                className="pl-9"
              />
            </div>
          </div>
          {deleteError ? (
            <div className="mt-3 text-sm text-destructive">{deleteError}</div>
          ) : null}
          {filtered.length > 0 ? (
            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3">
              {filtered.map((project) => (
                <div
                  key={project.id}
                  className="group relative flex min-h-[148px] overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/45 hover:bg-accent/25"
                >
                  <button
                    type="button"
                    aria-label={`打开项目：${project.name}`}
                    onClick={() => onOpen(project.id)}
                    className="flex min-w-0 flex-1 flex-col p-4 pr-12 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <FolderKanban className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 pt-0.5">
                        <div className="truncate text-sm font-semibold text-foreground">{project.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatTime(project.updatedAt)} 更新
                        </div>
                      </div>
                    </div>
                    <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-xs text-muted-foreground">
                      <span>{project.sessionCount || 0} 会话</span>
                      <span>{project.taskCount || 0} 会话</span>
                      <span>{project.assetCount || 0} 成果</span>
                    </div>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
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
                {query ? '试试其他关键词' : '新建项目，开始组织会话、任务和项目成果。'}
              </div>
              {!query ? (
                <Button className="mt-4" onClick={onNew}>
                  <Plus className="h-4 w-4" />
                  新建项目
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </ScrollArea>
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
}: {
  project: Project;
  open: boolean;
  onSaved: (project: Project) => void;
}) {
  const [draft, setDraft] = React.useState<ProjectFormState>(() => projectFormFromProject(project));
  const [saving, setSaving] = React.useState(false);
  const [savingStatus, setSavingStatus] = React.useState('');
  const [error, setError] = React.useState('');

  const save = async () => {
    if (!draft.name.trim()) {
      setError('项目名称不能为空');
      return;
    }
    setSaving(true);
    setSavingStatus('正在检查本地资源...');
    setError('');
    try {
      await syncProjectMarketplaceResources({
        skillIds: draft.skillIds,
        expertIds: draft.expertIds,
        onProgress: setSavingStatus,
      });
      setSavingStatus('正在保存项目配置...');
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
    <aside className="absolute right-0 z-20 flex h-full min-h-0 w-[312px] max-w-full shrink-0 flex-col border-l border-border bg-background lg:static lg:bg-sidebar/35">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <span>项目配置</span>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-4">
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">项目名称</div>
            <Input
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              className="h-8 text-xs"
            />
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">指令</div>
            <Textarea
              value={draft.instructions}
              onChange={(event) => setDraft((prev) => ({ ...prev, instructions: event.target.value }))}
              className="min-h-[160px] text-xs"
            />
          </div>
          <ProjectResourcePicker
            kind="skill"
            title="添加技能"
            description="新会话默认选择的技能。"
            selectedIds={draft.skillIds}
            onChange={(skillIds) => setDraft((prev) => ({ ...prev, skillIds }))}
          />
          <ProjectResourcePicker
            kind="expert"
            multiple={false}
            title="默认助手"
            description="新会话预填此助手，发送前可以修改。"
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

  const upload = async () => {
    setBusyAssetId('upload');
    setError('');
    try {
      const files = await window.agentDesktop.pickFiles();
      for (const file of files) {
        await window.agentDesktop.addProjectAsset({
          projectId,
          sourcePath: file.path,
          fileName: file.name,
        });
      }
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAssetId(null);
    }
  };

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
        <div className="flex items-center gap-2">

          <Button onClick={upload} disabled={busyAssetId !== null}>
            {busyAssetId === 'upload'
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Upload className="h-4 w-4" />}
            添加资料
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">汇集会话登记的成果和添加的资料。移除列表项会保留原文件。</p>
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
  const [configOpen, setConfigOpen] = React.useState(false);
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
    setConfigOpen(false);
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
    <div className="relative flex h-full min-h-0 bg-background">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border px-6 py-4">
          <button type="button" onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground">
            项目 / 返回列表
          </button>
          <div className="mt-1 flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <FolderKanban className="h-5 w-5 shrink-0 text-primary" />
              <h1 className="truncate text-xl font-semibold text-foreground">{detail.name}</h1>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={configOpen ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  className="inline-flex h-8 w-8 shrink-0 rounded-md"
                  onClick={() => setConfigOpen((current) => !current)}
                  aria-label={configOpen ? '收起右侧项目配置' : '在右侧展开项目配置'}
                  aria-expanded={configOpen}
                >
                  {configOpen
                    ? <PanelRightClose className="h-4 w-4" />
                    : <PanelRightOpen className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {configOpen ? '收起右侧项目配置' : '在右侧展开项目配置'}
              </TooltipContent>
            </Tooltip>
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
                    <div className="flex items-center gap-3 text-sm font-medium text-foreground">项目沉淀
                      <Button variant="outline" size="sm" disabled={memoryPending || memory?.maintenance?.phase === 'running'} onClick={() => void updateMemory()}>
                        {memory?.maintenance?.phase === 'running' ? '正在整理…' : '整理项目'}
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {memory?.finalizedSessionCount
                        ? `${memory.finalizedSessionCount} 个来源会话${memory.updatedAt ? ` · ${formatTime(memory.updatedAt)}` : ''}`
                        : '尚未沉淀'}
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">会话空闲后自动提炼，定期整合项目记忆。手动整理会处理当前空闲的会话。</p>
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
                onNewSession={onNewSession}
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
        onSaved={(saved) => {
          setDetail(saved);
          onProjectSaved(saved);
          void reload().catch(() => {});
        }}
      />
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
  onNewSession,
}: ProjectWorkspaceProps) {
  const [query, setQuery] = React.useState('');
  const [dialogOpen, setDialogOpen] = React.useState(false);
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
      {activeProject ? (
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
      ) : (
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
          onNew={() => setDialogOpen(true)}
        />
      )}
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
