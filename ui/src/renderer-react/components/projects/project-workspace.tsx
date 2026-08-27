import * as React from 'react';
import {
  ChevronDown,
  FileText,
  FolderKanban,
  ListChecks,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ProjectResourcePicker } from '@/components/projects/project-resource-picker';
import { ProjectTasksTab } from '@/components/projects/project-tasks-tab';
import { MarkdownRenderer } from '@/components/markdown/markdown-renderer';
import { cn } from '@/lib/utils';
import { syncProjectMarketplaceResources } from '@/lib/project-resource-sync';
import { formatProjectMemoryForDisplay } from '../../../shared/project-memory.mjs';
import type {
  Project,
  ProjectAsset,
  ProjectDecision,
  ProjectEvent,
  ProjectMemory,
  ProjectTask,
  ProjectTemplate,
} from '@/types';

type ProjectTab = 'activity' | 'decisions' | 'tasks' | 'assets';

type ProjectWorkspaceProps = {
  projects: Project[];
  templates: ProjectTemplate[];
  activeProjectId: string | null;
  refreshSignal: number;
  onActiveProjectChange: (projectId: string | null) => void;
  onProjectsChange: () => Promise<void>;
  onOpenSession: (sessionId: string) => void;
};

type ProjectFormState = {
  name: string;
  instructions: string;
  templateId: string | null;
  connectorIds: string[];
  expertIds: string[];
  skillIds: string[];
  decisionPolicy: Project['decisionPolicy'];
};

const EMPTY_FORM: ProjectFormState = {
  name: '',
  instructions: '',
  templateId: null,
  connectorIds: [],
  expertIds: [],
  skillIds: [],
  decisionPolicy: { mode: 'auto_all' },
};

const TABS: Array<{ id: ProjectTab; label: string }> = [
  { id: 'activity', label: '动态' },
  { id: 'decisions', label: '待决策' },
  { id: 'tasks', label: '任务' },
  { id: 'assets', label: '资产' },
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
  templates,
  onClose,
  onCreated,
}: {
  open: boolean;
  templates: ProjectTemplate[];
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

  const applyTemplate = (templateId: string) => {
    const template = templates.find((entry) => entry.id === templateId);
    if (!template) {
      setForm((prev) => ({ ...prev, templateId: null }));
      return;
    }
    const dirty = Boolean(
      form.name.trim() ||
      form.instructions.trim() ||
      form.connectorIds.length ||
      form.expertIds.length ||
      form.skillIds.length,
    );
    if (dirty && !window.confirm('切换场景会覆盖当前编辑内容')) {
      return;
    }
    setForm({
      name: template.nameSuggestion || template.name || '',
      instructions: template.instructions || '',
      templateId: template.id,
      connectorIds: template.connectorIds || [],
      expertIds: template.expertIds || [],
      skillIds: template.skillIds || [],
      decisionPolicy: { mode: 'auto_all' },
    });
  };

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
        name: form.name.trim(),
        instructions: form.instructions,
        templateId: form.templateId,
        connectorIds: form.connectorIds,
        expertIds: form.expertIds,
        skillIds: form.skillIds,
        decisionPolicy: form.decisionPolicy,
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
            <div className="text-xs text-muted-foreground">创建后可发起任务，并持续沉淀项目资产和记忆。</div>
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

            {templates.length > 0 && (
              <div className="grid gap-2">
                <div className="text-xs font-medium text-muted-foreground">场景</div>
                <select
                  value={form.templateId || ''}
                  onChange={(event) => applyTemplate(event.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                >
                  <option value="">空白场景</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                {templates.find((template) => template.id === form.templateId)?.description ? (
                  <div className="text-xs leading-5 text-muted-foreground">
                    {templates.find((template) => template.id === form.templateId)?.description}
                  </div>
                ) : null}
              </div>
            )}

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
              kind="connector"
              title="添加个人授权连接器"
              description="添加后成员可使用个人账号授权连接。如需配置公共连接器，可在创建项目完成后配置。"
              selectedIds={form.connectorIds}
              onChange={(connectorIds) => setForm((prev) => ({ ...prev, connectorIds }))}
            />
            <ProjectResourcePicker
              kind="skill"
              title="添加技能"
              description="从技能市场选择项目可使用的技能。"
              selectedIds={form.skillIds}
              onChange={(skillIds) => setForm((prev) => ({ ...prev, skillIds }))}
            />
            <ProjectResourcePicker
              kind="expert"
              title="添加专家"
              description="从整个专家市场选择项目成员。"
              selectedIds={form.expertIds}
              onChange={(expertIds) => setForm((prev) => ({ ...prev, expertIds }))}
            />
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
  onDelete,
  onNew,
}: {
  projects: Project[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpen: (projectId: string) => void;
  onDelete: (project: Project) => Promise<void>;
  onNew: () => void;
}) {
  const [deletingProjectId, setDeletingProjectId] = React.useState<string | null>(null);
  const [deleteError, setDeleteError] = React.useState('');
  const filtered = projects.filter((project) =>
    project.name.toLowerCase().includes(query.toLowerCase()) ||
    project.id.toLowerCase().includes(query.toLowerCase())
  );

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
      <div className="border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">项目</h1>
            <p className="mt-1 text-sm text-muted-foreground">管理长期上下文、目标、任务和资产。</p>
          </div>
          <Button onClick={onNew}>
            <Plus className="h-4 w-4" />
            新建项目
          </Button>
        </div>
        <div className="relative mt-4 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="查询项目"
            className="pl-9"
          />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-2 p-6">
          {deleteError ? (
            <div className="mb-1 text-sm text-destructive">{deleteError}</div>
          ) : null}
          {filtered.length > 0 ? (
            filtered.map((project) => (
              <div
                key={project.id}
                className="group grid min-h-[92px] grid-cols-[minmax(0,1fr)_auto] items-stretch overflow-hidden rounded-lg border border-border bg-background transition hover:border-primary/50 hover:bg-accent/35"
              >
                <button
                  type="button"
                  onClick={() => onOpen(project.id)}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <FolderKanban className="h-4 w-4 shrink-0 text-primary" />
                      <div className="truncate text-sm font-semibold text-foreground">{project.name}</div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant="outline">{project.sessionCount || 0} 会话</Badge>
                      <Badge variant="outline">{project.taskCount || 0} 任务</Badge>
                      <Badge variant="outline">{project.assetCount || 0} 资产</Badge>
                      {project.pendingDecisionCount ? <Badge variant="destructive">{project.pendingDecisionCount} 待决策</Badge> : null}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>更新于</div>
                    <div className="mt-1">{formatTime(project.updatedAt)}</div>
                  </div>
                </button>
                <div className="flex items-center border-l border-border/70 px-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void deleteProject(project)}
                    disabled={deletingProjectId !== null}
                    title={`删除项目 ${project.name}`}
                    aria-label={`删除项目 ${project.name}`}
                  >
                    {deletingProjectId === project.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
              <div className="text-sm font-medium text-foreground">暂无项目</div>
              <div className="mt-1 text-sm text-muted-foreground">可以继续直接创建会话，也可以新建项目组织复杂工作。</div>
              <Button className="mt-4" onClick={onNew}>
                <Plus className="h-4 w-4" />
                新建项目
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ProjectConfigPanel({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: (project: Project) => void;
}) {
  const [draft, setDraft] = React.useState<ProjectFormState>({
    name: project.name,
    instructions: project.instructions,
    templateId: project.templateId || null,
    connectorIds: project.connectorIds || [],
    expertIds: project.expertIds || [],
    skillIds: project.skillIds || [],
    decisionPolicy: project.decisionPolicy || { mode: 'auto_all' },
  });
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
      setDraft({
        name: saved.name,
        instructions: saved.instructions,
        templateId: saved.templateId || null,
        connectorIds: saved.connectorIds || [],
        expertIds: saved.expertIds || [],
        skillIds: saved.skillIds || [],
        decisionPolicy: saved.decisionPolicy || { mode: 'auto_all' },
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setSavingStatus('');
    }
  };

  return (
    <aside className="hidden h-full min-h-0 w-[312px] shrink-0 border-l border-border bg-sidebar/35 lg:flex lg:flex-col">
      <div className="border-b border-border px-4 py-4">
        <div className="text-sm font-semibold text-foreground">项目配置</div>
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
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">决策策略</div>
            <select
              value={draft.decisionPolicy.mode}
              onChange={(event) => setDraft((prev) => ({
                ...prev,
                decisionPolicy: {
                  mode: event.target.value as Project['decisionPolicy']['mode'],
                },
              }))}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="auto_all">全部允许</option>
              <option value="auto_low_risk">自动处理低风险偏好</option>
              <option value="recommend">AI 推荐，人工确认</option>
              <option value="manual">全部人工判断</option>
            </select>
            <div className="text-xs leading-5 text-muted-foreground">
              {draft.decisionPolicy.mode === 'auto_all'
                ? '自动采用 AI 推荐选项；没有明确推荐时采用首项，并保留操作预览和审计记录。'
                : draft.decisionPolicy.mode === 'auto_low_risk'
                  ? '仅自动处理有明确推荐的低风险偏好，其他操作需要人工确认。'
                  : draft.decisionPolicy.mode === 'recommend'
                    ? '显示 AI 推荐，但所有决策仍需人工确认。'
                    : '所有项目决策均由用户选择。'}
            </div>
          </div>
          <ProjectResourcePicker
            kind="connector"
            title="添加个人授权连接器"
            description="项目任务将使用所选个人授权连接器。"
            selectedIds={draft.connectorIds}
            onChange={(connectorIds) => setDraft((prev) => ({ ...prev, connectorIds }))}
          />
          <ProjectResourcePicker
            kind="skill"
            title="添加技能"
            description="从技能市场选择项目任务可调用的技能。"
            selectedIds={draft.skillIds}
            onChange={(skillIds) => setDraft((prev) => ({ ...prev, skillIds }))}
          />
          <ProjectResourcePicker
            kind="expert"
            title="添加专家"
            description="从专家市场选择项目会话可使用的专家。"
            selectedIds={draft.expertIds}
            onChange={(expertIds) => setDraft((prev) => ({ ...prev, expertIds }))}
          />
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

function ProjectDecisionsTab({
  project,
  decisions,
  tasks,
  onOpenSession,
  onReload,
}: {
  project: Project;
  decisions: ProjectDecision[];
  tasks: ProjectTask[];
  onOpenSession: (sessionId: string) => void;
  onReload: () => Promise<void>;
}) {
  const [expandedId, setExpandedId] = React.useState<string | null>(
    decisions.find((decision) => decision.status === 'pending')?.id || null,
  );
  const [answersByDecision, setAnswersByDecision] = React.useState<Record<string, Record<string, string>>>({});
  const [resolvingId, setResolvingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const pending = decisions.filter((decision) => decision.status === 'pending');
  const history = decisions.filter((decision) => decision.status !== 'pending').slice(0, 30);

  React.useEffect(() => {
    if (expandedId && decisions.some((decision) => decision.id === expandedId)) return;
    setExpandedId(pending[0]?.id || null);
  }, [decisions, expandedId, pending]);

  const setAnswer = (decision: ProjectDecision, question: ProjectDecision['questions'][number], value: string) => {
    setAnswersByDecision((current) => {
      const decisionAnswers = current[decision.id] || decision.recommendation?.answers || {};
      let nextValue = value;
      if (question.multiSelect) {
        const selected = decisionAnswers[question.question]
          ? decisionAnswers[question.question].split(',').map((entry) => entry.trim()).filter(Boolean)
          : [];
        nextValue = selected.includes(value)
          ? selected.filter((entry) => entry !== value).join(', ')
          : [...selected, value].join(', ');
      }
      return {
        ...current,
        [decision.id]: { ...decisionAnswers, [question.question]: nextValue },
      };
    });
  };

  const resolve = async (decision: ProjectDecision) => {
    setResolvingId(decision.id);
    setError('');
    try {
      await window.agentDesktop.resolveProjectDecision({
        projectId: project.id,
        decisionId: decision.id,
        answers: answersByDecision[decision.id] || decision.recommendation?.answers || {},
      });
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingId(null);
    }
  };

  const reject = async (decision: ProjectDecision) => {
    setResolvingId(decision.id);
    setError('');
    try {
      await window.agentDesktop.rejectProjectDecision({
        projectId: project.id,
        decisionId: decision.id,
        message: '用户在项目待决策中拒绝了该请求',
      });
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingId(null);
    }
  };

  const renderDecision = (decision: ProjectDecision) => {
    const expanded = expandedId === decision.id;
    const sourceTask = decision.taskId ? taskById.get(decision.taskId) : null;
    const answers = answersByDecision[decision.id] || decision.recommendation?.answers || {};
    const ready = decision.questions.length > 0 && decision.questions.every((question) => Boolean(answers[question.question]?.trim()));
    const statusText = decision.status === 'pending'
      ? '等待判断'
      : decision.status === 'resolved' ? '已决定' : decision.status === 'rejected' ? '已拒绝' : '已失效';
    const riskText = decision.riskLevel === 'high' ? '高风险' : decision.riskLevel === 'low' ? '低风险' : '中风险';
    return (
      <article key={decision.id} className="overflow-hidden rounded-md border border-border bg-background">
        <button
          type="button"
          className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 text-left hover:bg-accent/40"
          onClick={() => setExpandedId((current) => current === decision.id ? null : decision.id)}
          aria-expanded={expanded}
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">
              {decision.questions[0]?.question || '需要项目判断'}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {sourceTask?.subject || '项目任务'} · {decision.originLabel}
            </div>
          </div>
          <Badge variant={decision.riskLevel === 'high' ? 'destructive' : 'outline'}>{riskText}</Badge>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{statusText}</span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
          </div>
        </button>
        {expanded ? (
          <div className="grid gap-4 border-t border-border/70 px-4 py-4">
            {decision.questions.map((question) => (
              <div key={question.question} className="grid gap-2">
                <div>
                  <div className="text-xs font-medium text-muted-foreground">{question.header}</div>
                  <div className="mt-1 text-sm text-foreground">{question.question}</div>
                </div>
                {decision.status === 'pending' ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {question.options.map((option) => {
                        const selectedValues = (answers[question.question] || '').split(',').map((entry) => entry.trim());
                        const selected = selectedValues.includes(option.label);
                        const recommended = decision.recommendation?.answers?.[question.question] === option.label;
                        return (
                          <button
                            key={option.label}
                            type="button"
                            onClick={() => setAnswer(decision, question, option.label)}
                            className={cn(
                              'min-h-16 border px-3 py-2 text-left transition-colors',
                              selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/45',
                            )}
                          >
                            <div className="flex items-center justify-between gap-2 text-sm font-medium text-foreground">
                              <span>{option.label}</span>
                              {recommended ? <Badge variant="secondary">AI 推荐</Badge> : null}
                            </div>
                            {option.description ? <div className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</div> : null}
                            {option.preview ? <div className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap border-t border-border/60 pt-2 text-xs leading-5 text-muted-foreground">{option.preview}</div> : null}
                          </button>
                        );
                      })}
                    </div>
                    <Input
                      value={answers[question.question] || ''}
                      onChange={(event) => setAnswersByDecision((current) => ({
                        ...current,
                        [decision.id]: {
                          ...(current[decision.id] || decision.recommendation?.answers || {}),
                          [question.question]: event.target.value,
                        },
                      }))}
                      placeholder="也可以输入自定义回答"
                      className="h-8 text-xs"
                    />
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    {decision.resolution?.answers?.[question.question] || decision.resolution?.note || '未提供答案'}
                  </div>
                )}
              </div>
            ))}
            {decision.recommendation?.reason ? (
              <div className="text-xs leading-5 text-muted-foreground">推荐依据：{decision.recommendation.reason}</div>
            ) : null}
            {decision.resolution?.source === 'policy' ? (
              <div className="text-xs leading-5 text-emerald-700">已由项目决策策略自动处理。</div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
              <div className="text-xs text-muted-foreground">{formatTime(decision.createdAt)}</div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenSession(decision.parentSessionId)}
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  主会话
                </Button>
                {decision.originSessionId && decision.originSessionId !== decision.parentSessionId ? (
                  <Button variant="outline" size="sm" onClick={() => onOpenSession(decision.originSessionId)}>
                    <MessageSquarePlus className="h-4 w-4" />
                    子会话
                  </Button>
                ) : null}
                {decision.status === 'pending' ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => void reject(decision)} disabled={resolvingId !== null}>拒绝</Button>
                    <Button size="sm" onClick={() => void resolve(decision)} disabled={!ready || resolvingId !== null}>
                      {resolvingId === decision.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      确认决定
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </article>
    );
  };

  return (
    <div className="grid gap-5">
      {error ? <div className="text-sm text-destructive">{error}</div> : null}
      <section className="grid gap-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-foreground">等待判断</div>
          <Badge variant={pending.length > 0 ? 'default' : 'outline'}>{pending.length}</Badge>
        </div>
        {pending.length > 0 ? pending.map(renderDecision) : (
          <div className="rounded-md border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">当前没有需要处理的决策</div>
        )}
      </section>
      {history.length > 0 ? (
        <section className="grid gap-2">
          <div className="text-sm font-medium text-foreground">最近记录</div>
          {history.map(renderDecision)}
        </section>
      ) : null}
    </div>
  );
}

// Project assets are published by completed Coordinator task sessions.
function ProjectAssetsTab({
  projectId,
  assets,
  onReload,
}: {
  projectId: string;
  assets: ProjectAsset[];
  onReload: () => Promise<void>;
}) {
  const [error, setError] = React.useState('');
  const [busyAssetId, setBusyAssetId] = React.useState<string | null>(null);

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

  return (
    <div className="grid min-h-0 gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">{assets.length} 个资产</div>
        <Button onClick={upload} disabled={busyAssetId !== null}>
          {busyAssetId === 'upload'
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Upload className="h-4 w-4" />}
          上传文件
        </Button>
      </div>
      {error ? <div className="text-sm text-destructive">{error}</div> : null}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[1fr_120px_140px_96px] border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <div>名称</div>
          <div>大小</div>
          <div>更新</div>
          <div className="text-right">操作</div>
        </div>
        {assets.length > 0 ? assets.map((asset) => (
          <div key={asset.id} className="grid grid-cols-[1fr_120px_140px_96px] items-center border-b border-border/70 px-4 py-2 text-sm last:border-b-0">
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{asset.name}</div>
              <div className="truncate text-xs text-muted-foreground">{asset.relativePath || asset.path}</div>
            </div>
            <div className="text-xs text-muted-foreground">{formatBytes(asset.size)}</div>
            <div className="text-xs text-muted-foreground">{formatTime(asset.updatedAt)}</div>
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void open(asset)}
                disabled={busyAssetId !== null}
                title="打开资产"
                aria-label={`打开资产：${asset.name}`}
              >
                <FileText className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void remove(asset.id)}
                disabled={busyAssetId !== null}
                title="删除资产"
                aria-label={`删除资产：${asset.name}`}
              >
                {busyAssetId === asset.id
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Trash2 className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )) : (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">暂无资产</div>
        )}
      </div>
    </div>
  );
}

// Project detail exposes root Coordinator sessions as tasks.
function ProjectDetail({
  project,
  refreshSignal,
  onBack,
  onProjectSaved,
  onProjectsChange,
  onOpenSession,
}: {
  project: Project;
  refreshSignal: number;
  onBack: () => void;
  onProjectSaved: (project: Project) => void;
  onProjectsChange: () => Promise<void>;
  onOpenSession: (sessionId: string) => void;
}) {
  const [activeTab, setActiveTab] = React.useState<ProjectTab>('activity');
  const [detail, setDetail] = React.useState<Project>(project);
  const [assets, setAssets] = React.useState<ProjectAsset[]>([]);
  const [tasks, setTasks] = React.useState<ProjectTask[]>([]);
  const [events, setEvents] = React.useState<ProjectEvent[]>([]);
  const [decisions, setDecisions] = React.useState<ProjectDecision[]>([]);
  const [memory, setMemory] = React.useState<ProjectMemory | null>(null);
  const [loadError, setLoadError] = React.useState('');
  const reloadRequestIdRef = React.useRef(0);

  const reload = React.useCallback(async () => {
    const requestId = ++reloadRequestIdRef.current;
    try {
      const [nextProject, nextAssets, nextTasks, nextEvents, nextDecisions, nextMemory] = await Promise.all([
        window.agentDesktop.getProject({ projectId: project.id }),
        window.agentDesktop.listProjectAssets({ projectId: project.id }),
        window.agentDesktop.listProjectTasks({ projectId: project.id }),
        window.agentDesktop.listProjectEvents({ projectId: project.id }),
        window.agentDesktop.listProjectDecisions({ projectId: project.id }),
        window.agentDesktop.getProjectMemory({ projectId: project.id }),
      ]);
      if (reloadRequestIdRef.current !== requestId) return;
      setDetail(nextProject);
      setAssets(nextAssets);
      setTasks(nextTasks);
      setEvents(nextEvents);
      setDecisions(nextDecisions);
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
    setDecisions([]);
    setMemory(null);
    setLoadError('');
  }, [project.id]);

  React.useEffect(() => {
    void reload().catch(() => {});
  }, [reload, refreshSignal]);

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
      setActiveTab('decisions');
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-background">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <button type="button" onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground">
                项目 / 返回列表
              </button>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <FolderKanban className="h-5 w-5 shrink-0 text-primary" />
                <h1 className="truncate text-xl font-semibold text-foreground">{detail.name}</h1>
              </div>
            </div>
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
                {tab.id === 'decisions' && decisions.some((decision) => decision.status === 'pending') ? (
                  <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[10px] leading-4 text-destructive-foreground">
                    {decisions.filter((decision) => decision.status === 'pending').length}
                  </span>
                ) : null}
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
                    <div className="text-sm font-medium text-foreground">项目记忆</div>
                    <div className="text-xs text-muted-foreground">
                      {memory?.finalizedSessionCount
                        ? `${memory.finalizedSessionCount} 次沉淀${memory.updatedAt ? ` · ${formatTime(memory.updatedAt)}` : ''}`
                        : '尚未沉淀'}
                    </div>
                  </div>
                  <div className="max-h-[320px] overflow-auto py-3 text-sm text-muted-foreground">
                    {memoryOverview ? (
                      <MarkdownRenderer
                        content={memoryOverview}
                        variant="compact"
                        sourceId={`project-memory:${detail.id}:${memory?.version || 0}`}
                      />
                    ) : (
                      <div className="py-3 text-sm text-muted-foreground">暂无已沉淀的项目记忆</div>
                    )}
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
            {activeTab === 'decisions' && (
              <ProjectDecisionsTab
                project={detail}
                decisions={decisions}
                tasks={tasks}
                onOpenSession={onOpenSession}
                onReload={reload}
              />
            )}
            {activeTab === 'tasks' && (
              <ProjectTasksTab
                project={detail}
                tasks={tasks}
                onOpenSession={onOpenSession}
                onShowDecisions={() => setActiveTab('decisions')}
                onReload={reload}
              />
            )}
            {activeTab === 'assets' && (
              <ProjectAssetsTab projectId={detail.id} assets={assets} onReload={reload} />
            )}
          </div>
        </ScrollArea>
      </div>
      <ProjectConfigPanel
        key={detail.id}
        project={detail}
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
  templates,
  activeProjectId,
  refreshSignal,
  onActiveProjectChange,
  onProjectsChange,
  onOpenSession,
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
        />
      ) : (
        <ProjectList
          projects={projects}
          query={query}
          onQueryChange={setQuery}
          onOpen={onActiveProjectChange}
          onDelete={async (project) => {
            await window.agentDesktop.archiveProject({ projectId: project.id });
            await onProjectsChange();
          }}
          onNew={() => setDialogOpen(true)}
        />
      )}
      <NewProjectDialog
        open={dialogOpen}
        templates={templates}
        onClose={() => setDialogOpen(false)}
        onCreated={async (project) => {
          await onProjectsChange();
          onActiveProjectChange(project.id);
        }}
      />
    </>
  );
}
