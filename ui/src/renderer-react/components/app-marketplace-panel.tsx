"use client";

import { AppHubToolbar } from '@/components/app-hub-toolbar';
import { AppHubCard } from '@/components/app-hub-card';
import { AppMarketplaceDetails } from '@/components/app-marketplace-details';
import { AppMarketplaceIcon } from '@/components/app-marketplace-icon';
import { supportsHostFeature } from '@/lib/host-environment';

import * as React from "react";
import { AppCategoryTabs } from '@/components/app-category-tabs';
import { filterApps, groupApps } from '@/lib/app-categories';
import {
  AlertCircle, ArrowLeft, Upload, LoaderCircle, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cleanIpcErrorMessage } from "@/lib/app-notifications";
import { formatAppPermission } from '../../shared/app-capability-descriptions.mjs';
import { AppInstallProgressView } from "@/components/app-install-progress";
import { isAppInstallActive, useAppInstallProgress } from "@/lib/app-install-progress";
import type {
  AppMarketplaceCatalog,
  AppMarketplaceDetail,
  AppMarketplaceEntry,
  StoredApp,
} from "../types";

export function AppMarketplacePanel({ installedApps, onBack, onInstalled, hub = false }: {
  hub?: boolean;
  installedApps: StoredApp[];
  onBack: () => void;
  onInstalled: () => Promise<unknown>;
}) {
  const [catalog, setCatalog] = React.useState<AppMarketplaceCatalog | null>(null);
  const [details, setDetails] = React.useState<Record<string, AppMarketplaceDetail>>({});
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const detailTrigger = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => { if (!selectedId) detailTrigger.current?.focus({ preventScroll: true }); }, [selectedId]);
  const [detailErrors, setDetailErrors] = React.useState<Record<string, string>>({});
  const [selectedVersions, setSelectedVersions] = React.useState<Record<string, string>>({});
  const [category, setCategory] = React.useState('all');
  const [query, setQuery] = React.useState('');
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
        setDetailErrors({});
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

  const openDetails = async (entry: AppMarketplaceEntry) => {
    if (selectedId !== entry.id) {
      detailTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setError('');
    }
    setSelectedId(entry.id);
    if (details[entry.id]) return;
    setDetailErrors(current => ({ ...current, [entry.id]: '' }));
    const request = catalogRequest.current;
    try {
      const detail = await window.agentDesktop.appMarketplace.getDetails({ appId: entry.id });
      if (request !== catalogRequest.current) return;
      setDetails(current => ({ ...current, [entry.id]: detail }));
    } catch (cause) {
      if (request === catalogRequest.current) setDetailErrors(current => ({ ...current, [entry.id]: cleanIpcErrorMessage(cause) }));
    }
  };

  const install = async (entry: AppMarketplaceEntry) => {
    const version = selectedVersions[entry.id] || entry.latestVersion;
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
      await loadCatalog();
    } catch (installError) {
      setError(cleanIpcErrorMessage(installError));
    } finally {
      setPendingAppIds((current) => { const next = new Set(current); next.delete(entry.id); return next; });
    }
  };

  const installedById = React.useMemo(() => new Map(installedApps.map((app) => [app.id || app.name, app])), [installedApps]);
  const searchedApps = filterApps(catalog?.apps || [], query);
  const sectionApps = filterApps(searchedApps, '', category);
  const visibleApps = groupApps(sectionApps).flatMap(group => group.apps);

  const selected = catalog?.apps.find(entry => entry.id === selectedId);
  const activeInstall = pendingAppIds.size > 0 || importing || Object.values(progress).some(isAppInstallActive) || isAppInstallActive(archiveProgress.local);
  const toolbarActions = <>
    <Button size="sm" variant="outline" className="h-8 rounded-lg px-3 text-xs" title="本地安装 ZIP" aria-label="本地安装 ZIP" disabled={importing || isAppInstallActive(archiveProgress.local) || !supportsHostFeature('appInstallation')} onClick={() => void importArchive()}><Upload className="h-4 w-4" />{importing ? '安装中…' : '添加应用'}</Button>
    <Button size="icon-sm" variant="outline" className="h-8 w-8 rounded-lg" title="刷新" aria-label="刷新" disabled={loading || activeInstall} aria-busy={loading} onClick={() => void loadCatalog(true)}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button>
  </>;
  return <>
    <div className={`${selected ? 'hidden' : 'flex'} h-full min-h-0 flex-col bg-background`}>
      <AppHubToolbar tab="marketplace" installedCount={installedApps.length} onChangeTab={tab => { if (tab === 'installed') onBack(); }} busy={activeInstall}
        query={query} onQuery={setQuery} actions={toolbarActions}
        navigation={hub ? undefined : <><Button variant="ghost" size="sm" title="返回应用详情" disabled={activeInstall} onClick={onBack}><ArrowLeft className="h-4 w-4" />返回</Button><h1 className="text-sm font-semibold">应用市场</h1></>} />

      {refreshResult && refreshResult.kind !== 'success' && <div role="alert"
        className={`flex shrink-0 items-start gap-2 border-b px-4 py-2 text-xs ${refreshResult.kind === "error"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"}`}>
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 break-words leading-4">{refreshResult.message}</span>
        <button type="button" className="shrink-0 underline underline-offset-2" onClick={() => void loadCatalog(true)}>重试</button>
      </div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1180px] px-4 py-2.5 sm:px-5">
        {archiveProgress.local && <div className="mb-3"><AppInstallProgressView progress={archiveProgress.local} /></div>}
        <AppCategoryTabs apps={searchedApps} value={category} onChange={setCategory} panelId="marketplace-apps" />
        <div role="tabpanel" id="marketplace-apps" aria-labelledby={`marketplace-apps-${category}`} className="mt-3">
        {error && <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        {loading && !catalog ? (
          <div className="flex h-44 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />正在加载应用市场…</div>
        ) : visibleApps.length === 0 ? (
          <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">{!catalog && refreshResult?.kind === "error" ? "应用市场加载失败，请点击刷新重试" : category !== 'all' || query ? "没有匹配的应用，可切换到全部或调整筛选" : "暂无适用于当前系统的 App"}</div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
            {visibleApps.map(entry => <AppHubCard key={entry.id} id={entry.id} marketplace category={entry.category}
              title={entry.displayName} publisher={entry.publisher?.name || '应用市场'} description={entry.summary}
              icon={<AppMarketplaceIcon icon={entry.iconUrl} />} onOpen={() => void openDetails(entry)} />)}
          </div>
        )}
        </div>
      </div>
      </div>
    </div>
    {selected && <AppMarketplaceDetails key={selected.id} entry={selected} detail={details[selected.id]} installed={installedById.get(selected.id)}
      version={selectedVersions[selected.id] || selected.latestVersion} hostApiVersion={catalog?.hostApiVersion}
      busy={pendingAppIds.has(selected.id) || isAppInstallActive(progress[selected.id])} progress={progress[selected.id]}
      error={error} detailError={detailErrors[selected.id]} onBack={() => setSelectedId(null)} onInstall={() => void install(selected)}
      onVersion={version => setSelectedVersions(current => ({ ...current, [selected.id]: version }))} onRetry={() => void openDetails(selected)} />}
    </>;
}
