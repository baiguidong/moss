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
  X,
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
const FEATURED_SCENE_PAGE_SIZE = 100;
const HUB_EXPERT_PAGE_SIZE = 24;
const EXPERT_INSTALL_UI_TIMEOUT_MS = 180_000;
const LOAD_MORE_ROOT_MARGIN = "520px 0px";

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
  quickPrompts?: string[];
  usageCount?: number;
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

type ExpertDetailState = {
  expertId: string;
  scene?: FeaturedScene | null;
  expert?: RemoteExpert | null;
  loading: boolean;
  error?: string;
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

function mergeExpertPages<T extends RemoteExpert>(current: T[], next: T[]) {
  const merged = [...current];
  const seen = new Set(current.map((expert) => expertKey(expert)));
  for (const expert of next) {
    const key = expertKey(expert);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(expert);
  }
  return merged;
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

function SceneCard({
  scene,
  onOpenExpert,
}: {
  scene: FeaturedScene;
  onOpenExpert: (expertId: string, scene: FeaturedScene) => void;
}) {
  const experts = scene.experts || [];
  return (
    <div
      className="relative aspect-square w-[166px] shrink-0 overflow-hidden rounded-lg border border-border/70 bg-muted"
      style={scene.image ? { backgroundImage: `url(${scene.image})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      <div className="absolute inset-0 bg-background/78" />
      <div className="relative flex h-full flex-col p-3">
        <div className="truncate text-sm font-semibold leading-5 text-foreground" title={scene.name}>
          {scene.name}
        </div>
        <div className="mt-auto space-y-1.5">
          {experts.slice(0, 3).map((expert) => (
            <button
              key={expert.id}
              type="button"
              className="block h-7 w-full min-w-0 rounded-md px-2 text-left text-xs font-medium leading-7 text-foreground transition-colors hover:bg-background/65"
              onClick={() => onOpenExpert(expert.id, scene)}
              title={expert.displayName}
            >
              <span className="block truncate">{expert.displayName}</span>
            </button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4">
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

function ExpertDetailDialog({
  detail,
  installed,
  installing,
  installingElapsedSeconds,
  onInstall,
  onClose,
}: {
  detail: ExpertDetailState | null;
  installed?: InstalledExpert;
  installing: boolean;
  installingElapsedSeconds?: number;
  onInstall: (expert: RemoteExpert) => void;
  onClose: () => void;
}) {
  if (!detail) return null;
  const expert = detail.expert || null;
  const title = expert?.displayName || detail.scene?.name || "专家详情";
  const subtitle = expert?.profession || expert?.categoryName || "";
  const tags = expert?.tags || [];
  const quickPrompts = expert?.quickPrompts || [];
  const installDisabled = !expert || Boolean(installed) || installing || !expert.promptFile;
  const installLabel = installing
    ? `安装中 ${formatElapsed(installingElapsedSeconds || 0)}`
    : installed
      ? "已安装"
      : "召唤专家";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4">
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex min-w-0 items-start gap-3 border-b border-border/70 p-4">
          {expert ? <ExpertAvatar expert={expert} /> : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Bot className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {detail.scene?.name ? (
                <Badge variant="secondary" className="rounded-md text-[11px]">{detail.scene.name}</Badge>
              ) : null}
              {expert?.type ? <ExpertTypeBadge type={expert.type} membersCount={expert.members?.length} /> : null}
            </div>
            <div className="mt-2 truncate text-lg font-semibold leading-6 text-foreground" title={title}>
              {title}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {subtitle ? <span>{subtitle}</span> : null}
              {expert?.usageCount ? <span>{formatCount(expert.usageCount)}次使用</span> : null}
            </div>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {detail.loading && !expert ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载专家详情
            </div>
          ) : detail.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {detail.error}
            </div>
          ) : null}

          {expert ? (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-muted-foreground">
                {expert.description || "暂无描述"}
              </p>

              {tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="rounded-md text-[11px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}

              {quickPrompts.length > 0 ? (
                <div>
                  <div className="mb-2 text-sm font-semibold text-foreground">专家帮你做</div>
                  <div className="space-y-2">
                    {quickPrompts.slice(0, 6).map((prompt, index) => (
                      <div
                        key={`${index}-${prompt}`}
                        className="rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-sm leading-6 text-foreground"
                      >
                        “{prompt}”
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {expert.type === "team" && expert.members?.length ? (
                <div>
                  <div className="mb-2 text-sm font-semibold text-foreground">成员</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {expert.members.slice(0, 6).map((member) => (
                      <div key={member.id} className="min-w-0 rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
                        <div className="truncate text-sm font-medium text-foreground">{member.displayName || member.name}</div>
                        {member.profession ? (
                          <div className="truncate text-xs text-muted-foreground">{member.profession}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/70 p-3">
          <Button variant="outline" size="sm" className="h-8 rounded-lg px-3 text-xs" onClick={onClose}>
            关闭
          </Button>
          <Button
            size="sm"
            className="h-8 rounded-lg px-3 text-xs"
            disabled={installDisabled}
            onClick={() => expert && onInstall(expert)}
          >
            {installing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : installed ? <Check className="mr-2 h-4 w-4" /> : <Download className="mr-2 h-4 w-4" />}
            {installLabel}
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
  const [featuredHasMore, setFeaturedHasMore] = React.useState(false);
  const [featuredLoading, setFeaturedLoading] = React.useState(false);
  const [scenesLoading, setScenesLoading] = React.useState(false);
  const [installedExperts, setInstalledExperts] = React.useState<InstalledExpert[]>([]);
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [installedLoading, setInstalledLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [operationDialog, setOperationDialog] = React.useState<OperationDialogState | null>(null);
  const [detail, setDetail] = React.useState<ExpertDetailState | null>(null);
  const [notice, setNotice] = React.useState("");
  const [busyKeys, setBusyKeys] = React.useState<Set<string>>(() => new Set());
  const [busyStartedAt, setBusyStartedAt] = React.useState<Record<string, number>>({});
  const [now, setNow] = React.useState(() => Date.now());
  const loadMoreRef = React.useRef<HTMLDivElement | null>(null);

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
      const experts = Array.isArray(res.data?.experts) ? res.data.experts : [];
      setRemoteExperts((current) => (
        nextPage > 1 && !forceRefresh ? mergeExpertPages(current, experts) : experts
      ));
      setHasMore(Boolean(res.data?.hasMore));
      if (experts.length > 0 || nextPage === 1) setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (nextPage === 1) {
        setRemoteExperts([]);
        setHasMore(false);
      }
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
      setFeaturedExperts((current) => (
        nextPage > 1 && !forceRefresh ? mergeExpertPages(current, experts) : experts
      ));
      setFeaturedHasMore(Boolean(res.data?.hasMore));
      if (experts.length > 0 || nextPage === 1) setFeaturedPage(nextPage);
      if (experts.length === 0 && nextPage !== 1) {
        setFeaturedHasMore(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (nextPage === 1) {
        setFeaturedExperts([]);
        setFeaturedHasMore(false);
      }
    } finally {
      setFeaturedLoading(false);
    }
  }, [category, deferredQuery, sortMode, typeFilter]);

  const loadScenes = React.useCallback(async (forceRefresh = false) => {
    setScenesLoading(true);
    try {
      const res = await window.agentDesktop.ipcInvoke("public-experthub:fetch-scenes", {
        page: 1,
        pageSize: FEATURED_SCENE_PAGE_SIZE,
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

  const openExpertDetail = React.useCallback(async (expertId: string, scene?: FeaturedScene | null) => {
    const id = String(expertId || "").trim();
    if (!id) return;
    const cachedExpert = [...featuredExperts, ...remoteExperts].find((expert) => expert.id === id) || null;
    setDetail({
      expertId: id,
      scene: scene || null,
      expert: cachedExpert,
      loading: true,
      error: "",
    });
    try {
      const res = await window.agentDesktop.ipcInvoke("public-experthub:fetch-detail", { expertId: id }) as { success?: boolean; data?: RemoteExpert; error?: string };
      if (!res?.success || !res.data) throw new Error(res?.error || "获取专家详情失败");
      setDetail((current) => (
        current?.expertId === id
          ? { ...current, expert: res.data || cachedExpert, loading: false, error: "" }
          : current
      ));
    } catch (err) {
      setDetail((current) => (
        current?.expertId === id
          ? { ...current, loading: false, error: err instanceof Error ? err.message : String(err) }
          : current
      ));
    }
  }, [featuredExperts, remoteExperts]);

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
  const displayedPage = tab === "recommend" ? featuredPage : page;
  const displayedLoading = tab === "recommend" ? featuredLoading : loading;
  const displayedHasMore = tab === "recommend" ? featuredHasMore : hasMore;
  const detailExpert = detail?.expert || null;
  const detailInstalled = detailExpert ? installedLookup.get(expertKey(detailExpert)) : undefined;
  const detailInstallingKey = detailExpert ? expertKey(detailExpert) : "";
  const detailInstalling = detailInstallingKey ? busyKeys.has(detailInstallingKey) : false;
  const loadDisplayedPage = React.useCallback((nextPage: number) => {
    if (tab === "recommend") void loadFeatured(nextPage);
    else if (tab === "hub") void loadRemote(nextPage);
  }, [loadFeatured, loadRemote, tab]);

  React.useEffect(() => {
    if (tab === "installed" || !displayedHasMore || displayedLoading) return undefined;
    const node = loadMoreRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadDisplayedPage(displayedPage + 1);
      }
    }, { root: null, rootMargin: LOAD_MORE_ROOT_MARGIN });
    observer.observe(node);
    return () => observer.disconnect();
  }, [displayedHasMore, displayedLoading, displayedPage, loadDisplayedPage, tab]);

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
              {tab === "installed" ? `${visibleInstalledExperts.length} 个已安装` : `已加载 ${formatCount(displayedExperts.length)} 个`}
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
                setFeaturedPage(1);
                void loadCategories(true);
                void loadScenes(true);
                void loadFeatured(1, true);
              } else {
                setPage(1);
                void loadCategories(true);
                void loadRemote(1, true);
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
              <div className="w-full overflow-x-auto pb-1">
                {scenesLoading ? (
                  <div className="flex w-max gap-2.5">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="aspect-square w-[166px] shrink-0 animate-pulse rounded-lg bg-muted" />
                    ))}
                  </div>
                ) : featuredScenes.length > 0 ? (
                  <div className="flex w-max gap-2.5">
                    {featuredScenes.map((scene) => (
                      <SceneCard
                        key={scene.id}
                        scene={scene}
                        onOpenExpert={openExpertDetail}
                      />
                    ))}
                  </div>
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
                已加载 {formatCount(displayedExperts.length)} 个{displayedHasMore ? "，继续下滑加载更多" : displayedExperts.length > 0 ? "，已加载全部" : ""}
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
                {displayedLoading && displayedExperts.length === 0 ? (
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
              {displayedExperts.length > 0 ? (
                <div ref={loadMoreRef} className="flex h-16 items-center justify-center">
                  {displayedLoading ? (
                    <div className="flex items-center text-xs text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      加载更多
                    </div>
                  ) : displayedHasMore ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-lg px-3 text-xs text-muted-foreground"
                      onClick={() => loadDisplayedPage(displayedPage + 1)}
                    >
                      加载更多
                    </Button>
                  ) : (
                    <div className="text-xs text-muted-foreground">已加载全部</div>
                  )}
                </div>
              ) : null}

            </>
          )}
        </div>
      </ScrollArea>
      <OperationDialog
        dialog={operationDialog}
        onClose={() => setOperationDialog(null)}
      />
      <ExpertDetailDialog
        detail={detail}
        installed={detailInstalled}
        installing={detailInstalling}
        installingElapsedSeconds={
          detailInstalling ? Math.floor((now - (busyStartedAt[detailInstallingKey] || now)) / 1000) : undefined
        }
        onInstall={(expert) => void installExpert(expert)}
        onClose={() => setDetail(null)}
      />
    </div>
  );
}
