import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { ProjectIcon, ProjectIconPicker } from '@/components/projects/project-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { PermissionMode, ProjectCreationDraft } from '@/types';

type Patch = Parameters<Window['agentDesktop']['projectCreation']['updateDraft']>[0]['patch'];
type Props = {
  draft: ProjectCreationDraft;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onSave: (patch: Patch) => Promise<void>;
  onOpenProject: () => void;
  onOpenSession: (id: string) => void;
  onConfigureApp: (id: string) => void;
  onDiscuss: () => void;
};
const KIND_LABELS = { skill: '技能', expert: '专家', app: 'App' } as const;
const SOURCE_LABELS: Record<string, string> = { builtin: '内置', installed: '已安装', marketplace: '市场' };
const PERMISSION_LABELS: Record<PermissionMode, string> = { default: '标准', plan: '仅规划', acceptEdits: '自动编辑', dontAsk: '不询问（需确认的操作拒绝）', bypassPermissions: '完全访问' };
const STATUS_LABELS: Record<ProjectCreationDraft['status'], string> = { awaiting_confirmation: '请检查方案，确认后安装缺失资源并创建项目', installing: '正在准备资源，可离开页面，草稿会自动保存', creating: '正在创建项目', awaiting_authorization: '完成 App 配置或服务选择后，可以继续创建', completed: '项目已创建，后续会话自动携带所选资源', failed: '创建未完成，可重试或修改方案', cancelled: '方案已取消，可以修改后重新提交' };
const resourceKey = (entry: ProjectCreationDraft['resources'][number]) => `${entry.kind}:${entry.id}`;

export function ProjectCreationDraftCard({ draft, busy = false, onConfirm, onCancel, onSave, onOpenProject, onOpenSession, onConfigureApp, onDiscuss }: Props) {
  const [editing, setEditing] = React.useState(false);
  const [project, setProject] = React.useState(draft.project);
  const [firstTask, setFirstTask] = React.useState(draft.firstTask || '');
  const [selected, setSelected] = React.useState(draft.resources.map(resourceKey));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => { setEditing(false); setError(''); }, [draft.id, draft.version]);
  const beginEdit = () => {
    setProject(draft.project); setFirstTask(draft.firstTask || ''); setSelected(draft.resources.map(resourceKey)); setError(''); setEditing(true);
  };
  const save = async () => {
    setSaving(true); setError('');
    try {
      const retained = draft.resources.filter(entry => selected.includes(resourceKey(entry)));
      const experts = retained.filter(entry => entry.kind === 'expert').map(entry => entry.id);
      await onSave({ ...project, firstTask, skillIds: retained.filter(entry => entry.kind === 'skill').map(entry => entry.id), expertIds: experts,
        assistantName: project.assistantName && !experts.includes(project.assistantName) ? null : project.assistantName,
        appIds: retained.filter(entry => entry.kind === 'app').map(entry => entry.id),
        appServiceIds: (project.appServiceIds || []).filter(id => retained.some(entry => entry.services?.some(service => service.id === id))),
      });
      setEditing(false);
    } catch (error) { setError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error)); }
    finally { setSaving(false); }
  };
  const completed = draft.status === 'completed';
  const locked = busy || saving;
  const resources = draft.resources;
  return (
    <section className="my-4 overflow-hidden rounded-xl border border-primary/30 bg-card text-sm" aria-label="项目创建方案" aria-busy={locked}>
      <header className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
        <ProjectIcon icon={editing ? project.icon : draft.project.icon} />
        <div><h2 className="font-semibold">项目创建方案</h2><p className="mt-1 text-xs text-muted-foreground" role="status">{STATUS_LABELS[draft.status]} · 已保存</p></div>
      </header>
      <div className="space-y-4 px-4 py-4">
        {editing ? <fieldset disabled={locked} className="space-y-4 disabled:opacity-60">
          <ProjectIconPicker value={project.icon} onChange={icon => setProject({ ...project, icon })} disabled={locked} />
          <label className="grid gap-1.5">项目名称<Input value={project.name} maxLength={80} onChange={event => setProject({ ...project, name: event.target.value })} /></label>
          <label className="grid gap-1.5">项目指令<Textarea rows={6} value={project.instructions} maxLength={20000} onChange={event => setProject({ ...project, instructions: event.target.value })} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">默认模式<select className="rounded-md border bg-background p-2" value={project.mode || 'boss'} onChange={event => setProject({ ...project, mode: event.target.value as 'chat' | 'boss' })}><option value="boss">Boss</option><option value="chat">Chat</option></select></label>
            <label className="grid gap-1.5">默认权限<select className="rounded-md border bg-background p-2" value={project.permissionMode || 'default'} onChange={event => setProject({ ...project, permissionMode: event.target.value as PermissionMode })}>{Object.entries(PERMISSION_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          </div>
          <div className="space-y-2"><p>项目目录（选中项为默认目录）</p>
            {!project.workspaces?.length && <p className="text-xs text-muted-foreground">创建时自动建立默认目录</p>}
            {project.workspaces?.map(directory => <div key={directory} className="flex items-center gap-2"><label className="flex min-w-0 flex-1 items-center gap-2"><input type="radio" name={`workspace-${draft.id}`} checked={project.workspace === directory} onChange={() => setProject({ ...project, workspace: directory })} /><span className="break-all">{directory}</span></label><Button size="sm" variant="ghost" onClick={() => { const next = project.workspaces?.filter(item => item !== directory) || []; setProject({ ...project, workspaces: next, workspace: project.workspace === directory ? next[0] || null : project.workspace }); }}>移除</Button></div>)}
            <Button size="sm" variant="outline" onClick={() => void window.agentDesktop.pickDirectory().then(directory => { if (directory) setProject(previous => ({ ...previous, workspaces: [...new Set([...(previous.workspaces || []), directory])], workspace: previous.workspace || directory })); }).catch(error => setError(String(error)))}>选择目录</Button>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={project.agentTeamsEnabled !== false} onChange={event => setProject({ ...project, agentTeamsEnabled: event.target.checked })} />启用智能体团队协作</label>
          <label className="grid gap-1.5">默认专家<select className="rounded-md border bg-background p-2" value={project.assistantName ?? '__auto'} onChange={event => setProject({ ...project, assistantName: event.target.value === '__auto' ? null : event.target.value })}><option value="__auto">按项目专家配置自动选择</option><option value="">不使用默认专家</option>{resources.filter(entry => entry.kind === 'expert' && selected.includes(resourceKey(entry))).map(entry => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}</select></label>
          <label className="grid gap-1.5">创建后立即执行的首个任务（可选）<Textarea rows={3} maxLength={12000} value={firstTask} onChange={event => setFirstTask(event.target.value)} /></label>
        </fieldset> : <>
          <div className="flex items-center gap-3"><ProjectIcon icon={draft.project.icon} className="h-12 w-12" /><div><p className="text-xs text-muted-foreground">项目图标</p><p className="mt-1 text-xs">{draft.project.icon?.kind === 'generated' ? 'AI 生成 · 随方案确认' : '内置图标'}{!completed && '，可修改方案或继续讨论调整'}</p></div></div>
          <div><p className="text-xs text-muted-foreground">项目名称</p><p className="mt-1 break-words font-medium">{draft.project.name}</p></div>
          <div><p className="text-xs text-muted-foreground">项目指令</p><p className="mt-1 whitespace-pre-wrap break-words leading-6">{draft.project.instructions || '无额外指令'}</p></div>
          <p className="text-xs text-muted-foreground">{draft.project.mode === 'chat' ? 'Chat' : 'Boss'} · {PERMISSION_LABELS[draft.project.permissionMode || 'default']} · 团队协作{draft.project.agentTeamsEnabled === false ? '关闭' : '开启'}</p>
          <div className="text-xs"><p className="text-muted-foreground">工作目录</p>{draft.project.workspaces?.length ? draft.project.workspaces.map(directory => <p className="mt-1 break-all" key={directory}>{directory}{directory === draft.project.workspace ? '（默认）' : ''}</p>) : <p className="mt-1">自动建立项目默认目录</p>}</div>
          <p className="text-xs">默认专家：{draft.project.assistantName === '' ? '不使用' : resources.find(entry => entry.kind === 'expert' && entry.id === draft.project.assistantName)?.displayName || '按项目专家配置自动选择'}</p>
          {draft.firstTask && <div><p className="text-xs text-muted-foreground">首个任务</p><p className="mt-1 whitespace-pre-wrap break-words">{draft.firstTask}</p></div>}
        </>}
        <div className="space-y-2"><h3 className="text-xs text-muted-foreground">项目资源{editing ? '（取消勾选即可移除）' : ''}</h3>
          {!resources.length && <p className="text-xs">暂未选择资源，可继续在会话中补充</p>}
          {resources.map(entry => <div key={resourceKey(entry)} className="space-y-1.5 rounded-md border border-border p-3 text-xs">
            <div className="flex items-start gap-2">{editing && <input aria-label={`选择${entry.displayName}`} type="checkbox" disabled={locked} checked={selected.includes(resourceKey(entry))} onChange={event => setSelected(previous => event.target.checked ? [...previous, resourceKey(entry)] : previous.filter(id => id !== resourceKey(entry)))} />}
              <p className="min-w-0 flex-1 break-words font-medium">{KIND_LABELS[entry.kind]} · {entry.displayName || entry.id} {entry.version && <span className="font-normal text-muted-foreground">v{entry.version}</span>}</p>
              <span className="shrink-0 text-muted-foreground">{entry.status === 'installing' ? '安装中' : entry.status === 'failed' ? '安装失败' : entry.status === 'disabled' ? '待启用' : entry.installed ? '已安装' : '确认后安装'}</span>
            </div>
            <p className="break-all text-muted-foreground">{SOURCE_LABELS[entry.source || ''] || entry.source} · {entry.id}</p>
            {entry.description && <p className="whitespace-pre-wrap break-words text-muted-foreground">{entry.description}</p>}
            {!!entry.permissions?.length && <p className="break-words">App 声明权限：{entry.permissions.join('、')}（安装时单独确认）</p>}
            {entry.toolSelection === 'services' && <div className="space-y-1"><p className="text-muted-foreground">子服务</p>{entry.services?.length ? entry.services.map(service => editing ? <label key={service.id} className="flex items-start gap-2"><input type="checkbox" disabled={locked || !selected.includes(resourceKey(entry))} checked={project.appServiceIds?.includes(service.id) || false} onChange={event => setProject(previous => ({ ...previous, appServiceIds: event.target.checked ? [...(previous.appServiceIds || []), service.id] : previous.appServiceIds?.filter(id => id !== service.id) }))} /><span>{service.title}{!service.available ? '（需启用或授权）' : ''}</span></label> : draft.project.appServiceIds?.includes(service.id) ? <p key={service.id}>{service.title}</p> : null) : <p>配置 App 后可查看服务</p>}{!editing && !draft.project.appServiceIds?.some(id => entry.services?.some(service => service.id === id)) && <p>尚未选择，请修改方案</p>}</div>}
          </div>)}
        </div>
        {draft.pendingActions?.map(action => <div key={action.appId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-3 text-xs"><span>{action.displayName}：{action.message}</span><Button size="sm" variant="outline" onClick={() => onConfigureApp(action.appId)} disabled={locked}>配置 / 授权 App</Button></div>)}
        {(error || draft.error) && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">{error || draft.error}</p>}
        {draft.firstTaskError && <p role="alert" className="text-xs text-destructive">项目已创建，但首个任务需要处理：{draft.firstTaskError}</p>}
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border/70 px-4 py-3">
        {completed ? <>{draft.firstTaskSessionId && <Button variant="outline" onClick={() => onOpenSession(draft.firstTaskSessionId!)}>查看首个任务</Button>}<Button onClick={onOpenProject}>查看项目</Button></> : editing ? <><Button variant="ghost" onClick={() => setEditing(false)} disabled={locked}>放弃修改</Button><Button onClick={() => void save()} disabled={locked}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}保存并重新预览</Button></> : <>
          {draft.status !== 'cancelled' && <Button variant="ghost" onClick={onCancel} disabled={locked}>取消方案</Button>}
          <Button variant="ghost" onClick={onDiscuss} disabled={locked}>继续讨论</Button>
          <Button variant="outline" onClick={beginEdit} disabled={locked}>修改方案</Button>
          {draft.status !== 'cancelled' && <Button onClick={onConfirm} disabled={locked}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{draft.status === 'failed' ? '重试创建' : draft.status === 'awaiting_confirmation' ? '确认并创建' : '继续创建'}</Button>}
        </>}
      </footer>
    </section>
  );
}
