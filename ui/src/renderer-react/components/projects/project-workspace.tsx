import * as React from 'react';
import {
  Archive,
  CheckCircle2,
  Circle,
  FileText,
  FolderKanban,
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  Play,
  Search,
  Square,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type {
  Project,
  ProjectAsset,
  ProjectTask,
  ProjectTeamMember,
  ProjectTeamRun,
  ProjectTemplate,
  SessionSummary,
} from '@/types';

type ProjectTab = 'activity' | 'plan' | 'tasks' | 'assets' | 'sessions' | 'team' | 'deliverables';

type ProjectWorkspaceProps = {
  projects: Project[];
  templates: ProjectTemplate[];
  sessions: SessionSummary[];
  activeProjectId: string | null;
  refreshSignal: number;
  onActiveProjectChange: (projectId: string | null) => void;
  onProjectsChange: () => Promise<void>;
  onOpenSession: (sessionId: string) => void;
  onCreateProjectSession: (project: Project) => Promise<void>;
};

type ProjectFormState = {
  name: string;
  instructions: string;
  templateId: string | null;
  connectorIds: string[];
  expertIds: string[];
  skillIds: string[];
};

const EMPTY_FORM: ProjectFormState = {
  name: '',
  instructions: '',
  templateId: null,
  connectorIds: [],
  expertIds: [],
  skillIds: [],
};

const TABS: Array<{ id: ProjectTab; label: string }> = [
  { id: 'activity', label: '动态' },
  { id: 'plan', label: '计划' },
  { id: 'tasks', label: '任务' },
  { id: 'assets', label: '资产' },
  { id: 'sessions', label: '会话' },
  { id: 'team', label: '团队' },
  { id: 'deliverables', label: '交付物' },
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

function statusLabel(status: ProjectTask['status']) {
  if (status === 'completed') return '已完成';
  if (status === 'in_progress') return '进行中';
  return '待处理';
}

function statusIcon(status: ProjectTask['status']) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === 'in_progress') return <MoreHorizontal className="h-4 w-4 text-primary" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

function memberStatusLabel(status: ProjectTeamMember['status']) {
  switch (status) {
    case 'starting':
      return '启动中';
    case 'running':
      return '运行中';
    case 'idle':
      return '空闲';
    case 'blocked':
      return '阻塞';
    case 'completed':
      return '完成';
    case 'failed':
      return '失败';
    case 'stopped':
      return '已停止';
    case 'planned':
    default:
      return '计划中';
  }
}

function teamRunStatusLabel(status: ProjectTeamRun['status']) {
  switch (status) {
    case 'running':
      return '运行中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'closed':
      return '已关闭';
    case 'draft':
    default:
      return '草稿';
  }
}

function nextStatus(status: ProjectTask['status']): ProjectTask['status'] {
  if (status === 'pending') return 'in_progress';
  if (status === 'in_progress') return 'completed';
  return 'pending';
}

function uniqueStringList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function TagEditor({
  label,
  values,
  placeholder,
  onChange,
}: {
  label: string;
  values: string[];
  placeholder: string;
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = React.useState('');
  const addValue = () => {
    const text = draft.trim();
    if (!text) return;
    onChange(uniqueStringList([...values, text]));
    setDraft('');
  };
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
          >
            <span className="max-w-[180px] truncate">{value}</span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onChange(values.filter((entry) => entry !== value))}
              aria-label={`移除 ${value}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addValue();
            }
          }}
          className="h-8 text-xs"
        />
        <Button type="button" variant="outline" size="sm" onClick={addValue}>
          <Plus className="h-3.5 w-3.5" />
          添加
        </Button>
      </div>
    </div>
  );
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
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
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
    if (dirty && !window.confirm('切换模版会覆盖当前编辑内容')) {
      return;
    }
    setForm({
      name: template.nameSuggestion || template.name || '',
      instructions: template.instructions || '',
      templateId: template.id,
      connectorIds: template.connectorIds || [],
      expertIds: template.expertIds || [],
      skillIds: template.skillIds || [],
    });
  };

  const createProject = async () => {
    if (!form.name.trim()) {
      setError('项目名称不能为空');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const project = await window.agentDesktop.createProject({
        name: form.name.trim(),
        instructions: form.instructions,
        templateId: form.templateId,
        connectorIds: form.connectorIds,
        expertIds: form.expertIds,
        skillIds: form.skillIds,
      });
      onCreated(project);
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm">
      <div className="flex h-[86vh] max-h-[760px] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
        <div className="shrink-0 flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-foreground">新建项目</div>
            <div className="text-xs text-muted-foreground">项目可为空，后续再添加任务、资产和会话。</div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
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
                <div className="text-xs font-medium text-muted-foreground">模板</div>
                <select
                  value={form.templateId || ''}
                  onChange={(event) => applyTemplate(event.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                >
                  <option value="">空白项目</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
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

            <TagEditor
              label="连接器（可选）"
              values={form.connectorIds}
              placeholder="Issue 系统、代码仓库、文档库"
              onChange={(connectorIds) => setForm((prev) => ({ ...prev, connectorIds }))}
            />
            <TagEditor
              label="专家（可选）"
              values={form.expertIds}
              placeholder="架构师、测试、研究员"
              onChange={(expertIds) => setForm((prev) => ({ ...prev, expertIds }))}
            />
            <TagEditor
              label="技能（可选）"
              values={form.skillIds}
              placeholder="调研、会议纪要、文档生成"
              onChange={(skillIds) => setForm((prev) => ({ ...prev, skillIds }))}
            />
            {error && <div className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</div>}
          </div>
        </ScrollArea>
        <div className="relative z-10 shrink-0 flex justify-end gap-2 border-t border-border bg-background px-5 py-4">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={createProject} disabled={saving}>
            <FolderKanban className="h-4 w-4" />
            创建项目
          </Button>
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
  onNew,
}: {
  projects: Project[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpen: (projectId: string) => void;
  onNew: () => void;
}) {
  const filtered = projects.filter((project) =>
    project.name.toLowerCase().includes(query.toLowerCase()) ||
    project.id.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">项目</h1>
            <p className="mt-1 text-sm text-muted-foreground">管理长期上下文、任务、资产和协作执行。</p>
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
          {filtered.length > 0 ? (
            filtered.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onOpen(project.id)}
                className="grid min-h-[92px] grid-cols-[1fr_auto] gap-4 rounded-lg border border-border bg-background px-4 py-3 text-left transition hover:border-primary/50 hover:bg-accent/35"
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
                    <Badge variant="outline">{project.teamRunCount || 0} 团队</Badge>
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>更新于</div>
                  <div className="mt-1">{formatTime(project.updatedAt)}</div>
                </div>
              </button>
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
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setDraft({
      name: project.name,
      instructions: project.instructions,
      templateId: project.templateId || null,
      connectorIds: project.connectorIds || [],
      expertIds: project.expertIds || [],
      skillIds: project.skillIds || [],
    });
  }, [project]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await window.agentDesktop.updateProject({
        projectId: project.id,
        updates: draft,
      });
      onSaved(saved);
    } finally {
      setSaving(false);
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
          <TagEditor
            label="连接器"
            values={draft.connectorIds}
            placeholder="添加连接器"
            onChange={(connectorIds) => setDraft((prev) => ({ ...prev, connectorIds }))}
          />
          <TagEditor
            label="专家"
            values={draft.expertIds}
            placeholder="添加专家"
            onChange={(expertIds) => setDraft((prev) => ({ ...prev, expertIds }))}
          />
          <TagEditor
            label="技能"
            values={draft.skillIds}
            placeholder="添加技能"
            onChange={(skillIds) => setDraft((prev) => ({ ...prev, skillIds }))}
          />
          <div className="grid gap-2">
            <div className="text-xs font-medium text-muted-foreground">自动化</div>
            <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">暂无自动化</div>
          </div>
        </div>
      </ScrollArea>
      <div className="border-t border-border p-4">
        <Button className="w-full" onClick={save} disabled={saving}>
          保存配置
        </Button>
      </div>
    </aside>
  );
}

function ProjectTasksTab({
  projectId,
  tasks,
  onReload,
}: {
  projectId: string;
  tasks: ProjectTask[];
  onReload: () => Promise<void>;
}) {
  const [subject, setSubject] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [owner, setOwner] = React.useState('');

  const createTask = async () => {
    if (!subject.trim()) return;
    await window.agentDesktop.createProjectTask({
      projectId,
      task: {
        subject: subject.trim(),
        description,
        owner: owner.trim() || undefined,
        status: 'pending',
      },
    });
    setSubject('');
    setDescription('');
    setOwner('');
    await onReload();
  };

  const cycleStatus = async (task: ProjectTask) => {
    await window.agentDesktop.updateProjectTask({
      projectId,
      taskId: task.id,
      updates: { status: nextStatus(task.status) },
    });
    await onReload();
  };

  return (
    <div className="grid min-h-0 gap-4">
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_180px_auto]">
          <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="任务标题" />
          <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="描述" />
          <Input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="负责人" />
          <Button onClick={createTask}>
            <Plus className="h-4 w-4" />
            创建任务
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        {tasks.length > 0 ? tasks.map((task) => (
          <div key={task.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-border px-4 py-3">
            <button type="button" onClick={() => cycleStatus(task)} className="rounded-md p-1 hover:bg-accent">
              {statusIcon(task.status)}
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">#{task.id} {task.subject}</div>
              {task.description && <div className="mt-0.5 truncate text-xs text-muted-foreground">{task.description}</div>}
            </div>
            <div className="flex items-center gap-2">
              {task.owner && <Badge variant="outline">{task.owner}</Badge>}
              <Badge variant={task.status === 'completed' ? 'secondary' : 'outline'}>{statusLabel(task.status)}</Badge>
            </div>
          </div>
        )) : (
          <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">暂无任务</div>
        )}
      </div>
    </div>
  );
}

function ProjectAssetsTab({
  projectId,
  assets,
  onReload,
}: {
  projectId: string;
  assets: ProjectAsset[];
  onReload: () => Promise<void>;
}) {
  const upload = async () => {
    const files = await window.agentDesktop.pickFiles();
    for (const file of files) {
      await window.agentDesktop.addProjectAsset({
        projectId,
        sourcePath: file.path,
        fileName: file.name,
      });
    }
    await onReload();
  };

  return (
    <div className="grid min-h-0 gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">{assets.length} 个资产</div>
        <Button onClick={upload}>
          <Upload className="h-4 w-4" />
          上传文件
        </Button>
      </div>
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
              <Button variant="ghost" size="icon-sm" onClick={() => window.agentDesktop.shell.openFile(asset.path)}>
                <FileText className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={async () => {
                await window.agentDesktop.removeProjectAsset({ projectId, assetId: asset.id });
                await onReload();
              }}>
                <Trash2 className="h-4 w-4" />
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

function ProjectSessionsTab({
  project,
  projectSessions,
  allSessions,
  onCreateProjectSession,
  onOpenSession,
  onReload,
}: {
  project: Project;
  projectSessions: SessionSummary[];
  allSessions: SessionSummary[];
  onCreateProjectSession: (project: Project) => Promise<void>;
  onOpenSession: (sessionId: string) => void;
  onReload: () => Promise<void>;
}) {
  const [selectedSessionId, setSelectedSessionId] = React.useState('');
  const bindableSessions = allSessions.filter((session) => !session.projectId);

  const bind = async () => {
    if (!selectedSessionId) return;
    await window.agentDesktop.bindSessionToProject({ sessionId: selectedSessionId, projectId: project.id });
    setSelectedSessionId('');
    await onReload();
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 gap-2">
          <select
            value={selectedSessionId}
            onChange={(event) => setSelectedSessionId(event.target.value)}
            className="h-9 min-w-[240px] rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          >
            <option value="">选择已有会话</option>
            {bindableSessions.map((session) => (
              <option key={session.id} value={session.id}>{session.title}</option>
            ))}
          </select>
          <Button variant="outline" onClick={bind} disabled={!selectedSessionId}>绑定</Button>
        </div>
        <Button onClick={() => onCreateProjectSession(project)}>
          <MessageSquarePlus className="h-4 w-4" />
          新建项目会话
        </Button>
      </div>
      <div className="grid gap-2">
        {projectSessions.length > 0 ? projectSessions.map((session) => (
          <div key={session.id} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-border px-4 py-3">
            <button type="button" onClick={() => onOpenSession(session.id)} className="min-w-0 text-left">
              <div className="truncate text-sm font-medium text-foreground">{session.title}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{session.preview || session.workspace}</div>
            </button>
            <Button variant="ghost" size="sm" onClick={async () => {
              await window.agentDesktop.unbindSessionFromProject({ sessionId: session.id });
              await onReload();
            }}>
              解绑
            </Button>
          </div>
        )) : (
          <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">暂无项目会话</div>
        )}
      </div>
    </div>
  );
}

function ProjectTeamTab({
  project,
  projectId,
  teamRuns,
  onReload,
}: {
  project: Project;
  projectId: string;
  teamRuns: ProjectTeamRun[];
  onReload: () => Promise<void>;
}) {
  const [name, setName] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [memberDrafts, setMemberDrafts] = React.useState<Record<string, {
    expertId: string;
    role: string;
    prompt: string;
    mode: ProjectTeamMember['mode'];
  }>>({});

  const getDraft = (runId: string) => memberDrafts[runId] || {
    expertId: '',
    role: '',
    prompt: '',
    mode: 'default' as const,
  };

  const updateDraft = (
    runId: string,
    patch: Partial<{ expertId: string; role: string; prompt: string; mode: ProjectTeamMember['mode'] }>,
  ) => {
    setMemberDrafts((prev) => ({
      ...prev,
      [runId]: { ...getDraft(runId), ...patch },
    }));
  };

  const createRun = async () => {
    if (!name.trim()) return;
    await window.agentDesktop.createProjectTeamRun({
      projectId,
      teamRun: { name: name.trim(), plannedMembers: [] },
    });
    setName('');
    await onReload();
  };

  const addMember = async (runId: string) => {
    const draft = getDraft(runId);
    const expertId = draft.expertId.trim();
    if (!expertId) return;
    await window.agentDesktop.addProjectTeamMember({
      projectId,
      runId,
      member: {
        expertId,
        name: expertId,
        role: draft.role.trim() || expertId,
        prompt: draft.prompt,
        mode: draft.mode,
        status: 'planned',
      },
    });
    setMemberDrafts((prev) => ({
      ...prev,
      [runId]: { expertId: '', role: '', prompt: '', mode: 'default' },
    }));
    await onReload();
  };

  const startMember = async (runId: string, memberId: string) => {
    setNotice('');
    try {
      await window.agentDesktop.startProjectTeamMember({ projectId, runId, memberId });
    } catch (err: any) {
      setNotice(err?.message || String(err));
    } finally {
      await onReload();
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex gap-2">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="团队执行名称" />
        <Button onClick={createRun}>
          <Users className="h-4 w-4" />
          新建团队
        </Button>
      </div>
      {project.expertIds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          这个项目还没有专家。先在右侧项目配置里添加专家，再把专家加入团队执行。
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {notice}
        </div>
      ) : null}
      <div className="grid gap-2">
        {teamRuns.length > 0 ? teamRuns.map((run) => (
          <div key={run.id} className="rounded-lg border border-border bg-background">
            <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{run.name}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {run.plannedMembers.length} 个计划成员 · {run.activeMembers.length} 个运行成员
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{teamRunStatusLabel(run.status)}</Badge>
                <Button variant="ghost" size="icon-sm" onClick={async () => {
                  await window.agentDesktop.closeProjectTeamRun({ projectId, runId: run.id });
                  await onReload();
                }}>
                  <Square className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid gap-3 p-4">
              <div className="grid gap-2">
                {run.plannedMembers.length > 0 ? run.plannedMembers.map((member) => (
                  <div key={member.id} className="grid grid-cols-[1fr_auto] items-start gap-3 rounded-md border border-border/70 px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{member.name}</span>
                        <Badge variant={member.status === 'blocked' || member.status === 'failed' ? 'destructive' : 'outline'}>
                          {memberStatusLabel(member.status)}
                        </Badge>
                        <Badge variant="secondary">{member.role}</Badge>
                      </div>
                      {member.prompt ? (
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{member.prompt}</div>
                      ) : null}
                      {member.error ? (
                        <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">{member.error}</div>
                      ) : null}
                      {member.taskIds.length > 0 ? (
                        <div className="mt-1 text-xs text-muted-foreground">任务 #{member.taskIds.join(', #')}</div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => startMember(run.id, member.id)}
                        title="启动成员"
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={async () => {
                          await window.agentDesktop.removeProjectTeamMember({ projectId, runId: run.id, memberId: member.id });
                          await onReload();
                        }}
                        title="移除成员"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-md border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
                    暂无计划成员
                  </div>
                )}
              </div>
              <div className="grid gap-2 rounded-md border border-border/70 bg-muted/20 p-3">
                <div className="text-xs font-medium text-muted-foreground">从项目专家添加成员</div>
                <div className="grid gap-2 md:grid-cols-[180px_160px_1fr_128px_auto]">
                  <select
                    value={getDraft(run.id).expertId}
                    onChange={(event) => updateDraft(run.id, { expertId: event.target.value })}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                    disabled={project.expertIds.length === 0}
                  >
                    <option value="">选择专家</option>
                    {project.expertIds.map((expertId) => (
                      <option key={expertId} value={expertId}>
                        {expertId}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={getDraft(run.id).role}
                    onChange={(event) => updateDraft(run.id, { role: event.target.value })}
                    placeholder="角色"
                    className="h-8 text-xs"
                  />
                  <Input
                    value={getDraft(run.id).prompt}
                    onChange={(event) => updateDraft(run.id, { prompt: event.target.value })}
                    placeholder="成员任务说明"
                    className="h-8 text-xs"
                  />
                  <select
                    value={getDraft(run.id).mode}
                    onChange={(event) => updateDraft(run.id, { mode: event.target.value as ProjectTeamMember['mode'] })}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                  >
                    <option value="default">默认</option>
                    <option value="plan">计划</option>
                    <option value="acceptEdits">接受编辑</option>
                    <option value="bypassPermissions">跳过权限</option>
                  </select>
                  <Button size="sm" onClick={() => addMember(run.id)} disabled={!getDraft(run.id).expertId || project.expertIds.length === 0}>
                    <UserPlus className="h-4 w-4" />
                    添加
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )) : (
          <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">暂无团队执行</div>
        )}
      </div>
    </div>
  );
}

function ProjectDetail({
  project,
  sessions,
  refreshSignal,
  onBack,
  onProjectSaved,
  onProjectsChange,
  onOpenSession,
  onCreateProjectSession,
}: {
  project: Project;
  sessions: SessionSummary[];
  refreshSignal: number;
  onBack: () => void;
  onProjectSaved: (project: Project) => void;
  onProjectsChange: () => Promise<void>;
  onOpenSession: (sessionId: string) => void;
  onCreateProjectSession: (project: Project) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = React.useState<ProjectTab>('activity');
  const [detail, setDetail] = React.useState<Project>(project);
  const [assets, setAssets] = React.useState<ProjectAsset[]>([]);
  const [tasks, setTasks] = React.useState<ProjectTask[]>([]);
  const [projectSessions, setProjectSessions] = React.useState<SessionSummary[]>([]);
  const [teamRuns, setTeamRuns] = React.useState<ProjectTeamRun[]>([]);

  const reload = React.useCallback(async () => {
    const [nextProject, nextAssets, nextTasks, nextSessions, nextRuns] = await Promise.all([
      window.agentDesktop.getProject({ projectId: project.id }),
      window.agentDesktop.listProjectAssets({ projectId: project.id }),
      window.agentDesktop.listProjectTasks({ projectId: project.id }),
      window.agentDesktop.listProjectSessions({ projectId: project.id }),
      window.agentDesktop.listProjectTeamRuns({ projectId: project.id }),
    ]);
    setDetail(nextProject);
    setAssets(nextAssets);
    setTasks(nextTasks);
    setProjectSessions(nextSessions);
    setTeamRuns(nextRuns);
    await onProjectsChange();
  }, [onProjectsChange, project.id]);

  React.useEffect(() => {
    setDetail(project);
  }, [project]);

  React.useEffect(() => {
    void reload();
  }, [reload, refreshSignal]);

  const archive = async () => {
    if (!window.confirm(`归档项目「${detail.name}」？`)) return;
    await window.agentDesktop.archiveProject({ projectId: detail.id });
    await onProjectsChange();
    onBack();
  };

  const recentEvents = [
    ...tasks.slice(0, 4).map((task) => ({ id: `task-${task.id}`, label: `任务：${task.subject}`, time: Number(task.metadata?.updatedAt) || detail.updatedAt })),
    ...assets.slice(0, 4).map((asset) => ({ id: `asset-${asset.id}`, label: `资产：${asset.name}`, time: asset.updatedAt })),
    ...projectSessions.slice(0, 4).map((session) => ({ id: `session-${session.id}`, label: `会话：${session.title}`, time: session.updatedAt })),
  ].sort((a, b) => b.time - a.time).slice(0, 8);

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
            <div className="flex gap-2">
              <Button variant="outline" onClick={archive}>
                <Archive className="h-4 w-4" />
                归档
              </Button>
              <Button onClick={() => onCreateProjectSession(detail)}>
                <MessageSquarePlus className="h-4 w-4" />
                新建项目会话
              </Button>
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
              </button>
            ))}
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-6">
            {activeTab === 'activity' && (
              <div className="grid gap-2">
                {recentEvents.length > 0 ? recentEvents.map((event) => (
                  <div key={event.id} className="grid grid-cols-[1fr_auto] rounded-lg border border-border px-4 py-3 text-sm">
                    <div className="truncate text-foreground">{event.label}</div>
                    <div className="text-xs text-muted-foreground">{formatTime(event.time)}</div>
                  </div>
                )) : (
                  <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">暂无动态</div>
                )}
              </div>
            )}
            {activeTab === 'plan' && (
              <div className="rounded-lg border border-border p-4">
                <div className="text-sm font-medium text-foreground">项目指令</div>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {detail.instructions || '暂无指令'}
                </div>
              </div>
            )}
            {activeTab === 'tasks' && (
              <ProjectTasksTab projectId={detail.id} tasks={tasks} onReload={reload} />
            )}
            {activeTab === 'assets' && (
              <ProjectAssetsTab projectId={detail.id} assets={assets} onReload={reload} />
            )}
            {activeTab === 'sessions' && (
              <ProjectSessionsTab
                project={detail}
                projectSessions={projectSessions}
                allSessions={sessions}
                onCreateProjectSession={onCreateProjectSession}
                onOpenSession={onOpenSession}
                onReload={reload}
              />
            )}
            {activeTab === 'team' && (
              <ProjectTeamTab project={detail} projectId={detail.id} teamRuns={teamRuns} onReload={reload} />
            )}
            {activeTab === 'deliverables' && (
              <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">暂无交付物</div>
            )}
          </div>
        </ScrollArea>
      </div>
      <ProjectConfigPanel
        project={detail}
        onSaved={(saved) => {
          setDetail(saved);
          onProjectSaved(saved);
          void reload();
        }}
      />
    </div>
  );
}

export function ProjectWorkspace({
  projects,
  templates,
  sessions,
  activeProjectId,
  refreshSignal,
  onActiveProjectChange,
  onProjectsChange,
  onOpenSession,
  onCreateProjectSession,
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
          sessions={sessions}
          refreshSignal={refreshSignal}
          onBack={() => onActiveProjectChange(null)}
          onProjectSaved={async () => {
            await onProjectsChange();
          }}
          onProjectsChange={onProjectsChange}
          onOpenSession={onOpenSession}
          onCreateProjectSession={onCreateProjectSession}
        />
      ) : (
        <ProjectList
          projects={projects}
          query={query}
          onQueryChange={setQuery}
          onOpen={onActiveProjectChange}
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
