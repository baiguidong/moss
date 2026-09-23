"use client";

import * as React from "react";
import {
  AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, Download,
  LoaderCircle, PackageCheck, RefreshCw, Search, ShieldCheck, Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cleanIpcErrorMessage } from "@/lib/app-notifications";
import type {
  AppMarketplaceCatalog,
  AppMarketplaceDetail,
  AppMarketplaceEntry,
  StoredApp,
} from "../types";

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function MarketplaceIcon({ entry }: { entry: AppMarketplaceEntry }) {
  if (!entry.iconUrl) {
    return <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Store className="h-6 w-6" /></div>;
  }
  return <img className="h-12 w-12 shrink-0 rounded-xl object-cover" src={entry.iconUrl} alt="" />;
}

export function AppMarketplacePanel({ installedApps, onBack, onInstalled }: {
  installedApps: StoredApp[];
  onBack: () => void;
  onInstalled: () => Promise<unknown>;
}) {
  const [catalog, setCatalog] = React.useState<AppMarketplaceCatalog | null>(null);
  const [details, setDetails] = React.useState<Record<string, AppMarketplaceDetail>>({});
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [selectedVersions, setSelectedVersions] = React.useState<Record<string, string>>({});
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [busyAppId, setBusyAppId] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");

  const loadCatalog = React.useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError("");
    try {
      setCatalog(await window.agentDesktop.appMarketplace.list({ forceRefresh }));
    } catch (loadError) {
      setError(cleanIpcErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const toggleDetails = async (entry: AppMarketplaceEntry) => {
    if (expandedId === entry.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(entry.id);
    if (details[entry.id]) return;
    try {
      const detail = await window.agentDesktop.appMarketplace.getDetails({ appId: entry.id });
      setDetails((current) => ({ ...current, [entry.id]: detail }));
      setSelectedVersions((current) => ({ ...current, [entry.id]: current[entry.id] || detail.latestVersion }));
    } catch (detailError) {
      setError(cleanIpcErrorMessage(detailError));
    }
  };

  const install = async (entry: AppMarketplaceEntry) => {
    const version = selectedVersions[entry.id] || details[entry.id]?.latestVersion || entry.latestVersion;
    setBusyAppId(entry.id);
    setError("");
    try {
      let result = await window.agentDesktop.appMarketplace.install({ appId: entry.id, version });
      if (result.requiresPermissionApproval) {
        const permissions = result.permissions || [];
        const accepted = window.confirm([
          `“${entry.displayName}”需要以下权限：`,
          "",
          ...permissions.map((permission) => `• ${permission}`),
          "",
          "是否继续安装并授权？",
        ].join("\n"));
        if (!accepted) return;
        result = await window.agentDesktop.appMarketplace.install({ appId: entry.id, version, acceptPermissions: true });
      }
      if (!result.ok) throw new Error("App 安装未完成");
      await onInstalled();
      await loadCatalog(true);
    } catch (installError) {
      setError(cleanIpcErrorMessage(installError));
    } finally {
      setBusyAppId(null);
    }
  };

  const installedById = React.useMemo(() => new Map(installedApps.map((app) => [app.id || app.name, app])), [installedApps]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleApps = (catalog?.apps || []).filter((entry) => {
    if (!normalizedQuery) return true;
    return [entry.displayName, entry.summary, entry.id, ...entry.categories]
      .some((value) => String(value || "").toLocaleLowerCase().includes(normalizedQuery));
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        <Button variant="ghost" size="icon" className="h-8 w-8" title="返回已安装 App" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">应用市场</h1>
          <div className="text-xs text-muted-foreground">{catalog ? `${catalog.apps.length} 个可用 App · Host API ${catalog.hostApiVersion}` : "发现和更新 Moss App"}</div>
        </div>
        <div className="relative w-56 max-w-full">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 pl-8 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 App" />
        </div>
        <Button size="sm" variant="outline" className="h-8" disabled={loading} onClick={() => void loadCatalog(true)}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />刷新
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {catalog?.warning && <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{catalog.warning}</div>}
        {error && <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        {loading && !catalog ? (
          <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />正在加载应用市场…</div>
        ) : visibleApps.length === 0 ? (
          <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">{query ? "没有匹配的 App" : "应用市场暂无 App"}</div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            {visibleApps.map((entry) => {
              const detail = details[entry.id];
              const expanded = expandedId === entry.id;
              const installed = installedById.get(entry.id);
              const installedUnavailable = installed?.packageStatus === "incompatible" || installed?.packageStatus === "invalid";
              const selectedVersion = selectedVersions[entry.id] || entry.latestVersion;
              const selectedRelease = detail?.versions.find((version) => version.version === selectedVersion) || entry.latest;
              const busy = busyAppId === entry.id;
              const compatible = Boolean(
                (selectedRelease.platformCompatible ?? entry.platformCompatible)
                && (selectedRelease.hostCompatible ?? entry.hostCompatible),
              );
              const sameVersion = installed?.currentVersion === selectedVersion;
              const actionLabel = busy
                ? "处理中"
                : !installed
                  ? "安装"
                  : sameVersion
                    ? "已安装"
                    : selectedVersion === entry.latestVersion && entry.updateAvailable
                      ? "更新"
                      : "安装此版本";
              return (
                <section key={entry.id} className={`rounded-lg border bg-card p-4 ${entry.featured ? "border-primary/30" : "border-border"}`}>
                  <div className="flex items-start gap-3">
                    <MarketplaceIcon entry={entry} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-semibold">{entry.displayName}</h2>
                        {entry.featured && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">推荐</span>}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.summary}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                        <span>v{entry.latestVersion}</span>
                        {entry.publisher?.name && <span>· {entry.publisher.name}</span>}
                        {entry.categories.map((category) => <span key={category} className="rounded bg-muted px-1.5 py-0.5">{category}</span>)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button size="sm" className="h-8" disabled={busy || sameVersion || !compatible} onClick={() => void install(entry)}>
                      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : sameVersion ? <PackageCheck className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                      {actionLabel}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => void toggleDetails(entry)}>
                      {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}详情
                    </Button>
                    {!compatible && <span className="text-xs text-destructive">当前系统或 Moss 版本不兼容</span>}
                    {installed?.currentVersion && <span className={`ml-auto flex items-center gap-1 text-[11px] ${installedUnavailable ? "text-destructive" : "text-emerald-600"}`}><CheckCircle2 className="h-3.5 w-3.5" />已安装 {installed.currentVersion}{installedUnavailable ? " · 当前版本不可用" : ""}</span>}
                  </div>
                  {expanded && (
                    <div className="mt-4 border-t border-border pt-3 text-xs">
                      {!detail ? (
                        <div className="flex items-center gap-2 text-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />正在读取详情…</div>
                      ) : (
                        <div className="grid gap-3">
                          <p className="whitespace-pre-wrap leading-5 text-muted-foreground">{detail.description || detail.summary}</p>
                          <label className="grid max-w-xs gap-1 text-muted-foreground">
                            <span>可用版本</span>
                            <select className="h-8 rounded-md border border-input bg-background px-2" value={selectedVersion} onChange={(event) => setSelectedVersions((current) => ({ ...current, [entry.id]: event.target.value }))}>
                              {detail.versions.map((version) => <option key={version.version} value={version.version}>{version.version}</option>)}
                            </select>
                          </label>
                          {selectedRelease.releaseNotes && <div><div className="mb-1 font-medium">更新说明</div><p className="whitespace-pre-wrap leading-5 text-muted-foreground">{selectedRelease.releaseNotes}</p></div>}
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                            <span>{formatBytes(selectedRelease.artifact.size)}</span>
                            <span>Host API {selectedRelease.hostApi}</span>
                            <span>{selectedRelease.artifact.signed ? "已签名" : "未签名"}</span>
                          </div>
                          {selectedRelease.permissions.length > 0 && (
                            <div><div className="mb-1 flex items-center gap-1 font-medium"><ShieldCheck className="h-3.5 w-3.5" />所需权限</div><div className="flex flex-wrap gap-1">{selectedRelease.permissions.map((permission) => <code key={permission} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{permission}</code>)}</div></div>
                          )}
                        </div>
                      )}
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
