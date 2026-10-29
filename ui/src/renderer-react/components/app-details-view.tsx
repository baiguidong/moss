import * as React from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, MessageSquareText, MonitorPlay, Settings2 } from 'lucide-react';
import type { StoredApp } from '@/types';
import { AppIcon } from '@/components/app-icon';
import { AppDetailsEntry, AppDetailsSection, APP_DETAILS_LIST_CLASS, APP_DETAILS_ROW_CLASS } from '@/components/app-details-section';
import { AppDetailsTools } from '@/components/app-details-tools';
import { AppDetailsResources } from '@/components/app-details-resources';
import { AppDetailsSidePanel } from '@/components/app-details-side-panel';
import { AppConnectorSettings } from '@/components/app-connector-settings';
import { AppSettingsForm } from '@/components/app-settings-form';
import { isAppEnabled, setAppEnabled } from '@/components/apps-panel';
import { AppDetailsManagement, AppManagementPanel, APP_MANAGEMENT_TITLES, type AppManagementActions, type AppManagementPage } from '@/components/app-details-management';
import { AppMarketplacePanel } from '@/components/app-marketplace-panel';
import { Button } from '@/components/ui/button';
import { McpManagementPanel } from '@/components/mcp-management-panel';
import { getAppSettingsEntries, getAppUiEntry, usesBuiltinMcpUi } from '@/lib/app-navigation';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';
import { describeAppPermission } from '../../shared/app-capability-descriptions.mjs';

/** Core details; App-owned pages open from the header in their own workspace. */
export function AppDetailsView({ app, installedApps, onBack, onTry, onOpenApp, onRefresh, onAuthorize, onDelete, onIterate, onLoadVersions, onRollback, initialSettingsOpen = false }: AppManagementActions & {
  app: StoredApp;
  installedApps?: StoredApp[];
  onBack: () => void;
  onTry: (prompt?: string) => void;
  onOpenApp?: (route: string) => void;
  onRefresh: () => Promise<unknown>;
  initialSettingsOpen?: boolean;
  onAuthorize?: (app: StoredApp) => ReturnType<Window['agentDesktop']['connectorApp']>;
}) {
  const appId = app.id || app.name;
  const title = app.displayName || app.title || app.name;
  const skills = app.declaredSkills || app.contributes?.skills || [];
  const settings = app.contributes?.settings || [];
  const forms = settings.filter(setting => setting.form);
  const uiEntry = getAppUiEntry(app);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const isMcp = usesBuiltinMcpUi(app);
  const settingsPages = isMcp || app.navigation?.location === 'details' ? []
    : getAppSettingsEntries([app]).filter(entry => entry.route !== uiEntry?.route);
  const [marketOpen, setMarketOpen] = React.useState(false);
  const [settingsKind, setSettingsKind] = React.useState<'mcp' | 'connector' | 'form' | AppManagementPage | null>(initialSettingsOpen ? isMcp ? 'mcp' : app.connectorApp ? 'connector' : forms.length ? 'form' : null : null);
  const [formId, setFormId] = React.useState(forms[0]?.id);
  const mcpSettingsOpen = settingsKind === 'mcp';
  const managementPage = settingsKind && settingsKind in APP_MANAGEMENT_TITLES ? settingsKind as AppManagementPage : null;
  const settingsTitle = managementPage ? APP_MANAGEMENT_TITLES[managementPage] : settingsKind === 'form' ? settings.find(form => form.id === formId)?.title || '应用设置' : mcpSettingsOpen && !isMcp ? 'MCP 服务' : '连接设置';
  const [settingsBusy, setSettingsBusy] = React.useState(false);
  const operationBusy = busy || settingsBusy;
  const [settingsContainer, setSettingsContainer] = React.useState<HTMLDivElement | null>(null);
  const [skill, setSkill] = React.useState<{ id: string; title: string; content?: string; error?: string } | null>(null);
  const sidePanelId = React.useId();
  const request = React.useRef(0);
  React.useEffect(() => () => { request.current++; }, []);
  const unavailable = app.packageStatus === 'invalid' || app.packageStatus === 'incompatible';
  const enabled = isAppEnabled(app);
  const scope = app.toolScope || 'session';
  const scopeFixed = Boolean(app.connectorApp || app.permissions?.includes('desktop:control'));
  const loadingMode = scope === 'global' ? app.toolLoading === 'always' ? 'global-always' : 'global-demand' : 'session';
  const examples = app.overview?.examples || app.mcpPresentation?.examples || [];
  const mcpUnavailable = unavailable ? '安装包不可用，请先更新或重新安装。' : !enabled ? '启用应用后可连接服务。' : isMcp && !app.grants?.includes('mcp:read') ? '请在应用设置中授予 MCP 读取权限。' : null;
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); await onRefresh(); }
    catch (cause) { setError(cleanIpcErrorMessage(cause instanceof Error ? cause.message : String(cause))); }
    finally { setBusy(false); }
  };
  const readSkill = async (item: typeof skills[number]) => {
    if (operationBusy) return;
    const revision = ++request.current;
    setSettingsKind(null);
    setSkill({ id: item.id, title: item.title });
    try {
      const result = await window.agentDesktop.readAppSkill({ appId, skillId: item.id });
      if (request.current === revision) setSkill({ id: item.id, ...result });
    } catch (cause) {
      if (request.current === revision) setSkill({ id: item.id, title: item.title, error: cleanIpcErrorMessage(String(cause)) });
    }
  };
  if (marketOpen) return <AppMarketplacePanel installedApps={installedApps || [app]} onBack={() => setMarketOpen(false)} onInstalled={onRefresh} />;
  return <div data-app-details={appId} className="flex h-full min-h-0 min-w-0 flex-col bg-background lg:flex-row">
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="@container mx-auto max-w-3xl space-y-8 px-5 pb-12 pt-4 sm:px-9">
        <nav aria-label="应用详情导航" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Button variant="ghost" size="sm" className="-ml-2 gap-1.5 px-2" disabled={operationBusy} onClick={onBack}><ArrowLeft className="h-4 w-4" />插件</Button>
          <ChevronRight className="h-3.5 w-3.5" /><span className="truncate text-foreground">{title}</span>
        </nav>
        <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-5 @2xl:grid-cols-[auto_minmax(0,1fr)_auto]">
          <AppIcon icon={app.icon} className="h-16 w-16 shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1.5 text-sm text-muted-foreground">{app.publisher?.name || app.trust?.publisher?.name || 'Moss App'} · {app.description}</p></div>
          <div className="col-span-2 flex shrink-0 flex-wrap items-center gap-2 @2xl:col-span-1">
            {uiEntry && <Button variant="outline" className="rounded-full" data-app-ui-open={appId} disabled={Boolean(uiEntry.unavailableReason) || operationBusy || !onOpenApp} title={uiEntry.unavailableReason || undefined} onClick={() => onOpenApp?.(uiEntry.route)}><MonitorPlay className="h-4 w-4" />打开</Button>}
            {app.connectorApp && <Button variant="outline" className="rounded-full" data-app-connection-open={appId} disabled={unavailable || operationBusy} aria-expanded={settingsKind === 'connector'} aria-controls={settingsKind === 'connector' ? sidePanelId : undefined} onClick={() => { request.current++; setSkill(null); setSettingsKind('connector'); }}><Settings2 className="h-4 w-4" />连接设置</Button>}
            <Button className="rounded-full" disabled={!enabled || unavailable || operationBusy} onClick={() => onTry()}><MessageSquareText className="h-4 w-4" />试用</Button>
            <AppDetailsManagement app={app} busy={operationBusy} onOpen={page => { request.current++; setSkill(null); setSettingsKind(page); }}
              onUpdate={() => setMarketOpen(true)} onIterate={onIterate ? name => run(() => onIterate(name)) : undefined} />
          </div>
        </header>
        {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        {unavailable && <p role="alert" className="text-sm text-destructive">{app.packageStatus === 'incompatible' ? '当前版本与 Moss 不兼容，请从顶部管理菜单更新应用。' : '安装包不可用，请从顶部管理菜单更新或重新安装。'}</p>}
        {examples.length > 0 && <section aria-label="试用示例" className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-950 via-indigo-900 to-violet-800 px-5 py-8 sm:p-10">
          <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-blue-400/20 blur-3xl" />
          <div className="relative mx-auto max-w-lg space-y-3">
            {examples.map((prompt, index) => <button type="button" key={index} disabled={!enabled || unavailable || operationBusy} onClick={() => onTry(prompt)} className="group flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-slate-950/65 px-5 py-4 text-left text-white shadow-lg transition-colors hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50">
              <span className="min-w-0 flex-1 text-sm leading-6"><span className="mr-2 text-blue-300">{title}</span>{prompt}</span><ArrowRight className="h-5 w-5 shrink-0 text-white/65 transition-transform group-hover:translate-x-0.5" />
            </button>)}
          </div>
        </section>}
        <div data-app-introduction className="space-y-3"><p className="whitespace-pre-line text-sm leading-7">{app.overview?.description || app.description}</p>{isMcp && app.mcpPresentation?.usage && <p className="whitespace-pre-line text-sm leading-7">{app.mcpPresentation.usage}</p>}<p className="text-sm text-muted-foreground">{!enabled ? '启用后即可在主会话使用。' : scope === 'global' ? app.toolLoading === 'always' ? '全局常驻，工具直接可用。无需选择 App，在主会话描述需求即可。' : '全局按需，模型需要时查找并加载工具。无需手动选择 App。' : scopeFixed ? '当前按会话使用，试用时会为你选择此 App。' : '当前按会话使用，试用时会为你选择此 App。可在下方切换为全局按需或全局常驻。'}</p></div>
        <AppDetailsSection title="基本信息">
          <dl className={APP_DETAILS_LIST_CLASS}>
            <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">启用状态</dt><dd><label className="flex cursor-pointer items-center gap-2"><input type="checkbox" role="switch" aria-label="启用应用" checked={enabled} disabled={operationBusy || unavailable} onChange={event => void run(() => setAppEnabled(app, event.target.checked))} className="h-4 w-4 accent-primary" />{enabled ? '已启用' : '已停用'}</label></dd></div>
            <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">使用范围</dt><dd><select aria-label="工具使用范围" value={loadingMode} disabled={operationBusy || unavailable || scopeFixed} onChange={event => void run(() => window.agentDesktop.setAppToolScope({ appId, scope: event.target.value === 'session' ? 'session' : 'global', loading: event.target.value === 'global-always' ? 'always' : 'on-demand' }))} className="max-w-full rounded-md border bg-background px-3 py-1.5"><option value="global-demand">全局按需</option><option value="global-always">全局常驻</option><option value="session">按会话选择</option></select></dd></div>
            <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">版本</dt><dd>{app.currentVersion || '—'}</dd></div>
            <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">开发者</dt><dd>{app.publisher?.name || app.trust?.publisher?.name || '未提供'}</dd></div>
            <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">安装包签名</dt><dd>{app.trust?.status === 'trusted' ? '可信发布者' : app.trust?.status === 'untrusted' ? '签名未受信任' : app.trust?.status === 'unsigned' ? '未签名' : '使用时校验'}</dd></div>
            {app.updatedAt > 0 && <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">更新时间</dt><dd>{new Date(app.updatedAt).toLocaleString('zh-CN')}</dd></div>}
            {app.builtin && <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">来源</dt><dd>Moss 内置</dd></div>}
          </dl>
        </AppDetailsSection>
        {(!!app.permissions?.length || forms.length > 0 || settingsPages.length > 0) && <AppDetailsSection title="应用设置">
          <dl className={APP_DETAILS_LIST_CLASS}>
            {(app.permissions || []).map(permission => {
              const detail = describeAppPermission(permission);
              const granted = Boolean(app.grants?.includes(permission));
              return <div key={permission} className={APP_DETAILS_ROW_CLASS}>
                <dt className="min-w-0 text-muted-foreground">{detail.label}<span className="mt-1 block text-xs leading-5">{detail.description}</span></dt>
                <dd className="shrink-0"><label className="flex cursor-pointer items-center gap-2"><input type="checkbox" role="switch" aria-label={detail.label} checked={granted} disabled={operationBusy || unavailable} className="h-4 w-4 accent-primary" onChange={() => void run(() => window.agentDesktop.setAppGrants({ appId, grants: granted ? (app.grants || []).filter(item => item !== permission) : [...(app.grants || []), permission] }))} />{granted ? '已允许' : '未允许'}</label></dd>
              </div>;
            })}
          </dl>
          {forms.map(form => <AppDetailsEntry key={form.id} title={form.title} disabled={unavailable || !enabled || operationBusy || Boolean(form.permission && !app.grants?.includes(form.permission))} aria-expanded={settingsKind === 'form' && formId === form.id} aria-controls={settingsKind === 'form' && formId === form.id ? sidePanelId : undefined} onClick={() => { request.current++; setSkill(null); setFormId(form.id); setSettingsKind('form'); }} />)}
          {settingsPages.map(entry => <AppDetailsEntry key={entry.id} title={entry.title} data-app-setting={entry.id} disabled={operationBusy || Boolean(entry.unavailableReason) || !onOpenApp} description={entry.unavailableReason || undefined} onClick={() => onOpenApp?.(entry.route)} />)}
        </AppDetailsSection>}
        {skills.length > 0 && <AppDetailsSection title="技能" count={skills.length}>
          <div className="space-y-1 py-2 text-sm">
            {skills.map(item => <AppDetailsEntry key={item.id} title={item.title} description={item.description} disabled={operationBusy} aria-expanded={skill?.id === item.id} aria-controls={skill?.id === item.id ? sidePanelId : undefined} onClick={() => void readSkill(item)} />)}
          </div>
        </AppDetailsSection>}
        {isMcp || Boolean(app.mcpServices?.length) ? <McpManagementPanel key={`${appId}/${app.currentVersion}`} app={app} unavailableReason={mcpUnavailable} settingsOpen={mcpSettingsOpen} settingsBusy={settingsBusy} settingsPanelId={sidePanelId} settingsContainer={settingsContainer}
          onOpenSettings={() => { request.current++; setSkill(null); setSettingsKind('mcp'); }} onSettingsClosed={() => setSettingsKind(null)} onSettingsBusyChange={setSettingsBusy} onRefresh={onRefresh}>
          {tools => <AppDetailsTools app={app} mcpTools={tools} />}
        </McpManagementPanel> : <AppDetailsTools app={app} />}
        <AppDetailsResources app={app} />
      </div>
    </div>
    {settingsKind ? <AppDetailsSidePanel id={sidePanelId} label={settingsTitle} title={`${title} · ${settingsTitle}`} icon={<Settings2 className="h-4 w-4" />} busy={settingsBusy} onClose={() => setSettingsKind(null)}>
      {managementPage ? <AppManagementPanel key={`${appId}/${managementPage}`} app={app} page={managementPage} onLoadVersions={onLoadVersions} onRollback={onRollback} onDelete={onDelete} onRefresh={onRefresh} onBusyChange={setSettingsBusy}
          onOpenSettings={() => { if (uiEntry) onOpenApp?.(uiEntry.route); else if (app.connectorApp) setSettingsKind('connector'); else if (forms.length) { setFormId(forms[0].id); setSettingsKind('form'); } }} />
        : settingsKind === 'mcp' ? <div ref={setSettingsContainer} className="flex min-h-0 flex-1 flex-col" />
        : settingsKind === 'form' && formId ? <AppSettingsForm key={`${appId}/${app.currentVersion}/${formId}`} app={app} settingId={formId} onBusyChange={setSettingsBusy} onSaved={onRefresh} onClose={() => setSettingsKind(null)} />
        : <AppConnectorSettings app={app} panel onChanged={onRefresh} onAuthorize={onAuthorize} onBusyChange={setSettingsBusy} />}
    </AppDetailsSidePanel> : skill && <AppDetailsSidePanel id={sidePanelId} label="技能说明" title={`${skill.title} · SKILL.md`} icon={<BookOpen className="h-4 w-4" />} onClose={() => { request.current++; setSkill(null); }}>
      {skill.error ? <div role="alert" className="p-5 text-sm text-destructive">{skill.error}<Button variant="outline" size="sm" className="ml-2" onClick={() => { const item = skills.find(item => item.id === skill.id); if (item) void readSkill(item); }}>重试</Button></div> : skill.content === undefined ? <p role="status" className="p-5 text-sm text-muted-foreground">正在读取技能…</p> : <pre className="min-h-0 overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-xs leading-6">{skill.content}</pre>}
    </AppDetailsSidePanel>}

  </div>;
}
