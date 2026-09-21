import * as React from 'react';
import {
  Bot,
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type {
  DesktopAgentCatalog,
  DesktopAgentDefinition,
  DesktopAgentDraft,
  DesktopAgentSource,
} from '../types';

const SOURCE_LABELS: Record<DesktopAgentSource, string> = {
  'built-in': '内置',
  user: '用户',
  project: '项目',
  managed: '组织',
  flag: '启动参数',
};

type AgentEditorState = {
  mode: 'create' | 'edit';
  previousScope?: 'user' | 'project';
  previousFileName?: string;
  draft: DesktopAgentDraft;
  toolsText: string;
};

function createEmptyDraft(workspace?: string): AgentEditorState {
  return {
    mode: 'create',
    draft: {
      scope: workspace ? 'project' : 'user',
      name: '',
      description: '',
      prompt: '',
      model: 'inherit',
      tools: [],
      background: false,
    },
    toolsText: '',
  };
}

function AgentToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center overflow-hidden rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        checked ? 'bg-primary' : 'bg-muted-foreground/25',
      )}
    >
      <span className={cn(
        'block h-5 w-5 shrink-0 rounded-full bg-white shadow-sm transition-transform',
        checked ? 'translate-x-5' : 'translate-x-0',
      )} />
    </button>
  );
}

function AgentEditor({
  state,
  workspace,
  busy,
  error,
  onChange,
  onCancel,
  onSave,
}: {
  state: AgentEditorState;
  workspace?: string;
  busy: boolean;
  error: string;
  onChange: (next: AgentEditorState) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const updateDraft = (patch: Partial<DesktopAgentDraft>) => {
    onChange({ ...state, draft: { ...state.draft, ...patch } });
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onCancel();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {state.mode === 'create' ? '创建 Agent' : '编辑 Agent'}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">保存后会在下一个 Boss 任务中生效。</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onCancel} disabled={busy}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              <span>名称</span>
              <Input
                autoFocus
                value={state.draft.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
                placeholder="code-reviewer"
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              <span>来源</span>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                value={state.draft.scope}
                onChange={(event) => updateDraft({ scope: event.target.value as 'user' | 'project' })}
              >
                <option value="user">用户 · 所有项目可用</option>
                <option value="project" disabled={!workspace}>项目 · 仅当前工作区</option>
              </select>
            </label>
          </div>

          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
            <span>使用场景</span>
            <Input
              value={state.draft.description}
              onChange={(event) => updateDraft({ description: event.target.value })}
              placeholder="例如：审查代码改动并指出风险"
            />
          </label>

          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
            <span>系统提示</span>
            <Textarea
              className="min-h-48 resize-y font-mono text-xs leading-6"
              value={state.draft.prompt}
              onChange={(event) => updateDraft({ prompt: event.target.value })}
              placeholder="描述这个 Agent 的角色、工作方式和输出要求……"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              <span>模型</span>
              <Input
                value={state.draft.model || ''}
                onChange={(event) => updateDraft({ model: event.target.value })}
                placeholder="inherit"
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              <span>工具（逗号分隔，留空表示继承全部）</span>
              <Input
                value={state.toolsText}
                onChange={(event) => onChange({ ...state, toolsText: event.target.value })}
                placeholder="Read, Grep, Bash"
              />
            </label>
          </div>

          <label className="flex items-center gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={state.draft.background === true}
              onChange={(event) => updateDraft({ background: event.target.checked })}
            />
            默认在后台运行
          </label>

          {error ? (
            <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>取消</Button>
          <Button type="button" onClick={onSave} disabled={busy}>
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AgentManager({ workspace }: { workspace?: string }) {
  const [catalog, setCatalog] = React.useState<DesktopAgentCatalog | null>(null);
  const [filter, setFilter] = React.useState<'all' | DesktopAgentSource>('all');
  const [loading, setLoading] = React.useState(true);
  const [busyAgent, setBusyAgent] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [error, setError] = React.useState('');
  const [editor, setEditor] = React.useState<AgentEditorState | null>(null);

  const loadCatalog = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCatalog(await window.agentDesktop.agents.list({ workspace }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  React.useEffect(() => {
    void loadCatalog();
    return window.agentDesktop.agents.onChanged(() => { void loadCatalog(); });
  }, [loadCatalog]);

  const updateCatalog = (next: DesktopAgentCatalog, message: string) => {
    setCatalog(next);
    setNotice(message);
    setError('');
  };

  const toggleAgent = async (agent: DesktopAgentDefinition, enabled: boolean) => {
    setBusyAgent(agent.id);
    setNotice('');
    setError('');
    try {
      const next = await window.agentDesktop.agents.setEnabled({
        agentType: agent.agentType,
        enabled,
        workspace,
      });
      updateCatalog(next, `${agent.agentType} 已${enabled ? '启用' : '停用'}。新任务将使用最新配置。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAgent('');
    }
  };

  const editAgent = async (agent: DesktopAgentDefinition) => {
    if (!agent.canEdit || !agent.fileName || (agent.source !== 'user' && agent.source !== 'project')) return;
    setBusyAgent(agent.id);
    setError('');
    try {
      const draft = await window.agentDesktop.agents.read({
        scope: agent.source,
        fileName: agent.fileName,
        workspace,
      });
      setEditor({
        mode: 'edit',
        previousScope: agent.source,
        previousFileName: agent.fileName,
        draft,
        toolsText: (draft.tools || []).join(', '),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAgent('');
    }
  };

  const saveAgent = async () => {
    if (!editor) return;
    setBusyAgent('editor');
    setError('');
    const draft = {
      ...editor.draft,
      tools: editor.toolsText.split(',').map((item) => item.trim()).filter(Boolean),
    };
    try {
      const next = editor.mode === 'create'
        ? await window.agentDesktop.agents.create({ ...draft, workspace })
        : await window.agentDesktop.agents.update({
            ...draft,
            previousScope: editor.previousScope!,
            previousFileName: editor.previousFileName!,
            workspace,
          });
      updateCatalog(next, `Agent “${draft.name}”已保存。`);
      setEditor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAgent('');
    }
  };

  const deleteAgent = async (agent: DesktopAgentDefinition) => {
    if (!agent.canDelete || !agent.fileName || (agent.source !== 'user' && agent.source !== 'project')) return;
    if (!window.confirm(`删除 Agent “${agent.agentType}”？此操作不会删除它产生的历史会话。`)) return;
    setBusyAgent(agent.id);
    setError('');
    try {
      const next = await window.agentDesktop.agents.delete({
        scope: agent.source,
        fileName: agent.fileName,
        workspace,
      });
      updateCatalog(next, `Agent “${agent.agentType}”已删除。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAgent('');
    }
  };

  const agents = (catalog?.agents || []).filter((agent) => filter === 'all' || agent.source === filter);
  const sourceFilters = ['all', 'built-in', 'user', 'project', 'managed'] as const;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card/75 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Bot className="h-4 w-4 text-primary" />
              Agent 浏览器
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-6 text-muted-foreground">
              管理内置、用户与当前项目 Agent。启用后可在 Boss 输入框输入 @，从 Agents 标签显式调度。
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void loadCatalog()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              刷新
            </Button>
            <Button type="button" size="sm" onClick={() => { setError(''); setEditor(createEmptyDraft(workspace)); }}>
              <Plus className="h-4 w-4" />
              创建 Agent
            </Button>
          </div>
        </div>

        {catalog ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Agent 总数', catalog.totals.all],
              ['生效中', catalog.totals.active],
              ['来源类型', catalog.totals.sources],
              ['内置', catalog.totals.builtIn],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-muted/45 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">{label}</div>
                <div className="mt-0.5 text-lg font-semibold text-foreground">{value}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/25 p-1">
        {sourceFilters.map((source) => (
          <button
            key={source}
            type="button"
            onClick={() => setFilter(source)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs transition-colors',
              filter === source ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {source === 'all' ? '全部' : SOURCE_LABELS[source]}
          </button>
        ))}
      </div>

      {notice ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">{notice}</div> : null}
      {error && !editor ? <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}

      <div className="overflow-hidden rounded-2xl border border-border bg-card/75">
        {loading && !catalog ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            正在加载 Agents…
          </div>
        ) : agents.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">当前筛选下没有 Agent</div>
        ) : agents.map((agent) => (
          <div key={agent.id} className="flex items-start gap-3 border-b border-border/70 px-4 py-4 last:border-b-0">
            <span className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
              agent.agentType === 'verification' ? 'bg-rose-500/10 text-rose-500' : 'bg-primary/10 text-primary',
            )}>
              {agent.agentType === 'verification' ? <ShieldCheck className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-foreground">{agent.agentType}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{SOURCE_LABELS[agent.source]}</span>
                {!agent.effective ? (
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                    已被{agent.overriddenBy ? SOURCE_LABELS[agent.overriddenBy] : '其他来源'}覆盖
                  </span>
                ) : null}
                {agent.background ? <span className="text-[10px] text-muted-foreground">后台</span> : null}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {agent.agentType === 'verification'
                  ? '在非简单实现完成后独立运行构建、测试与检查，并给出 PASS / FAIL / PARTIAL 证据。'
                  : agent.description}
              </p>
              {agent.location ? <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">{agent.location}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {agent.canEdit ? (
                <Button type="button" variant="ghost" size="icon" title="编辑" disabled={Boolean(busyAgent)} onClick={() => void editAgent(agent)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              ) : null}
              {agent.canDelete ? (
                <Button type="button" variant="ghost" size="icon" title="删除" disabled={Boolean(busyAgent)} onClick={() => void deleteAgent(agent)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
              <AgentToggle
                checked={agent.enabled && agent.effective}
                disabled={!agent.effective || Boolean(busyAgent)}
                label={`${agent.enabled ? '停用' : '启用'} ${agent.agentType}`}
                onChange={(enabled) => void toggleAgent(agent, enabled)}
              />
            </div>
          </div>
        ))}
      </div>

      {catalog ? (
        <div className="space-y-1 px-1 font-mono text-[10px] leading-5 text-muted-foreground/75">
          <div>用户：{catalog.userAgentsDir}</div>
          <div>项目：{catalog.projectAgentsDir}</div>
        </div>
      ) : null}

      {editor ? (
        <AgentEditor
          state={editor}
          workspace={workspace}
          busy={busyAgent === 'editor'}
          error={error}
          onChange={setEditor}
          onCancel={() => { setEditor(null); setError(''); }}
          onSave={() => void saveAgent()}
        />
      ) : null}
    </div>
  );
}
