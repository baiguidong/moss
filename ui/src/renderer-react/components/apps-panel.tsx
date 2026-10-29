"use client";

import { AppHubToolbar, type AppHubTab } from '@/components/app-hub-toolbar';
import { AppHubCard } from '@/components/app-hub-card';
import { AppBuiltinDetails } from '@/components/app-builtin-details';
import { useResourceDetail } from '@/lib/use-resource-detail';
export { AppAgentTools } from '@/components/app-capabilities';

import * as React from "react";
import { AppIcon } from "@/components/app-icon";
import { AppCategoryTabs } from '@/components/app-category-tabs';
import { filterApps, groupApps } from '@/lib/app-categories';
import { supportsHostFeature } from '@/lib/host-environment';
import {
  AlertCircle, Upload,
  KeyRound, RefreshCw,
  Settings2, SquareTerminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cleanIpcErrorMessage } from "@/lib/app-notifications";
import { AppMarketplacePanel } from "@/components/app-marketplace-panel";
import { AppInstallProgressView } from '@/components/app-install-progress';
import { isAppInstallActive, useAppInstallProgress } from '@/lib/app-install-progress';
import type { AppInstance, StoredApp, BuiltinApp } from "../types";

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  // Keep the hidden focus target inside the list's scrollable content.
  return (
    <label className={`relative inline-flex items-center gap-2 text-xs ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <input className="peer sr-only" type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="relative h-5 w-9 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-background after:shadow after:transition-transform peer-checked:after:translate-x-4" />
      <span>{label}</span>
    </label>
  );
}

function isMissingRequiredValue(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

function usesAppSettings(app: StoredApp) {
  return Boolean(app.hasSettings);
}

function missingRequiredConfiguration(app: StoredApp, instance: AppInstance) {
  const configuration = app.configuration;
  const missing: string[] = [];
  const collect = (schema: Record<string, any> | null | undefined, values: Record<string, any>, secret = false) => {
    const required = Array.isArray(schema?.required) ? schema.required : [];
    const properties = schema?.properties && typeof schema.properties === "object" ? schema.properties : {};
    for (const name of required) {
      const configured = secret ? instance.secretRefs?.[name]?.configured : !isMissingRequiredValue(values?.[name]);
      if (!configured) missing.push(properties[name]?.title || name);
    }
  };
  collect(configuration?.schema, instance.config || {});
  collect(configuration?.secrets, {}, true);
  return missing;
}

function requireInstanceConfiguration(app: StoredApp, instance: AppInstance) {
  const missing = missingRequiredConfiguration(app, instance);
  if (!missing.length) return;
  const location = usesAppSettings(app) ? "打开应用设置" : "打开应用管理";
  throw new Error(`请先${location}并保存必填项：${missing.join("、")}`);
}

export async function setAppEnabled(app: StoredApp, enabled: boolean) {
  const appId = app.id || app.name;
  const defaultInstance = app.backend
    ? app.instances?.[0]
    : null;
  // Keep the App's settings UI accessible while its Backend is waiting for configuration.
  if (enabled && defaultInstance && usesAppSettings(app) && missingRequiredConfiguration(app, defaultInstance).length) {
    return window.agentDesktop.setAppEnabled({ appId, enabled });
  }
  let enabledDefaultInstance = false;
  try {
    if (enabled && defaultInstance) requireInstanceConfiguration(app, defaultInstance);
    if (enabled && defaultInstance && !defaultInstance.enabled) {
      await window.agentDesktop.setAppInstanceEnabled({ appId, instanceId: defaultInstance.id, enabled: true });
      enabledDefaultInstance = true;
    }
    return await window.agentDesktop.setAppEnabled({ appId, enabled });
  } catch (error) {
    if (enabledDefaultInstance) {
      await window.agentDesktop.setAppInstanceEnabled({ appId, instanceId: defaultInstance!.id, enabled: false }).catch(() => {});
    }
    throw error;
  }
}

export function isAppEnabled(app: StoredApp) {
  if (!app.enabled || !app.backend) return Boolean(app.enabled);
  const defaultInstance = app.instances?.[0];
  if (defaultInstance && usesAppSettings(app) && missingRequiredConfiguration(app, defaultInstance).length) return true;
  return Boolean(defaultInstance?.enabled);
}

function fieldType(field: Record<string, any>) {
  const declared = Array.isArray(field.type) ? field.type.find((item: unknown) => item !== "null") : field.type;
  if (declared) return declared;
  if (Array.isArray(field.enum) && field.enum.length) return typeof field.enum[0];
  return "string";
}

function initialSchemaValue(schema: Record<string, any> | null | undefined, value: Record<string, any> = {}) {
  const next = { ...(value || {}) };
  const properties = schema?.properties && typeof schema.properties === "object" ? schema.properties : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  for (const [name, raw] of Object.entries(properties)) {
    if (next[name] !== undefined) continue;
    const field = raw as Record<string, any>;
    if (field.default !== undefined) next[name] = structuredClone(field.default);
    else if (required.has(name) && fieldType(field) === "boolean") next[name] = false;
  }
  return next;
}

function JsonValueEditor({ label, value, expectedType, required, onChange }: {
  label: string;
  value: unknown;
  expectedType: "array" | "object";
  required?: boolean;
  onChange: (value: unknown | undefined) => void;
}) {
  const [text, setText] = React.useState(() => value === undefined ? "" : JSON.stringify(value, null, 2));
  const [error, setError] = React.useState("");
  const update = (nextText: string) => {
    setText(nextText);
    if (!nextText.trim()) { setError(""); onChange(undefined); return; }
    try {
      const parsed = JSON.parse(nextText);
      if (expectedType === "array" ? !Array.isArray(parsed) : !parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(expectedType === "array" ? "必须是 JSON 数组" : "必须是 JSON 对象");
      }
      setError("");
      onChange(parsed);
    } catch (parseError) {
      setError(errorMessage(parseError));
    }
  };
  return (
    <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
      <span>{label}{required ? " *" : ""}</span>
      <Textarea className="min-h-24 resize-y font-mono text-xs" value={text} onChange={(event) => update(event.target.value)} />
      {error && <span className="text-destructive">{error}</span>}
    </label>
  );
}

function SchemaFields({ schema, value, secrets, configured, onChange }: {
  schema?: Record<string, any> | null;
  value: Record<string, any>;
  secrets?: boolean;
  configured?: Record<string, { configured?: boolean }>;
  onChange: (value: Record<string, any>) => void;
}) {
  const properties = schema?.properties && typeof schema.properties === "object" ? schema.properties : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  if (schema && Object.keys(properties).length === 0) {
    return <JsonValueEditor label={secrets ? "密钥 JSON" : "配置 JSON"} value={value} expectedType="object" onChange={(next) => onChange((next || {}) as Record<string, any>)} />;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Object.entries(properties).map(([name, raw]) => {
        const field = raw as Record<string, any>;
        const label = field.title || name;
        const type = fieldType(field);
        const isRequired = required.has(name);
        const setField = (nextValue: unknown | undefined) => {
          const next = { ...value };
          if (nextValue === undefined) delete next[name];
          else next[name] = nextValue;
          onChange(next);
        };
        if (type === "boolean") {
          return <Toggle key={name} checked={Boolean(value[name])} label={label} onChange={(checked) => onChange({ ...value, [name]: checked })} />;
        }
        if (type === "array" || type === "object") {
          return <JsonValueEditor key={name} label={label} value={value[name]} expectedType={type} required={isRequired} onChange={setField} />;
        }
        if (!secrets && Array.isArray(field.enum)) {
          const selected = field.enum.findIndex((item: unknown) => JSON.stringify(item) === JSON.stringify(value[name]));
          return (
            <label key={name} className="grid gap-1 text-xs text-muted-foreground">
              <span>{label}{isRequired ? " *" : ""}</span>
              <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={selected < 0 ? "" : String(selected)} onChange={(event) => setField(event.target.value === "" ? undefined : field.enum[Number(event.target.value)])}>
                <option value="">请选择</option>
                {field.enum.map((option: unknown, index: number) => <option key={JSON.stringify(option)} value={index}>{String(option)}</option>)}
              </select>
            </label>
          );
        }
        const isNumber = type === "number" || type === "integer";
        const placeholder = secrets && configured?.[name]?.configured ? "已配置" : undefined;
        if (!secrets && type === "string" && (field.format === "textarea" || Number(field.maxLength) > 200)) {
          return (
            <label key={name} className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
              <span>{label}{isRequired ? " *" : ""}</span>
              <Textarea value={value[name] ?? ""} onChange={(event) => setField(event.target.value || undefined)} />
            </label>
          );
        }
        return (
          <label key={name} className="grid gap-1 text-xs text-muted-foreground">
            <span>{label}{isRequired ? " *" : ""}</span>
            <Input
              type={secrets ? "password" : isNumber ? "number" : "text"}
              value={value[name] ?? ""}
              placeholder={placeholder}
              min={field.minimum}
              max={field.maximum}
              step={field.multipleOf || (type === "integer" ? 1 : "any")}
              onChange={(event) => setField(event.target.value === "" ? undefined : isNumber ? Number(event.target.value) : event.target.value)}
            />
          </label>
        );
      })}
    </div>
  );
}

export function statusLabel(state: string, app: StoredApp) {
  const instance = app.instances?.[0];
  if (state === "stopped" && app.backend?.lifecycle === "on-demand"
    && app.enabled && instance?.enabled && !app.runtimeStatus?.error
    && !missingRequiredConfiguration(app, instance).length) {
    return "按需运行";
  }
  return ({ running: "运行中", starting: "启动中", stopping: "停止中", stopped: "已停止", error: "错误", "crash-loop": "反复崩溃" } as Record<string, string>)[state] || state;
}

function errorMessage(error: unknown) {
  return cleanIpcErrorMessage(error);
}

export function AppRuntimeControls({ app, instance, onChanged, onOpenSettings, onBusyChange }: {
  app: StoredApp;
  instance: AppInstance;
  onChanged: () => Promise<unknown>;
  onOpenSettings?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const appId = app.id || app.name;
  const configuration = app.configuration;
  const appSettings = usesAppSettings(app);
  const hasConfiguration = Boolean(configuration?.schema || configuration?.secrets);
  const [logsOpen, setLogsOpen] = React.useState(false);
  const [logs, setLogs] = React.useState<any[]>([]);
  const [config, setConfig] = React.useState<Record<string, any>>(() => initialSchemaValue(configuration?.schema, instance.config || {}));
  const [secrets, setSecrets] = React.useState<Record<string, any>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const runtimeError = instance.status?.lastError || app.runtimeStatus?.error || "";
  React.useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  React.useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try { await operation(); await onChanged(); }
    catch (operationError) { setError(errorMessage(operationError)); }
    finally { setBusy(false); }
  };
  const openLogs = async () => {
    const next = !logsOpen;
    setLogsOpen(next);
    if (next) {
      try { setLogs(await window.agentDesktop.getAppInstanceLogs({ appId, instanceId: instance.id, limit: 300 })); }
      catch (operationError) { setError(errorMessage(operationError)); }
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-xs font-medium">运行管理</span>
        {appSettings && onOpenSettings && <Button variant="outline" size="sm" className="h-8" disabled={busy || !app.enabled} title={app.enabled ? "打开应用设置" : "请先启用 App"} onClick={onOpenSettings}><Settings2 className="h-4 w-4" />打开设置</Button>}
        <Button variant="ghost" size="icon" className="h-8 w-8" title="重启" disabled={busy || !instance.enabled || !app.enabled} onClick={() => run(() => window.agentDesktop.restartAppInstance({ appId, instanceId: instance.id }))}><RefreshCw className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="日志" onClick={openLogs}><SquareTerminal className="h-4 w-4" /></Button>
      </div>
      {!appSettings && hasConfiguration && (
        <div className="grid gap-3">
          <SchemaFields schema={configuration?.schema} value={config} onChange={setConfig} />
          <SchemaFields schema={configuration?.secrets} value={secrets} secrets configured={instance.secretRefs} onChange={setSecrets} />
          <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => run(() => window.agentDesktop.updateAppInstance({ appId, instanceId: instance.id, config, ...(Object.keys(secrets).length ? { secrets } : {}) }))}><Settings2 className="h-4 w-4" />保存配置</Button>
            {Object.values(instance.secretRefs || {}).some((item) => item.configured) && <Button size="icon" variant="outline" className="h-8 w-8" title="清除密钥" disabled={busy || (app.enabled && instance.enabled)} onClick={() => { if (window.confirm("清除这个 App 的全部密钥？")) void run(() => window.agentDesktop.clearAppInstanceCredentials({ appId, instanceId: instance.id })); }}><KeyRound className="h-4 w-4" /></Button>}
          </div>
        </div>
      )}
      {error && <div className="flex items-start gap-1.5 text-xs text-destructive"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
      {!error && runtimeError && <div className="flex items-start gap-1.5 text-xs text-destructive"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{runtimeError}</div>}
      {logsOpen && (
        <div className="max-h-52 overflow-auto rounded-md bg-zinc-950 p-3 font-mono text-[11px] text-zinc-200">
          {logs.length ? logs.map((entry, index) => <div key={`${entry.timestamp}-${index}`}><span className="text-zinc-500">{new Date(entry.timestamp).toLocaleTimeString()}</span> {entry.level} {entry.message}</div>) : <div className="text-zinc-500">暂无日志</div>}
        </div>
      )}
    </div>
  );
}


export function AppsPanel({ apps, loading, onLaunch, onRefresh, initialTab = 'marketplace', onTabChange }: {
  initialTab?: AppHubTab;
  onTabChange?: (tab: AppHubTab) => void;
  apps: StoredApp[];
  loading?: boolean;
  onLaunch: (name: string) => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [builtins, setBuiltins] = React.useState<BuiltinApp[]>([]);
  const [builtinsOpen, setBuiltinsOpen] = React.useState(false);
  const [builtinsError, setBuiltinsError] = React.useState('');
  React.useEffect(() => { let active = true; void window.agentDesktop.listBuiltinApps?.().then(items => { if (active) { setBuiltins(items); setBuiltinsError(''); } }).catch(error => { if (active) setBuiltinsError(String(error)); }); return () => { active = false; }; }, [apps]);
  const [tab, setTab] = React.useState<AppHubTab>(initialTab);
  const changeTab = (value: AppHubTab) => { setTab(value); setBuiltinsOpen(false); onTabChange?.(value); };
  const [category, setCategory] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const { detail: builtinId, open: openBuiltin, close: closeBuiltin } = useResourceDetail<string>();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const { progress: archiveProgress, clearProgress: clearArchiveProgress } = useAppInstallProgress('local');
  const installedById = new Map(apps.map(app => [app.id || app.name, app]));
  const builtinCatalog = builtins.map(item => {
    const app = installedById.get(item.id);
    return { ...app, id: item.id, name: app?.name || item.id, displayName: app?.displayName || item.displayName, description: app?.description || item.description, builtin: true };
  });
  const searchedApps = filterApps(builtinsOpen ? builtinCatalog : apps, query);
  const matchedApps = filterApps(searchedApps, '', category);
  const visibleApps = groupApps(matchedApps).flatMap(group => group.apps);
  const selectedBuiltin = builtins.find(item => item.id === builtinId);
  const openApp = (id: string, name: string) => {
    const builtin = builtinsOpen && builtins.find(item => item.id === id);
    if (builtin && !builtin.installed && !installedById.has(id)) openBuiltin(id);
    else onLaunch(name);
  };

  const run = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try { await operation(); await onRefresh(); }
    catch (operationError) { setError(errorMessage(operationError)); }
    finally { setBusy(null); }
  };

  const installArchive = async () => {
    clearArchiveProgress('local');
    await run('install', async () => {
      const result = await window.agentDesktop.installAppArchive();
      if (!result.ok && !result.canceled) throw new Error(result.error || 'App 安装失败');
    });
  };

  if (tab === 'marketplace') {
    return <AppMarketplacePanel installedApps={apps} onBack={() => changeTab('installed')} onInstalled={onRefresh} hub />;
  }

  return (
    <>
    <div className={`${selectedBuiltin ? 'hidden' : 'flex'} h-full min-h-0 flex-col bg-background`}>
      <AppHubToolbar tab="installed" installedCount={apps.length} onChangeTab={changeTab} query={query} onQuery={setQuery} searchPlaceholder={builtinsOpen ? '搜索内置应用' : undefined}
        busy={busy === 'install'} actions={<>
          {builtins.length > 0 && <Button size="sm" variant={builtinsOpen ? 'secondary' : 'outline'} aria-pressed={builtinsOpen} className="h-8 rounded-lg px-3 text-xs" onClick={() => { setBuiltinsOpen(value => !value); setCategory('all'); }}>内置应用</Button>}
          <Button size="sm" variant="outline" className="h-8 rounded-lg px-3 text-xs" title="本地安装 ZIP" aria-label="本地安装 ZIP" disabled={busy === 'install' || isAppInstallActive(archiveProgress.local) || !supportsHostFeature('appInstallation')} onClick={() => void installArchive()}><Upload className="h-4 w-4" />{busy === 'install' ? '安装中…' : '添加应用'}</Button>
          <Button size="icon-sm" variant="outline" className="h-8 w-8 rounded-lg" title="刷新" aria-label="刷新" disabled={loading || busy === 'refresh'} onClick={() => void run('refresh', async () => {})}><RefreshCw className={`h-4 w-4 ${loading || busy === 'refresh' ? 'animate-spin' : ''}`} /></Button>
        </>} />
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1180px] px-4 py-2.5 sm:px-5">
        {builtinsError && <p role="alert" className="py-3 text-sm text-destructive">内置应用列表加载失败：{builtinsError}</p>}
        {archiveProgress.local && <div className="mb-3"><AppInstallProgressView progress={archiveProgress.local} /></div>}
        <AppCategoryTabs apps={searchedApps} value={category} onChange={setCategory} panelId="installed-apps" />
        {error && <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        <div role="tabpanel" id="installed-apps" aria-labelledby={`installed-apps-${category}`} className="mt-3">
        {loading ? <div role="status" className="flex h-44 items-center justify-center text-sm text-muted-foreground">正在加载 Apps…</div> : visibleApps.length === 0 ? (
          <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">{apps.length || builtinsOpen ? '没有匹配的 App，可切换到全部或调整筛选' : '暂无 App，请从应用市场安装'}</div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
            {visibleApps.map(app => <AppHubCard key={app.id || app.name} id={app.id || app.name} category={app.category}
              title={app.displayName || app.title || app.name} description={app.description}
              publisher={app.publisher?.name || app.trust?.publisher?.name || (app.builtin ? 'Moss' : '本地应用')}
              icon={<AppIcon icon={app.icon} className="h-9 w-9 shrink-0 rounded-lg" />} onOpen={() => openApp(app.id || app.name, app.name)} />)}
          </div>
        )}
        </div>
      </div>
      </div>
    </div>
    {selectedBuiltin && <AppBuiltinDetails key={selectedBuiltin.id} app={selectedBuiltin} installed={selectedBuiltin.installed || installedById.has(selectedBuiltin.id)} onBack={closeBuiltin}
      onOpen={() => onLaunch(installedById.get(selectedBuiltin.id)?.name || selectedBuiltin.id)}
      onRestore={async () => {
        const result = await window.agentDesktop.restoreBuiltinApp({ id: selectedBuiltin.id });
        if (!result.ok) throw new Error(result.error || '恢复失败');
        await onRefresh();
        setBuiltins(await window.agentDesktop.listBuiltinApps());
      }} />}
    </>
  );
}
