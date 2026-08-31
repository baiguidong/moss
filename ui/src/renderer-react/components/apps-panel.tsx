"use client";

import * as React from "react";
import DOMPurify from "dompurify";
import {
  Activity, AlertCircle, ArrowLeftRight, ChevronDown, ChevronRight, Download, ExternalLink, History,
  KeyRound, MonitorPlay, PanelLeft, PanelLeftClose, Pencil, Plus, RefreshCw, RotateCcw,
  Settings2, ShieldCheck, SquareTerminal, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AppInstance, AppVersion, StoredApp } from "../types";

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function AppIcon({ icon }: { icon: string }) {
  if (!icon?.startsWith("data:image/")) {
    return <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary"><MonitorPlay className="h-5 w-5" /></div>;
  }
  if (icon.startsWith("data:image/svg+xml")) {
    const [metadata, payload = ""] = icon.split(",", 2);
    const rawSvg = metadata.includes(";base64") ? atob(payload) : decodeURIComponent(payload);
    const svg = DOMPurify.sanitize(rawSvg, { USE_PROFILES: { svg: true, svgFilters: true } });
    return <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md" dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  return <img className="h-10 w-10 shrink-0 rounded-md object-cover" src={icon} alt="" />;
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className={`inline-flex items-center gap-2 text-xs ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <input className="peer sr-only" type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="relative h-5 w-9 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-background after:shadow after:transition-transform peer-checked:after:translate-x-4" />
      <span>{label}</span>
    </label>
  );
}

function backendForTarget(app: StoredApp, target: "desktop" | "server") {
  if (target === "server") return app.remoteInstalled ? app.serverBackend || null : app.backend || null;
  return app.remoteOnly ? null : app.backend || null;
}

function configurationForTarget(app: StoredApp, target: "desktop" | "server") {
  return target === "server"
    ? app.remoteInstalled ? app.serverConfiguration || null : app.configuration
    : app.configuration;
}

function availableInstanceTargets(app: StoredApp): Array<"desktop" | "server"> {
  const targets: Array<"desktop" | "server"> = [];
  const desktop = backendForTarget(app, "desktop");
  const server = backendForTarget(app, "server");
  if (desktop?.instanceMode === "multiple" && desktop.targets.includes("desktop")) targets.push("desktop");
  if (server?.instanceMode === "multiple" && server.targets.includes("server")) targets.push("server");
  return targets;
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

function statusLabel(state?: string) {
  return ({ running: "运行中", starting: "启动中", stopping: "停止中", stopped: "已停止", error: "错误", "crash-loop": "反复崩溃" } as Record<string, string>)[state || "stopped"] || state;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "操作失败");
}

function AppInstanceRow({ app, instance, onChanged }: { app: StoredApp; instance: AppInstance; onChanged: () => Promise<unknown> }) {
  const appId = app.id || app.name;
  const target = instance.target || "desktop";
  const backend = backendForTarget(app, target);
  const configuration = configurationForTarget(app, target);
  const [expanded, setExpanded] = React.useState(false);
  const [logsOpen, setLogsOpen] = React.useState(false);
  const [logs, setLogs] = React.useState<any[]>([]);
  const [displayName, setDisplayName] = React.useState(instance.displayName);
  const [config, setConfig] = React.useState<Record<string, any>>(() => initialSchemaValue(configuration?.schema, instance.config || {}));
  const [secrets, setSecrets] = React.useState<Record<string, any>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const scopedDeployment = app.deployments?.find((item) => item.deployment.instanceId === instance.id && item.deployment.targetType === target);
  const state = scopedDeployment?.runtime.state || "stopped";
  const runtimeError = scopedDeployment?.runtime.lastError || "";

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
      try { setLogs(await window.agentDesktop.getAppInstanceLogs({ appId, instanceId: instance.id, limit: 300, target })); }
      catch (operationError) { setError(errorMessage(operationError)); }
    }
  };

  return (
    <div className="border-t border-border/70 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="h-7 w-7" title="配置实例" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
        <div className="min-w-[140px] flex-1">
          <div className="truncate text-sm font-medium">{instance.displayName}</div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Activity className="h-3 w-3" />{target === "server" ? "Server" : "Desktop"} · {statusLabel(state)}</div>
        </div>
        <Toggle checked={instance.enabled} disabled={busy} label={instance.enabled ? "已启用" : "已停用"} onChange={(enabled) => run(() => window.agentDesktop.setAppInstanceEnabled({ appId, instanceId: instance.id, enabled, target }))} />
        <Button variant="ghost" size="icon" className="h-8 w-8" title="重启" disabled={busy || !instance.enabled || (target === "server" ? !app.serverEnabled : !app.enabled)} onClick={() => run(() => window.agentDesktop.restartAppInstance({ appId, instanceId: instance.id, target }))}><RefreshCw className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="日志" onClick={openLogs}><SquareTerminal className="h-4 w-4" /></Button>
        {backend?.targets.includes(target === "server" ? "desktop" : "server") && !app.remoteOnly && (
          <Button variant="ghost" size="icon" className="h-8 w-8" title={`移动到 ${target === "server" ? "Desktop" : "Server"}`} disabled={busy} onClick={() => {
            if (!window.confirm(`停止当前实例并移动到 ${target === "server" ? "Desktop" : "Server"}？`)) return;
            const deleteSourceCredentials = window.confirm("目标健康后删除来源密钥？");
            void run(() => window.agentDesktop.moveAppInstance({ appId, instanceId: instance.id, from: target, to: target === "server" ? "desktop" : "server", secrets, deleteSourceCredentials }));
          }}><ArrowLeftRight className="h-4 w-4" /></Button>
        )}
        {backend?.instanceMode === "multiple" && (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="删除实例" disabled={busy} onClick={() => {
            if (!window.confirm(`删除实例“${instance.displayName}”？`)) return;
            const deleteData = window.confirm("同时删除这个实例的数据？");
            const deleteCredentials = window.confirm("同时删除这个实例的密钥？");
            void run(() => window.agentDesktop.removeAppInstance({ appId, instanceId: instance.id, deleteData, deleteCredentials, target }));
          }}><Trash2 className="h-4 w-4" /></Button>
        )}
      </div>
      {expanded && (
        <div className="ml-10 mt-3 grid gap-3 border-l border-border pl-4">
          <label className="grid max-w-sm gap-1 text-xs text-muted-foreground"><span>实例名称</span><Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <SchemaFields schema={configuration?.schema} value={config} onChange={setConfig} />
          <SchemaFields schema={configuration?.secrets} value={secrets} secrets configured={instance.secretRefs} onChange={setSecrets} />
          <div className="flex gap-2"><Button size="sm" disabled={busy || !displayName.trim()} onClick={() => run(() => window.agentDesktop.updateAppInstance({ appId, instanceId: instance.id, displayName, config, target, ...(Object.keys(secrets).length ? { secrets } : {}) }))}><Settings2 className="h-4 w-4" />保存配置</Button>
            {Object.values(instance.secretRefs || {}).some((item) => item.configured) && <Button size="icon" variant="outline" className="h-8 w-8" title="清除密钥" disabled={busy || instance.enabled} onClick={() => { if (window.confirm("清除这个实例的全部密钥？")) void run(() => window.agentDesktop.clearAppInstanceCredentials({ appId, instanceId: instance.id, target })); }}><KeyRound className="h-4 w-4" /></Button>}
          </div>
        </div>
      )}
      {error && <div className="ml-10 mt-2 flex items-start gap-1.5 text-xs text-destructive"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
      {!error && runtimeError && <div className="ml-10 mt-2 flex items-start gap-1.5 text-xs text-destructive"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{runtimeError}</div>}
      {logsOpen && (
        <div className="ml-10 mt-3 max-h-52 overflow-auto rounded-md bg-zinc-950 p-3 font-mono text-[11px] text-zinc-200">
          {logs.length ? logs.map((entry, index) => <div key={`${entry.timestamp}-${index}`}><span className="text-zinc-500">{new Date(entry.timestamp).toLocaleTimeString()}</span> {entry.level} {entry.message}</div>) : <div className="text-zinc-500">暂无日志</div>}
        </div>
      )}
    </div>
  );
}

function NewInstanceForm({ app, onClose, onChanged }: { app: StoredApp; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const appId = app.id || app.name;
  const targets = availableInstanceTargets(app);
  const [target, setTarget] = React.useState<"desktop" | "server">(targets[0] || "desktop");
  const configuration = configurationForTarget(app, target);
  const [name, setName] = React.useState("");
  const [config, setConfig] = React.useState<Record<string, any>>(() => initialSchemaValue(configuration?.schema));
  const [secrets, setSecrets] = React.useState<Record<string, any>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    setConfig(initialSchemaValue(configuration?.schema));
    setSecrets({});
  }, [target]);
  if (!targets.length) return null;
  return (
    <div className="mt-3 grid gap-3 border-l-2 border-primary/40 pl-4">
      <div className="flex items-center justify-between"><span className="text-sm font-medium">新建实例</span><Button variant="ghost" size="icon" className="h-7 w-7" title="关闭" onClick={onClose}><X className="h-4 w-4" /></Button></div>
      <label className="grid max-w-sm gap-1 text-xs text-muted-foreground"><span>实例名称</span><Input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <SchemaFields key={`${target}:config`} schema={configuration?.schema} value={config} onChange={setConfig} />
      <SchemaFields key={`${target}:secrets`} schema={configuration?.secrets} value={secrets} secrets onChange={setSecrets} />
      {targets.length > 1 && (
        <label className="grid max-w-xs gap-1 text-xs text-muted-foreground"><span>运行位置</span><select className="h-9 rounded-md border border-input bg-background px-3" value={target} onChange={(event) => setTarget(event.target.value as "desktop" | "server")}>{targets.map((item) => <option key={item} value={item}>{item === "desktop" ? "Desktop" : "Server"}</option>)}</select></label>
      )}
      {error && <div className="flex items-start gap-1.5 text-xs text-destructive"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
      <div><Button size="sm" disabled={busy || !name.trim()} onClick={async () => {
        setBusy(true); setError("");
        try {
          if (target === "server" && !app.remoteInstalled && app.currentVersion) await window.agentDesktop.installAppOnServer({ appId, version: app.currentVersion });
          await window.agentDesktop.createAppInstance({ appId, displayName: name, config, secrets, enabled: true, target });
          await onChanged(); onClose();
        } catch (operationError) { setError(errorMessage(operationError)); }
        finally { setBusy(false); }
      }}><Plus className="h-4 w-4" />创建实例</Button></div>
    </div>
  );
}

export function AppsPanel({ apps, versionsByApp, onLaunch, onDelete, onIterate, onLoadVersions, onRollback, onRefresh, sidebarShortcutIds, onAddShortcut, onRemoveShortcut }: {
  apps: StoredApp[];
  versionsByApp: Record<string, AppVersion[]>;
  onLaunch: (name: string) => void;
  onDelete: (name: string, options?: { deleteData?: boolean; deleteCredentials?: boolean }) => void;
  onIterate: (name: string) => void;
  onLoadVersions: (name: string) => void;
  onRollback: (name: string, versionId: string) => void;
  onRefresh: () => Promise<unknown>;
  sidebarShortcutIds?: Set<string>;
  onAddShortcut?: (name: string) => void;
  onRemoveShortcut?: (name: string) => void;
}) {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = React.useState<string | null>(null);
  const [addingInstance, setAddingInstance] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");

  const run = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try { await operation(); await onRefresh(); }
    catch (operationError) { setError(errorMessage(operationError)); }
    finally { setBusy(null); }
  };

  const install = async () => {
    await run("install", async () => {
      const result = await window.agentDesktop.installAppArchive();
      if (!result.ok && !result.canceled) throw new Error(result.error || "App 安装失败");
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div><h1 className="text-lg font-semibold">Apps</h1><div className="text-xs text-muted-foreground">{apps.length} 个已安装 App</div></div>
        <Button size="sm" disabled={busy === "install"} onClick={install}><Download className="h-4 w-4" />安装 App</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {error && <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        {apps.length === 0 ? (
          <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">暂无 App</div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {apps.map((app) => {
              const appId = app.id || app.name;
              const isExpanded = expanded === appId;
              const state = app.runtimeStatus?.state || "stopped";
              const hasShortcut = sidebarShortcutIds?.has(appId) ?? false;
              const desktopBackend = backendForTarget(app, "desktop");
              const serverBackend = app.remoteInstalled ? backendForTarget(app, "server") : null;
              const instanceTargets = availableInstanceTargets(app);
              return (
                <section key={appId} className="min-w-0 rounded-md border border-border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <AppIcon icon={app.icon} />
                    <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{app.displayName || app.title || app.name}</h2><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{app.description || "未填写描述"}</p></div>
                    <div className="grid justify-items-end gap-2">
                      {desktopBackend && <Toggle checked={Boolean(app.enabled)} disabled={busy === appId} label={`Desktop ${app.enabled ? "已启用" : "已停用"}`} onChange={(enabled) => void run(appId, () => window.agentDesktop.setAppEnabled({ appId, enabled, target: "desktop" }))} />}
                      {serverBackend && <Toggle checked={Boolean(app.serverEnabled)} disabled={busy === appId} label={`Server ${app.serverEnabled ? "已启用" : "已停用"}`} onChange={(enabled) => void run(appId, () => window.agentDesktop.setAppEnabled({ appId, enabled, target: "server" }))} />}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span>v{app.currentVersion || "-"}</span>
                    {app.remoteInstalled && app.serverVersion !== app.currentVersion && <span>Server v{app.serverVersion || "-"}</span>}
                    <span>{app.hasUi ? "UI" : "无 UI"}</span>
                    <span>{app.hasBackend ? `${(desktopBackend || serverBackend)?.lifecycle === "persistent" ? "常驻" : "按需"} Backend` : "无 Backend"}</span>
                    {app.hasBackend && <span className={state === "error" || state === "crash-loop" ? "text-destructive" : state === "running" ? "text-emerald-600" : ""}>{statusLabel(state)}</span>}
                    <span>{formatTimestamp(app.updatedAt)}</span>
                  </div>
                  {app.runtimeStatus?.error && <div className="mt-2 text-xs text-destructive">{app.runtimeStatus.error}</div>}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {app.hasUi && <Button size="sm" className="h-8" onClick={() => onLaunch(app.name)}><ExternalLink className="h-4 w-4" />打开</Button>}
                    {desktopBackend?.targets.includes("server") && !app.remoteInstalled && app.currentVersion && <Button size="sm" variant="outline" className="h-8" disabled={busy === appId} onClick={() => void run(appId, () => window.agentDesktop.installAppOnServer({ appId, version: app.currentVersion! }))}><Download className="h-4 w-4" />部署到 Server</Button>}
                    <Button size="sm" variant="outline" className="h-8" onClick={() => setExpanded(isExpanded ? null : appId)}><Settings2 className="h-4 w-4" />管理</Button>
                    {!app.remoteOnly && <Button size="sm" variant="outline" className="h-8" onClick={() => onIterate(app.name)}><Pencil className="h-4 w-4" />迭代</Button>}
                    {!app.remoteOnly && <Button variant="ghost" size="icon" className="h-8 w-8" title="版本" onClick={() => { const open = versionsOpen === appId ? null : appId; setVersionsOpen(open); if (open) onLoadVersions(app.name); }}><History className="h-4 w-4" /></Button>}
                    <Button variant="ghost" size="icon" className="h-8 w-8" title={hasShortcut ? "移出侧栏" : "加入侧栏"} disabled={!app.hasUi} onClick={() => hasShortcut ? onRemoveShortcut?.(app.name) : onAddShortcut?.(app.name)}>{hasShortcut ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}</Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="卸载" onClick={() => {
                      if (!window.confirm(`卸载“${app.displayName || app.name}”？`)) return;
                      const deleteData = window.confirm("同时删除 App 数据？");
                      const deleteCredentials = window.confirm("同时删除 App 密钥？");
                      if (app.remoteOnly) void run(appId, () => window.agentDesktop.uninstallAppOnServer({ appId, deleteData, deleteCredentials }));
                      else onDelete(app.name, { deleteData, deleteCredentials });
                    }}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  {isExpanded && (
                    <div className="mt-4 border-t border-border pt-3">
                      <div className="flex items-center justify-between"><div className="text-xs font-medium">Backend 实例</div>{instanceTargets.length > 0 && <Button size="sm" variant="outline" className="h-7" onClick={() => setAddingInstance(addingInstance === appId ? null : appId)}><Plus className="h-3.5 w-3.5" />实例</Button>}</div>
                      {!app.hasBackend ? <div className="py-3 text-xs text-muted-foreground">UI-only App</div> : (app.instances || []).map((instance) => <AppInstanceRow key={`${instance.target || "desktop"}:${instance.id}`} app={app} instance={instance} onChanged={onRefresh} />)}
                      {addingInstance === appId && <NewInstanceForm app={app} onClose={() => setAddingInstance(null)} onChanged={onRefresh} />}
                      {app.remoteInstalled && !app.remoteOnly && <div className="mt-3"><Button size="sm" variant="outline" className="h-7 text-destructive" onClick={() => {
                        if (!window.confirm("卸载 Server 上的这个 App？")) return;
                        const deleteData = window.confirm("同时删除 Server App 数据？");
                        const deleteCredentials = window.confirm("同时删除 Server App 密钥？");
                        void run(appId, () => window.agentDesktop.uninstallAppOnServer({ appId, deleteData, deleteCredentials }));
                      }}><Trash2 className="h-3.5 w-3.5" />卸载 Server App</Button></div>}
                      {app.remoteError && <div className="mt-3 text-xs text-destructive">{app.remoteError}</div>}
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />{(app.permissions || []).length ? app.permissions?.join(" · ") : "无额外权限"}</div>
                    </div>
                  )}
                  {versionsOpen === appId && (
                    <div className="mt-4 border-t border-border pt-3">
                      {(versionsByApp[app.name] || []).map((version) => (
                        <div key={version.id} className="flex items-center justify-between border-b border-border/60 py-2 last:border-b-0"><div><div className="text-xs font-medium">{version.version}{version.isCurrent ? " · 当前" : ""}</div><div className="text-[11px] text-muted-foreground">{formatTimestamp(version.createdAt)} · {version.reason}</div></div><Button size="sm" variant="ghost" disabled={version.isCurrent} onClick={() => onRollback(app.name, version.id)}><RotateCcw className="h-3.5 w-3.5" />回滚</Button></div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
