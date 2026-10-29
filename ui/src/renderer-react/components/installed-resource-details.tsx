import * as React from 'react';
import { ArrowLeft, BookOpen, Bot, ChevronRight, Hammer, Loader2, Trash2, UsersRound } from 'lucide-react';
import { AppDetailsSection, APP_DETAILS_LIST_CLASS, APP_DETAILS_ROW_CLASS } from '@/components/app-details-section';
import { AppDetailsSidePanel } from '@/components/app-details-side-panel';
import { ResourceIcon } from '@/components/resource-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';
import { installedResourceFilePath, installedResourceSource, installedResourceTitle, type InstalledResource } from '@/lib/installed-resources';

type FileDetail = { path: string; title: string; content?: string; error?: string; truncated?: boolean };

export function InstalledResourceDetails({ resource, onBack, backLabel = '常用', installed = true, actions, loading, busy = false, error, onRetry, onUninstalled }: {
  resource: InstalledResource;
  onBack(): void;
  backLabel?: string;
  installed?: boolean;
  actions?: React.ReactNode;
  loading?: boolean;
  busy?: boolean;
  error?: string;
  onRetry?(): void;
  onUninstalled?(): Promise<unknown>;
}) {
  const title = installedResourceTitle(resource);
  const skill = resource.kind === 'skill' ? resource.item : null;
  const expert = resource.kind === 'expert' ? resource.item : null;
  const label = skill ? '技能' : expert?.type === 'team' ? '专家团' : '专家';
  const source = installedResourceSource(resource);
  const tags = [...new Set((skill ? [skill.category, ...(skill.categories || [])] : expert?.tags || []).filter(Boolean))];
  const [file, setFile] = React.useState<FileDetail | null>(null);
  const [uninstalling, setUninstalling] = React.useState(false);
  const [operationError, setOperationError] = React.useState('');
  const uninstallPending = React.useRef(false);
  const operationBusy = busy || uninstalling;
  const canUninstall = installed && Boolean(resource.item.source) && !skill?.isBuiltin && Boolean(onUninstalled);
  const uninstall = async () => {
    if (!canUninstall || operationBusy || uninstallPending.current) return;
    if (!window.confirm(`确定卸载${label}“${title}”？`)) return;
    uninstallPending.current = true;
    setUninstalling(true); setOperationError('');
    try {
      const api = resource.kind === 'skill' ? window.agentDesktop.skillHub : window.agentDesktop.expertHub;
      const result = await api.uninstall({ sourcePath: resource.item.source! });
      if (!result?.success) throw new Error(result?.error || '卸载失败');
      await onUninstalled!();
    } catch (cause) {
      setOperationError(cleanIpcErrorMessage(cause));
    } finally {
      uninstallPending.current = false; setUninstalling(false);
    }
  };
  const panelId = React.useId();
  const request = React.useRef(0);
  const trigger = React.useRef<HTMLButtonElement | null>(null);
  const backButton = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    backButton.current?.focus({ preventScroll: true });
    return () => { request.current++; };
  }, []);

  const closeFile = () => {
    request.current++;
    setFile(null);
    trigger.current?.focus({ preventScroll: true });
  };
  const readFile = async (path: string, fileTitle: string) => {
    const revision = ++request.current;
    setFile({ path, title: fileTitle });
    try {
      const result = await window.agentDesktop.preview.readFile({ filePath: installedResourceFilePath(resource.item.source, path) });
      if (!['markdown', 'text', 'code'].includes(result.contentType)) throw new Error('此说明文件无法作为文本显示。');
      if (request.current === revision) setFile({ path, title: fileTitle, content: result.content, truncated: result.truncated });
    } catch (cause) {
      if (request.current === revision) setFile({ path, title: fileTitle, error: cleanIpcErrorMessage(cause instanceof Error ? cause.message : String(cause)) });
    }
  };
  const fileRow = (path: string, name: string, description: string) => <button
    type="button"
    disabled={operationBusy}
    aria-expanded={file?.path === path}
    aria-controls={file?.path === path ? panelId : undefined}
    onClick={event => {
      if (file?.path === path) { closeFile(); return; }
      trigger.current = event.currentTarget;
      void readFile(path, name);
    }}
    className="group flex w-full items-center justify-between gap-4 rounded-lg px-4 py-4 text-left text-sm transition-colors hover:bg-muted/50 aria-expanded:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
  >
    <span className="min-w-0 flex-1"><span className="block break-words font-medium leading-6">{name}</span>{description && <span className="mt-1 block whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">{description}</span>}</span>
    <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground group-aria-expanded:text-foreground" />
  </button>;
  const infoRow = (name: string, value?: React.ReactNode) => value ? <div className={APP_DETAILS_ROW_CLASS}>
    <dt className="shrink-0 text-muted-foreground">{name}</dt><dd className="min-w-0 break-words text-right">{value}</dd>
  </div> : null;
  const installedDate = expert?.installedAt ? new Date(expert.installedAt) : null;

  return <div data-installed-resource-details={resource.kind} className="flex h-full min-h-0 min-w-0 flex-col bg-background lg:flex-row" onKeyDown={event => {
    if (event.key === 'Escape' && file) { event.stopPropagation(); closeFile(); }
  }}>
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="@container mx-auto max-w-3xl space-y-8 px-5 pb-12 pt-4 sm:px-9">
        <nav aria-label={`${label}详情导航`} className="flex items-center gap-2 text-sm text-muted-foreground">
          <Button ref={backButton} variant="ghost" size="sm" className="-ml-2 gap-1.5 px-2" disabled={operationBusy} onClick={onBack}><ArrowLeft className="h-4 w-4" />{backLabel}</Button>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" /><span className="truncate text-foreground">{title}</span>
        </nav>
        <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 @2xl:grid-cols-[auto_minmax(0,1fr)_auto]">
          <ResourceIcon source={skill?.icon || expert?.avatar} label={title} fallback={skill ? Hammer : expert?.type === 'team' ? UsersRound : Bot} className="h-16 w-16 rounded-2xl" />
          <div className="min-w-0 flex-1"><h1 className="break-words text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1.5 break-words text-sm text-muted-foreground">{label} · {expert?.profession || source}</p></div>
          {(actions || canUninstall) && <fieldset disabled={operationBusy} aria-label="资源操作" className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 @2xl:col-span-1">
            {actions}
            {canUninstall && <Button variant="outline" className="rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive" data-resource-uninstall onClick={() => void uninstall()}>
              {uninstalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{uninstalling ? '卸载中…' : '卸载'}
            </Button>}
          </fieldset>}
        </header>
        {loading && <p role="status" className="text-sm text-muted-foreground">正在加载详细信息…</p>}
        {error && <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"><p className="break-words">{error}</p>{onRetry && <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>重试</Button>}</div>}
        {operationError && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{operationError}</p>}
        <div className="space-y-3">
          <p className="whitespace-pre-wrap break-words text-sm leading-7">{resource.item.description || '暂无描述'}</p>
          {tags.length > 0 && <div className="flex flex-wrap gap-1.5">{tags.map(tag => <Badge key={tag} variant="outline" className="max-w-full whitespace-normal break-words rounded-md">{tag}</Badge>)}</div>}
        </div>
        <AppDetailsSection title="基本信息">
          <dl className={APP_DETAILS_LIST_CLASS}>
            {infoRow(installed ? '启用状态' : '安装状态', !installed ? '未安装' : resource.item.enabled === false ? '已停用' : '已启用')}
            {infoRow('类型', label)}
            {infoRow('来源', source)}
            {infoRow('版本', skill?.version)}
            {infoRow('开发者', skill?.ownerName || skill?.namespace?.displayName || skill?.namespace?.handle)}
            {infoRow('职业', expert?.profession)}
            {infoRow('分类', expert?.categoryName)}
            {infoRow('成员数量', expert?.type === 'team' ? `${expert.members?.length || 0} 人` : undefined)}
            {infoRow('安装时间', installedDate && !Number.isNaN(installedDate.getTime()) ? installedDate.toLocaleDateString('zh-CN') : undefined)}
          </dl>
        </AppDetailsSection>
        {!!expert?.quickPrompts?.length && <AppDetailsSection title="专家帮你做">
          <ul className={APP_DETAILS_LIST_CLASS}>{expert.quickPrompts.map((prompt, index) => <li key={index} className="whitespace-pre-wrap break-words py-4 leading-7">{prompt}</li>)}</ul>
        </AppDetailsSection>}
        <AppDetailsSection title={skill ? '技能说明' : '专家说明'}>
          {installed ? <div className="space-y-1 py-2">{fileRow(skill ? 'SKILL.md' : expert?.promptFile || 'assistant.md', skill ? 'SKILL.md' : '专家指令', skill ? '查看完整的使用说明与操作步骤。' : '查看专家的角色设定、工作方式与任务要求。')}</div>
            : <p className="py-4 text-sm text-muted-foreground">安装后可查看{skill ? '完整的技能说明与操作步骤' : '专家指令与成员配置'}。</p>}
        </AppDetailsSection>
        {!!expert?.members?.length && <AppDetailsSection title="团队成员" count={expert.members.length}>
          <div className="space-y-1 py-2">{expert.members.map((member, index) => {
            const name = member.displayName || member.name || member.id || `成员 ${index + 1}`;
            const description = [member.profession || member.role, member.description].filter(Boolean).join('\n');
            const path = installed && (member.localPromptFile || member.promptFile);
            return <div key={member.id || index}>{path ? fileRow(path, name, description) : <div className="px-4 py-4 text-sm"><p className="break-words font-medium">{name}</p><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">{description}</p></div>}</div>;
          })}</div>
        </AppDetailsSection>}
        {installed && !!expert?.skills?.length && <AppDetailsSection title="配套技能" count={expert.skills.length}>
          <div className="space-y-1 py-2">{expert.skills.map(path => <React.Fragment key={path}>{fileRow(`${path.replace(/[\\/]+$/, '')}/SKILL.md`, path.split(/[\\/]/).filter(Boolean).pop() || path, '查看技能说明。')}</React.Fragment>)}</div>
        </AppDetailsSection>}
      </div>
    </div>
    {file && <AppDetailsSidePanel id={panelId} label="详细内容" title={`${title} · ${file.title}`} icon={<BookOpen className="h-4 w-4 shrink-0" />} onClose={closeFile}>
      {file.error ? <div role="alert" className="overflow-y-auto p-5 text-sm text-destructive"><p className="break-words">{file.error}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void readFile(file.path, file.title)}>重试</Button></div>
        : file.content === undefined ? <p role="status" className="p-5 text-sm text-muted-foreground">正在读取详细内容…</p>
        : <div className="min-h-0 flex-1 overflow-auto p-5">{file.truncated && <p role="status" className="mb-3 text-xs text-muted-foreground">文件较大，当前仅展示部分内容。</p>}<pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6">{file.content || '文件内容为空。'}</pre></div>}
    </AppDetailsSidePanel>}
  </div>;
}
