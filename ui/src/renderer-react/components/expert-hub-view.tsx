"use client";

import * as React from "react";
import {
  AlertCircle,
  Bot,
  Check,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  UsersRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

type ExpertTab = "recommend" | "hub" | "installed";
type ExpertTypeFilter = "all" | "agent" | "team";
type ExpertSortMode = "comprehensive" | "latest" | "hot";

const FEATURED_EXPERT_PAGE_SIZE = 12;
const HUB_EXPERT_PAGE_SIZE = 24;
const EXPERT_INSTALL_UI_TIMEOUT_MS = 180_000;

type ExpertCategory = {
  id: string;
  key: string;
  name: string;
  description?: string;
  count?: number;
};

type ExpertMember = {
  id: string;
  name: string;
  displayName: string;
  profession?: string;
  description?: string;
  avatar?: string;
  promptFile?: string;
  agentName?: string;
  plugin?: string;
  localPromptFile?: string;
};

type RemoteExpert = {
  id: string;
  type: "agent" | "team";
  name: string;
  displayName: string;
  profession?: string;
  description?: string;
  categoryId?: string;
  categoryName?: string;
  avatar?: string;
  promptFile?: string;
  plugin?: string;
  agentName?: string;
  tags?: string[];
  members?: ExpertMember[];
  updatedAt?: string;
  sourceManifest?: string;
};

type InstalledExpert = {
  id: string;
  type: "agent" | "team";
  name: string;
  displayName: string;
  profession?: string;
  description?: string;
  categoryId?: string;
  categoryName?: string;
  avatar?: string;
  promptFile?: string;
  plugin?: string;
  agentName?: string;
  tags?: string[];
  members?: ExpertMember[];
  sourceType?: string;
  sourceManifest?: string;
  installedAt?: string;
  source: string;
};

type FeaturedSceneExpert = {
  id: string;
  displayName: string;
  profession?: string;
  avatar?: string;
  type?: "agent" | "team";
};

type FeaturedScene = {
  id: string;
  name: string;
  description?: string;
  image?: string;
  darkImage?: string;
  expertIds?: string[];
  experts?: FeaturedSceneExpert[];
};

type OperationDialogState = {
  title: string;
  message: string;
};

function expertKey(expert: Pick<RemoteExpert | InstalledExpert, "id" | "name" | "displayName" | "agentName" | "plugin">) {
  return expert.id || expert.agentName || expert.plugin || expert.name || expert.displayName;
}

function installedKeys(expert: InstalledExpert) {
  return [
    expert.id,
    expert.name,
    expert.displayName,
    expert.agentName,
    expert.plugin,
  ].map((entry) => String(entry || "").trim()).filter(Boolean);
}

function formatCount(value?: number) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  return String(n);
}

function ExpertAvatar({ expert }: { expert: Pick<RemoteExpert | InstalledExpert, "avatar" | "displayName" | "name" | "type"> }) {
  const [failed, setFailed] = React.useState(false);
  const name = expert.displayName || expert.name || "Expert";
  if (expert.avatar && !failed) {
    return (
      <img
        src={expert.avatar}
        alt=""
        className="h-9 w-9 rounded-lg object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
      {expert.type === "team" ? <UsersRound className="h-4.5 w-4.5" /> : <Bot className="h-4.5 w-4.5" />}
      <span className="sr-only">{name}</span>
    </span>
  );
}

function MiniExpertAvatar({ expert }: { expert: FeaturedSceneExpert }) {
  const [failed, setFailed] = React.useState(false);
  if (expert.avatar && !failed) {
    return (
      <img
        src={expert.avatar}
        alt=""
        className="h-6 w-6 shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm">
      {expert.type === "team" ? <UsersRound className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
    </span>
  );
}

function SceneCard({ scene }: { scene: FeaturedScene }) {
  const experts = scene.experts || [];
  return (
    <div
      className="relative h-[148px] min-w-0 overflow-hidden rounded-lg border border-border/70 bg-muted"
      style={scene.image ? { backgroundImage: `url(${scene.image})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      <div className="absolute inset-0 bg-background/72" />
      <div className="relative flex h-full flex-col p-2.5">
        <div className="truncate text-sm font-semibold leading-5 text-foreground">{scene.name}</div>
        <div className="mt-0.5 line-clamp-1 text-[11px] leading-4 text-muted-foreground">
          {scene.description || "精选协作场景"}
        </div>
        <div className="mt-auto space-y-1">
          {experts.slice(0, 2).map((expert) => (
            <div key={expert.id} className="flex min-w-0 items-center gap-2">
              <MiniExpertAvatar expert={expert} />
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-foreground">{expert.displayName}</div>
                {expert.profession ? (
                  <div className="truncate text-[11px] text-muted-foreground">{expert.profession}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ExpertTypeBadge({ type, membersCount }: { type: "agent" | "team"; membersCount?: number }) {
  return (
    <Badge variant={type === "team" ? "secondary" : "outline"} className="rounded-md text-[11px]">
      {type === "team" ? `专家团${membersCount ? ` ${membersCount}` : ""}` : "专家"}
    </Badge>
  );
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${Math.max(0, seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

function OperationDialog({
  dialog,
  onClose,
}: {
  dialog: OperationDialogState | null;
  onClose: () => void;
}) {
  if (!dialog) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">{dialog.title}</div>
            <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {dialog.message}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="sm" className="h-8 rounded-lg px-3 text-xs" onClick={onClose}>
            知道了
          </Button>
        </div>
      </div>
    </div>
  );
}

function RemoteExpertCard({
  expert,
  installed,
  installing,
  installingElapsedSeconds,
  onInstall,
}: {
  expert: RemoteExpert;
  installed?: InstalledExpert;
  installing: boolean;
  installingElapsedSeconds?: number;
  onInstall: () => void;
}) {
  const tags = expert.tags || [];
  const subtitle = installing
    ? `安装中 ${formatElapsed(installingElapsedSeconds || 0)}`
    : expert.profession || expert.categoryName || expert.plugin || "专家中心";
  const installTitle = installing
    ? (expert.type === "team" ? "正在下载并解包专家团资源，首次安装可能较慢" : "正在安装")
    : installed
      ? "已安装"
      : expert.promptFile
        ? "安装"
        : "缺少 Prompt 文件";
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-card/82 p-2.5 shadow-[0_16px_48px_-40px_rgba(0,0,0,0.55)]">
      <div className="flex min-w-0 items-start gap-2.5">
        <ExpertAvatar expert={expert} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground" title={expert.displayName}>
                {expert.displayName}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {subtitle}
              </div>
            </div>
            <Button
              size="icon-sm"
              variant={installed ? "secondary" : "outline"}
              className="h-8 w-8 rounded-lg"
              disabled={Boolean(installed) || installing || !expert.promptFile}
              onClick={onInstall}
              title={installTitle}
            >
              {installing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : installed ? (
                <Check className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="mt-2 h-9 overflow-hidden text-xs leading-[18px] text-muted-foreground">
            {expert.description || "暂无描述"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ExpertTypeBadge type={expert.type} membersCount={expert.members?.length} />
            {expert.categoryName ? (
              <Badge variant="outline" className="rounded-md text-[11px]">
                {expert.categoryName}
              </Badge>
            ) : null}
            {tags.slice(0, 2).map((tag) => (
              <Badge key={tag} variant="outline" className="rounded-md text-[11px]">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function InstalledExpertCard({
  expert,
  busy,
  onUninstall,
}: {
  expert: InstalledExpert;
  busy: boolean;
  onUninstall: () => void;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-card/82 p-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <ExpertAvatar expert={expert} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground" title={expert.displayName}>
                {expert.displayName || expert.name}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {expert.profession || expert.categoryName || "本地专家"}
              </div>
            </div>
            <Button
              size="icon-sm"
              variant="outline"
              className="h-8 w-8 rounded-lg"
              onClick={onUninstall}
              disabled={busy}
              title="卸载"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-2 h-9 overflow-hidden text-xs leading-[18px] text-muted-foreground">
            {expert.description || "暂无描述"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ExpertTypeBadge type={expert.type} membersCount={expert.members?.length} />
            {expert.categoryName ? (
              <Badge variant="outline" className="rounded-md text-[11px]">
                {expert.categoryName}
              </Badge>
            ) : null}
            {(expert.tags || []).slice(0, 2).map((tag) => (
              <Badge key={tag} variant="outline" className="rounded-md text-[11px]">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ExpertHubView() {
  const [tab, setTab] = React.useState<ExpertTab>("recommend");
  const [query, setQuery] = React.useState("");
  const deferredQuery = React.useDeferredValue(query.trim());
  const [category, setCategory] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<ExpertTypeFilter>("all");
  const [sortMode, setSortMode] = React.useState<ExpertSortMode>("comprehensive");
  const [categories, setCategories] = React.useState<ExpertCategory[]>([]);
  const [remoteExperts, setRemoteExperts] = React.useState<RemoteExpert[]>([]);
  const [featuredExperts, setFeaturedExperts] = React.useState<RemoteExpert[]>([]);
  const [featuredScenes, setFeaturedScenes] = React.useState<FeaturedScene[]>([]);
  const [featuredPage, setFeaturedPage] = React.useState(1);
  const [featuredTotal, setFeaturedTotal] = React.useState(0);
  const [featuredHasMore, setFeaturedHasMore] = React.useState(false);
  const [featuredLoading, setFeaturedLoading] = React.useState(false);
  const [scenesLoading, setScenesLoading] = React.useState(false);
  const [installedExperts, setInstalledExperts] = React.useState<InstalledExpert[]>([]);
  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [installedLoading, setInstalledLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [operationDialog, setOperationDialog] = React.useState<OperationDialogState | null>(null);
  const [notice, setNotice] = React.useState("");
  const [busyKeys, setBusyKeys] = React.useState<Set<string>>(() => new Set());
  const [busyStartedAt, setBusyStartedAt] = React.useState<Record<string, number>>({});
  const [now, setNow] = React.useState(() => Date.now());

  const installedLookup = React.useMemo(() => {
    const map = new Map<string, InstalledExpert>();
    for (const expert of installedExperts) {
      for (const key of installedKeys(expert)) map.set(key, expert);
    }
    return map;
  }, [installedExperts]);

  const loadInstalled = React.useCallback(async () => {
    setInstalledLoading(true);
    try {
      const res = await window.agentDesktop.ipcInvoke("public-experthub:get-installed-experts") as { success?: boolean; data?: InstalledExpert[]; error?: string };
      if (!res?.success) throw new Error(res?.error || "读取已安装专家失败");
      setInstalledExperts(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInstalledExperts([]);
    } finally {
      setInstalledLoading(false);
    }
  }, []);

  const loadCategories = React.useCallback(async (forceRefresh = false) => {
    try {
      const res = await window.agentDesktop.ipcInvoke("public-experthub:fetch-categories", { forceRefresh }) as { success?: boolean; data?: { categories?: ExpertCategory[] }; error?: string };
      if (res?.success && Array.isArray(res.data?.categories)) {
        setCategories(res.data.categories);
      }
    } catch {
      setCategories([]);
    }
  }, []);

  const loadRemote = React.useCallback(async (nextPage: number, forceRefresh = false) => {
    if (tab === "installed") return;
    setLoading(true);
    setError("");
    try {
      const res = await window.agentDesktop.ipcInvoke("public-experthub:fetch-experts", {
        page: nextPage,
        pageSize: HUB_EXPERT_PAGE_SIZE,
        query: deferredQuery,
        category,
        type: typeFilter,
        sortBy: sortMode,
        forceRefresh,
      }) as { success?: boolean; data?: { experts?: RemoteExpert[]; total?: number; hasMore?: boolean }; error?: string };
      if (!res?.success) throw new Error(res?.error || "获取专家列表失败");
      setRemoteExperts(Array.isArray(res.data?.experts) ? res.data.experts : []);
      setTotal(Number(res.data?.total || 0));
      setHasMore(Boolean(res.data?.hasMore));
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRemoteExperts([]);
      setTotal(0);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [category, deferredQuery, sortMode, tab, typeFilter]);

  const loadFeatured = React.useCallback(async (nextPage: number, forceRefresh = false) => {
    setFeaturedLoading(true);
    setError("");
    try {
      const res = await window.agentDesktop.ipcInvoke("public-experthub:fetch-featured-experts", {
        page: nextPage,
        pageSize: FEATURED_EXPERT_PAGE_SIZE,
        query: deferredQuery,
        category,
        type: typeFilter,
        sortBy: sortMode,
        forceRefresh,
      }) as { success?: boolean; data?: { experts?: RemoteExpert[]; total?: number; hasMore?: boolean }; error?: string };
      if (!res?.success) throw new Error(res?.error || "获取推荐专家失败");
      const experts = Array.isArray(res.data?.experts) ? res.data.experts : [];
      setFeaturedExperts(experts);
      setFeaturedTotal(Number(res.data?.total || 0));
      setFeaturedHasMore(Boolean(res.data?.hasMore));
      setFeaturedPage(experts.length > 0 ? nextPage : 1);
      if (experts.length === 0 && nextPage !== 1) {
        void loadFeatured(1, forceRefresh);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFeaturedExperts([]);
      setFeaturedTotal(0);
      setFeaturedHasMore(false);
    } finally {
      setFeaturedLoading(false);
    }
  }, [category, deferredQuery, sortMode, typeFilter]);

  const loadScenes = React.useCallback(async (forceRefresh = false) => {
    setScenesLoading(true);
    try {
      const res = await window.agentDesktop.ipcInvoke("public-experthub:fetch-scenes", {
        page: 1,
        pageSize: 8,
        forceRefresh,
      }) as { success?: boolean; data?: { scenes?: FeaturedScene[] }; error?: string };
      if (!res?.success) throw new Error(res?.error || "获取精选场景失败");
      setFeaturedScenes(Array.isArray(res.data?.scenes) ? res.data.scenes : []);
    } catch {
      setFeaturedScenes([]);
    } finally {
      setScenesLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadInstalled();
    void loadCategories();
    void loadScenes();
  }, [loadCategories, loadInstalled, loadScenes]);

  React.useEffect(() => {
    if (tab === "recommend") void loadFeatured(1);
  }, [loadFeatured, tab]);

  React.useEffect(() => {
    if (tab === "hub") void loadRemote(1);
  }, [category, deferredQuery, loadRemote, tab, typeFilter]);

  React.useEffect(() => {
    if (busyKeys.size === 0) return undefined;
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [busyKeys.size]);

  const flashNotice = React.useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((current) => (current === text ? "" : current)), 3000);
  }, []);

  const showOperationDialog = React.useCallback((title: string, message: string) => {
    setOperationDialog({ title, message });
  }, []);

  const setBusy = React.useCallback((key: string, busy: boolean) => {
    setBusyKeys((current) => {
      const next = new Set(current);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
    setBusyStartedAt((current) => {
      const next = { ...current };
      if (busy) next[key] = Date.now();
      else delete next[key];
      return next;
    });
  }, []);

  const installExpert = React.useCallback(async (expert: RemoteExpert) => {
    const key = expertKey(expert);
    setBusy(key, true);
    setError("");
    try {
      const res = await withTimeout(
        window.agentDesktop.ipcInvoke("public-experthub:install-expert", { expertId: expert.id }) as Promise<{ success?: boolean; error?: string }>,
        EXPERT_INSTALL_UI_TIMEOUT_MS,
        "安装仍在等待网络响应。请稍后刷新“我安装的”，如果未安装成功再重试。",
      );
      if (!res?.success) throw new Error(res?.error || "安装失败");
      flashNotice(`已安装 ${expert.displayName || expert.name}`);
      await loadInstalled();
    } catch (err) {
      showOperationDialog("安装失败", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(key, false);
    }
  }, [flashNotice, loadInstalled, setBusy, showOperationDialog]);

  const uninstallExpert = React.useCallback(async (expert: InstalledExpert) => {
    const key = expert.source;
    setBusy(key, true);
    setError("");
    try {
      const res = await window.agentDesktop.ipcInvoke("public-experthub:uninstall-expert", { sourcePath: expert.source }) as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || "卸载失败");
      flashNotice(`已卸载 ${expert.displayName || expert.name}`);
      await loadInstalled();
    } catch (err) {
      showOperationDialog("卸载失败", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(key, false);
    }
  }, [flashNotice, loadInstalled, setBusy, showOperationDialog]);

  const visibleInstalledExperts = React.useMemo(() => {
    const q = deferredQuery.toLowerCase();
    return installedExperts.filter((expert) => {
      if (category && expert.categoryId !== category && expert.categoryName !== category) return false;
      if (typeFilter !== "all" && expert.type !== typeFilter) return false;
      if (!q) return true;
      return [
        expert.name,
        expert.displayName,
        expert.description,
        expert.profession,
        expert.categoryName,
        expert.plugin,
        expert.agentName,
      ].join(" ").toLowerCase().includes(q);
    });
  }, [category, deferredQuery, installedExperts, typeFilter]);

  const tabs: Array<{ id: ExpertTab; label: string }> = [
    { id: "recommend", label: "推荐" },
    { id: "hub", label: "专家中心" },
    { id: "installed", label: "我安装的" },
  ];
  const typeFilters: Array<{ id: ExpertTypeFilter; label: string }> = [
    { id: "all", label: "全部" },
    { id: "agent", label: "专家" },
    { id: "team", label: "专家团" },
  ];
  const sortOptions: Array<{ id: ExpertSortMode; label: string }> = [
    { id: "comprehensive", label: "综合" },
    { id: "latest", label: "最新" },
    { id: "hot", label: "最热" },
  ];
  const displayedExperts = tab === "recommend" ? featuredExperts : remoteExperts;
  const displayedTotal = tab === "recommend" ? featuredTotal : total;
  const displayedPage = tab === "recommend" ? featuredPage : page;
  const displayedLoading = tab === "recommend" ? featuredLoading : loading;
  const displayedHasMore = tab === "recommend" ? featuredHasMore : hasMore;
  const loadDisplayedPage = React.useCallback((nextPage: number) => {
    if (tab === "recommend") void loadFeatured(nextPage);
    else if (tab === "hub") void loadRemote(nextPage);
  }, [loadFeatured, loadRemote, tab]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border/70 bg-background/92 px-4 py-2 backdrop-blur sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-muted/70 p-0.5">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  setPage(1);
                }}
                className={cn(
                  "h-7 rounded-md px-3 text-xs font-semibold transition-colors",
                  tab === item.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}{item.id === "installed" ? ` ${installedExperts.length}` : ""}
              </button>
            ))}
          </div>
          {notice ? (
            <div className="min-w-[120px] flex-1 truncate text-xs text-muted-foreground">{notice}</div>
          ) : (
            <div className="hidden min-w-[80px] flex-1 truncate text-xs text-muted-foreground sm:block">
              {tab === "installed" ? `${visibleInstalledExperts.length} 个已安装` : `${formatCount(displayedTotal)} 个专家`}
            </div>
          )}
          <div className="relative ml-auto w-full sm:w-[300px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 rounded-lg pl-9 text-sm"
              placeholder={tab === "installed" ? "搜索已安装专家" : "搜索专家名称或描述"}
            />
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            className="h-8 w-8 rounded-lg"
            onClick={() => {
              if (tab === "installed") {
                void loadInstalled();
              } else if (tab === "recommend") {
                void loadCategories(true);
                void loadScenes(true);
                void loadFeatured(featuredPage, true);
              } else {
                void loadCategories(true);
                void loadRemote(page, true);
              }
            }}
            disabled={tab === "installed" ? installedLoading : displayedLoading}
            title="刷新"
          >
            <RefreshCw className={cn("h-4 w-4", (tab === "installed" ? installedLoading : displayedLoading) && "animate-spin")} />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-2.5 sm:px-5">
          {tab === "recommend" ? (
            <section className="mb-2.5">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {scenesLoading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="h-[148px] animate-pulse rounded-lg bg-muted" />
                  ))
                ) : featuredScenes.length > 0 ? (
                  featuredScenes.slice(0, 3).map((scene) => <SceneCard key={scene.id} scene={scene} />)
                ) : (
                  <div className="flex h-[104px] flex-1 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                    暂无精选场景
                  </div>
                )}
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {typeFilters.map((item) => (
                <FilterChip
                  key={item.id}
                  active={typeFilter === item.id}
                  onClick={() => {
                    setTypeFilter(item.id);
                    setPage(1);
                    setFeaturedPage(1);
                  }}
                >
                  {item.label}
                </FilterChip>
              ))}
            </div>
            <div className="flex h-7 shrink-0 items-center gap-0.5 rounded-md bg-muted/70 p-0.5">
              {sortOptions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSortMode(item.id);
                    setPage(1);
                    setFeaturedPage(1);
                  }}
                  className={cn(
                    "h-6 rounded-[5px] px-2.5 text-xs font-medium transition-colors",
                    sortMode === item.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
            <FilterChip
              active={!category}
              onClick={() => {
                setCategory("");
                setPage(1);
                setFeaturedPage(1);
              }}
            >
              全部分类
            </FilterChip>
            {categories.map((item) => (
              <FilterChip
                key={item.id}
                active={category === item.id}
                onClick={() => {
                  setCategory(item.id);
                  setPage(1);
                  setFeaturedPage(1);
                }}
              >
                {item.name}
              </FilterChip>
            ))}
          </div>

          {error ? (
            <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {tab !== "installed" ? (
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                第 {displayedPage} 页，共 {formatCount(displayedTotal)} 个，本页 {displayedExperts.length} 个
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-lg px-2.5 text-xs"
                  disabled={displayedLoading || displayedPage <= 1}
                  onClick={() => loadDisplayedPage(Math.max(1, displayedPage - 1))}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-lg px-2.5 text-xs"
                  disabled={displayedLoading || !displayedHasMore}
                  onClick={() => loadDisplayedPage(displayedPage + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          ) : null}

          {tab === "installed" ? (
            <div className="mt-3">
              {installedLoading ? (
                <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  加载已安装专家
                </div>
              ) : visibleInstalledExperts.length === 0 ? (
                <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                  暂无已安装专家
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                  {visibleInstalledExperts.map((expert) => (
                    <InstalledExpertCard
                      key={expert.source}
                      expert={expert}
                      busy={busyKeys.has(expert.source)}
                      onUninstall={() => void uninstallExpert(expert)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {displayedLoading ? (
                  <div className="col-span-full flex h-44 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    加载专家列表
                  </div>
                ) : displayedExperts.length === 0 ? (
                  <div className="col-span-full flex h-44 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                    暂无专家
                  </div>
                ) : (
                  displayedExperts.map((expert) => {
                    const installed = installedLookup.get(expertKey(expert));
                    const key = expertKey(expert);
                    const installing = busyKeys.has(key);
                    return (
                      <RemoteExpertCard
                        key={expert.id}
                        expert={expert}
                        installed={installed}
                        installing={installing}
                        installingElapsedSeconds={
                          installing ? Math.floor((now - (busyStartedAt[key] || now)) / 1000) : undefined
                        }
                        onInstall={() => void installExpert(expert)}
                      />
                    );
                  })
                )}
              </div>

            </>
          )}
        </div>
      </ScrollArea>
      <OperationDialog
        dialog={operationDialog}
        onClose={() => setOperationDialog(null)}
      />
    </div>
  );
}
