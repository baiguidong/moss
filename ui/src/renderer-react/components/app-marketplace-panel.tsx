"use client";

import { AppDiscoveryFilter } from '@/components/app-discovery-filter';
import { useAppDiscoveryPreferences } from '@/lib/app-discovery';
import { supportsHostFeature } from '@/lib/host-environment';

import * as React from "react";
import { AppCategoryTabs } from '@/components/app-category-tabs';
import { filterApps, groupApps } from '@/lib/app-categories';
import {
  AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, Download,
  LoaderCircle, PackageCheck, RefreshCw, ShieldCheck, Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cleanIpcErrorMessage } from "@/lib/app-notifications";
import { describeAppPermission, formatAppPermission } from '../../shared/app-capability-descriptions.mjs';
import { AppInstallProgressView } from "@/components/app-install-progress";
import { isAppInstallActive, useAppInstallProgress } from "@/lib/app-install-progress";
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
  const [category, setCategory] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const { preferences, update: updatePreference } = useAppDiscoveryPreferences();
  const section = preferences.sections.marketplace;
  const [loading, setLoading] = React.useState(true);
  const [refreshResult, setRefreshResult] = React.useState<{ kind: "success" | "warning" | "error"; message: string } | null>(null);
  const catalogRequest = React.useRef(0);
  const [pendingAppIds, setPendingAppIds] = React.useState<Set<string>>(() => new Set());
  const [error, setError] = React.useState("");
  const { progress, clearProgress } = useAppInstallProgress("marketplace");
  const { progress: archiveProgress, clearProgress: clearArchiveProgress } = useAppInstallProgress('local');
  const [importing, setImporting] = React.useState(false);
  const importArchive = async () => {
    setImporting(true); setError(''); clearArchiveProgress('local');
    try {
      const result = await window.agentDesktop.installAppArchive();
      if (!result.ok && !result.canceled) throw new Error(result.error || 'App 安装失败');
      if (result.ok) await onInstalled();
    } catch (reason) { setError(cleanIpcErrorMessage(reason)); }
    finally { setImporting(false); }
  };

  const loadCatalog = React.useCallback(async (forceRefresh = false) => {
    const request = ++catalogRequest.current;
    setLoading(true);
    setError("");
    setRefreshResult(null);
    try {
      const result = await window.agentDesktop.appMarketplace.list({ forceRefresh });
      if (request !== catalogRequest.current) return;
      setCatalog(result);
      if (forceRefresh && !result.cached) {
        setDetails({});
        setSelectedVersions({});
        setExpandedId(null);
      }
      const updatedAt = new Date(result.fetchedAt).toLocaleString();
      const publishedAt = new Date(result.generatedAt).toLocaleString();
      const updates = result.apps.filter((app) => app.updateAvailable && app.hostCompatible && app.platformCompatible).length;
      setRefreshResult(result.warning
        ? { kind: "warning", message: `${result.warning}。上次成功更新：${updatedAt}` }
        : { kind: "success", message: result.cached
          ? `正在显示缓存，更新时间：${updatedAt}`
          : `${forceRefresh ? "刷新成功" : "已获取市场目录"}，${updates ? `${updates} 个 App 可更新` : "当前目录暂无可用更新"}。目录更新时间：${publishedAt}` });
    } catch (loadError) {
      if (request === catalogRequest.current) {
        setRefreshResult({ kind: "error", message: `刷新应用市场失败：${cleanIpcErrorMessage(loadError)}` });
      }
    } finally {
      if (request === catalogRequest.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadCatalog();
    return () => { catalogRequest.current++; };
  }, [loadCatalog]);

  const toggleDetails = async (entry: AppMarketplaceEntry) => {
    if (expandedId === entry.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(entry.id);
    if (details[entry.id]) return;
    const request = catalogRequest.current;
    try {
      const detail = await window.agentDesktop.appMarketplace.getDetails({ appId: entry.id });
      if (request !== catalogRequest.current) return;
      setDetails((current) => ({ ...current, [entry.id]: detail }));
      setSelectedVersions((current) => ({ ...current, [entry.id]: current[entry.id] || detail.latestVersion }));
    } catch (detailError) {
      if (request === catalogRequest.current) setError(cleanIpcErrorMessage(detailError));
    }
  };

  const install = async (entry: AppMarketplaceEntry) => {
    const version = selectedVersions[entry.id] || details[entry.id]?.latestVersion || entry.latestVersion;
    setPendingAppIds((current) => new Set(current).add(entry.id));
    clearProgress(entry.id);
    setError("");
    try {
      let result = await window.agentDesktop.appMarketplace.install({ appId: entry.id, version });
      if (result.requiresPermissionApproval) {
        const permissions = result.permissions || [];
        const accepted = window.confirm([
          `“${entry.displayName}”需要以下权限：`,
          "",
          ...permissions.map((permission) => `• ${formatAppPermission(permission)}`),
          "",
          "是否继续安装并授权？",
        ].join("\n"));
        if (!accepted) return;
        result = await window.agentDesktop.appMarketplace.install({ appId: entry.id, version, acceptPermissions: true });
      }
      if (result.canceled) return;
      if (!result.ok) throw new Error("App 安装未完成");
      await onInstalled();
      await loadCatalog(true);
    } catch (installError) {
      setError(cleanIpcErrorMessage(installError));
    } finally {
      setPendingAppIds((current) => { const next = new Set(current); next.delete(entry.id); return next; });
    }
  };

  const installedById = React.useMemo(() => new Map(installedApps.map((app) => [app.id || app.name, app])), [installedApps]);
  const searchedApps = filterApps(catalog?.apps || [], query, 'all', { group: section });
  const sectionApps = filterApps(searchedApps, '', category);
  const visibleApps = groupApps(sectionApps).flatMap(group => group.apps);
  const changeSection = (value: string) => { setCategory('all'); void updatePreference({ action: 'section', surface: 'marketplace', section: value }).catch(reason => setError(reason.message)); };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div data-app-header className="shrink-0 border-b border-border/70">
      <div className="mx-auto flex min-h-12 w-full max-w-[1180px] flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1 sm:px-5">
        {installedApps.length > 0 && <Button variant="ghost" size="icon" className="order-1 h-8 w-8" title="返回已安装 App" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>}
        <div className="order-2 flex shrink-0 items-baseline gap-2">
          <h1 className="text-sm font-semibold">应用市场</h1>
          {catalog && <span className="hidden text-xs text-muted-foreground lg:inline">{catalog.apps.length} 个应用</span>}
        </div>
        <div className="order-5 w-full min-[480px]:order-3 min-[480px]:w-auto min-[480px]:min-w-[194px] min-[480px]:flex-1"><AppDiscoveryFilter value={section} onChange={changeSection} query={query} onQuery={setQuery} /></div>
        <Button size="sm" variant="ghost" className="order-3 h-8 shrink-0 px-2.5 text-xs sm:order-4" title="导入安装包" aria-label="导入安装包" disabled={importing || isAppInstallActive(archiveProgress.local) || !supportsHostFeature('appInstallation')} onClick={() => void importArchive()}><Download className="h-3.5 w-3.5" /><span className="hidden lg:inline">{importing ? '安装中…' : '导入安装包'}</span></Button>
        <Button size="sm" variant="outline" className="order-4 h-8 shrink-0 px-2.5 text-xs sm:order-5" title="刷新" aria-label="刷新" disabled={loading} aria-busy={loading} onClick={() => void loadCatalog(true)}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /><span className="hidden lg:inline">{loading ? "刷新中…" : "刷新"}</span>
        </Button>
      </div>
      </div>

      {refreshResult && refreshResult.kind !== 'success' && <div role="alert"
        className={`flex shrink-0 items-start gap-2 border-b px-4 py-2 text-xs ${refreshResult.kind === "error"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"}`}>
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 break-words leading-4">{refreshResult.message}</span>
        <button type="button" className="shrink-0 underline underline-offset-2" onClick={() => void loadCatalog(true)}>重试</button>
      </div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-5 pt-1.5 sm:px-5">
        {archiveProgress.local && <div className="mb-3"><AppInstallProgressView progress={archiveProgress.local} /></div>}
        <AppCategoryTabs apps={searchedApps} value={category} onChange={setCategory} panelId="marketplace-apps" />
        <div role="tabpanel" id="marketplace-apps" aria-labelledby={`marketplace-apps-${category}`} className="mt-2">
        {error && <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        {loading && !catalog ? (
          <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />正在加载应用市场…</div>
        ) : visibleApps.length === 0 ? (
          <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">{!catalog && refreshResult?.kind === "error" ? "应用市场加载失败，请点击刷新重试" : category !== 'all' || section !== 'all' || query ? "没有匹配的应用，可切换到全部或调整筛选" : "暂无适用于当前系统的 App"}</div>
        ) : (
          <div className="grid gap-2.5 lg:grid-cols-2 2xl:grid-cols-3">
            {visibleApps.map((entry) => {
              const detail = details[entry.id];
              const expanded = expandedId === entry.id;
              const installed = installedById.get(entry.id);
              const installedUnavailable = installed?.packageStatus === "incompatible" || installed?.packageStatus === "invalid";
              const selectedVersion = selectedVersions[entry.id] || entry.latestVersion;
              const selectedRelease = detail?.versions.find((version) => version.version === selectedVersion) || entry.latest;
              const installProgress = progress[entry.id] || (pendingAppIds.has(entry.id)
                ? { source: "marketplace" as const, appId: entry.id, version: selectedVersion, phase: "preparing" as const }
                : undefined);
              const busy = pendingAppIds.has(entry.id) || isAppInstallActive(installProgress);
              const compatible = Boolean(
                (selectedRelease.platformCompatible ?? entry.platformCompatible)
                && (selectedRelease.hostCompatible ?? entry.hostCompatible),
              );
              const sameVersion = installed?.currentVersion === selectedVersion;
              const localModification = Boolean(installed?.localModification || entry.localModification);
              const actionLabel = busy
                ? installed ? "更新中…" : "安装中…"
                : !installed
                  ? "安装"
                  : localModification
                    ? sameVersion ? "本地版本冲突" : "安装市场版"
                  : sameVersion
                    ? "已安装"
                    : selectedVersion === entry.latestVersion && entry.updateAvailable
                      ? "更新"
                      : "安装此版本";
              return (
                <section key={entry.id} data-app-category={entry.category || 'other'} className={`rounded-lg border bg-card/80 p-3 ${entry.featured ? "border-primary/30" : "border-border/70"}`}>
                  <div className="flex items-start gap-3">
                    <MarketplaceIcon entry={entry} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{entry.displayName}</h3>
                        {entry.featured && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">推荐</span>}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.summary}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                        <span>v{entry.latestVersion}</span>
                        {entry.publisher?.name && <span>· {entry.publisher.name}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" className="h-8" disabled={busy || sameVersion || !compatible || !supportsHostFeature('appInstallation')} onClick={() => void install(entry)}>
                      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : sameVersion && !localModification ? <PackageCheck className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                      {!supportsHostFeature('appInstallation') ? "此 Host 暂不支持安装授权" : actionLabel}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => void toggleDetails(entry)}>
                      {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}详情
                    </Button>
                    {!compatible && <span className="text-xs text-destructive">{!(selectedRelease.platformCompatible ?? entry.platformCompatible) ? "此版本不支持当前系统" : `此版本需要 Host API ${selectedRelease.hostApi}，当前为 ${catalog?.hostApiVersion}`}</span>}
                    {installed?.currentVersion && <span title={installed.currentVersion} className={`ml-auto flex items-center gap-1 text-[11px] ${installedUnavailable ? "text-destructive" : "text-emerald-600"}`}><CheckCircle2 className="h-3.5 w-3.5" />已安装 {installed.currentVersion.replace(/-local\..*$/, " · 本地版")}{installedUnavailable ? " · 当前版本不可用" : ""}</span>}
                  </div>
                  {localModification && <p className="mt-2 text-xs leading-5 text-muted-foreground">{sameVersion
                    ? "本地修改与市场版本号相同，请保留源码并卸载本地版本后再安装。"
                    : "当前为本地修改版本。确认安装市场版后，本地版本和源码仍保留，可在版本历史中回滚。"}</p>}
                  {installProgress && <div className="mt-3"><AppInstallProgressView progress={installProgress} /></div>}
                  {expanded && (
                    <div className="mt-4 border-t border-border pt-3 text-xs">
                      {!detail ? (
                        <div className="flex items-center gap-2 text-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />正在读取详情…</div>
                      ) : (
                        <div className="grid gap-3">
                          <p className="whitespace-pre-wrap leading-5 text-muted-foreground">{detail.description || detail.summary}</p>
                          <label className="grid max-w-xs gap-1 text-muted-foreground">
                            <span>可用版本</span>
                            <select className="h-8 rounded-md border border-input bg-background px-2" value={selectedVersion} disabled={busy} onChange={(event) => setSelectedVersions((current) => ({ ...current, [entry.id]: event.target.value }))}>
                              {detail.versions.filter((version) => version.platformCompatible).map((version) => <option key={version.version} value={version.version}>{version.version}</option>)}
                            </select>
                          </label>
                          {selectedRelease.releaseNotes && <div><div className="mb-1 font-medium">更新说明</div><p className="whitespace-pre-wrap leading-5 text-muted-foreground">{selectedRelease.releaseNotes}</p></div>}
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                            <span>{selectedRelease.artifact ? formatBytes(selectedRelease.artifact.size) : '无适用安装包'}</span>
                            <span>Host API {selectedRelease.hostApi}</span>
                            <span>{selectedRelease.artifact?.signed ? "已签名" : "未签名"}</span>
                          </div>
                          {selectedRelease.permissions.length > 0 && (
                            <div><div className="mb-1 flex items-center gap-1 font-medium"><ShieldCheck className="h-3.5 w-3.5" />所需权限</div><div className="grid gap-1.5 sm:grid-cols-2">{selectedRelease.permissions.map((permission) => {
                              const detail = describeAppPermission(permission);
                              return <div key={permission} className="rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2"><div className="font-medium text-foreground">{detail.label}</div><p className="mt-0.5 leading-5 text-muted-foreground">{detail.description}</p><code className="mt-1 block break-all text-[10px] text-muted-foreground/80">{permission}</code></div>;
                            })}</div></div>
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
      </div>
    </div>
  );
}
