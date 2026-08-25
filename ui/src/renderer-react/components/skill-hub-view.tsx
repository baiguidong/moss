"use client";

import * as React from "react";
import {
  Check,
  Download,
  Hammer,
  Loader2,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

type SkillTab = "recommend" | "hub" | "installed";

type SkillCategory = {
  key: string;
  name: string;
  active?: boolean;
};

type SkillNamespace = {
  canonicalName?: string;
  displayName?: string;
  handle?: string;
  publicSlug?: string;
};

type RemoteSkill = {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  icon?: string;
  category?: string;
  categories?: string[];
  namespace?: SkillNamespace | null;
  ownerName?: string;
  source?: string;
  homepage?: string;
  stars?: number;
  downloads?: number;
  installs?: number;
  verified?: boolean;
};

type InstalledSkill = {
  id?: string;
  slug?: string;
  name: string;
  displayName: string;
  description?: string;
  version?: string;
  icon?: string;
  category?: string;
  categories?: string[];
  isHubInstalled?: boolean;
  isUploaded?: boolean;
  namespace?: SkillNamespace | null;
  ownerName?: string;
  source: string;
};

function skillKey(skill: Pick<RemoteSkill, "id" | "slug" | "name" | "namespace">) {
  return skill.id || skill.namespace?.canonicalName || (skill.namespace?.handle && skill.slug ? `@${skill.namespace.handle}/${skill.slug}` : "") || skill.slug || skill.name;
}

function installedKeys(skill: InstalledSkill) {
  return [
    skill.id,
    skill.slug,
    skill.name,
    skill.displayName,
    skill.namespace?.canonicalName,
    skill.namespace?.handle && skill.slug ? `@${skill.namespace.handle}/${skill.slug}` : "",
  ].map((entry) => String(entry || "").trim()).filter(Boolean);
}

function formatCount(value?: number) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  return String(n);
}

function SkillIcon({ skill }: { skill: Pick<RemoteSkill | InstalledSkill, "icon" | "displayName" | "name"> }) {
  const [failed, setFailed] = React.useState(false);
  const name = skill.displayName || skill.name || "Skill";
  if (skill.icon && !failed) {
    return (
      <img
        src={skill.icon}
        alt=""
        className="h-10 w-10 rounded-lg object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <Hammer className="h-5 w-5" />
      <span className="sr-only">{name}</span>
    </span>
  );
}

function CategoryChip({
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
        "h-8 shrink-0 rounded-lg px-3 text-sm transition-colors",
        active
          ? "bg-foreground text-background"
          : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function RemoteSkillCard({
  skill,
  installed,
  installing,
  onInstall,
}: {
  skill: RemoteSkill;
  installed?: InstalledSkill;
  installing: boolean;
  onInstall: () => void;
}) {
  const categories = skill.categories?.length ? skill.categories : skill.category ? [skill.category] : [];
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-card/82 p-4 shadow-[0_16px_48px_-40px_rgba(0,0,0,0.55)]">
      <div className="flex min-w-0 items-start gap-3">
        <SkillIcon skill={skill} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground" title={skill.displayName}>
                {skill.displayName}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {skill.ownerName || skill.namespace?.displayName || skill.namespace?.handle || skill.source || "SkillHub"}
              </div>
            </div>
            <Button
              size="icon-sm"
              variant={installed ? "secondary" : "outline"}
              className="h-8 w-8 rounded-lg"
              disabled={Boolean(installed) || installing}
              onClick={onInstall}
              title={installed ? "已安装" : "安装"}
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
          <p className="mt-3 h-11 overflow-hidden text-sm leading-5 text-muted-foreground">
            {skill.description || "暂无描述"}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {categories.slice(0, 3).map((category) => (
              <Badge key={category} variant="outline" className="rounded-md text-[11px]">
                {category}
              </Badge>
            ))}
            {skill.verified ? (
              <Badge variant="secondary" className="rounded-md text-[11px]">
                已认证
              </Badge>
            ) : null}
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5" />
              {formatCount(skill.stars)}
            </span>
            <span>下载 {formatCount(skill.downloads)}</span>
            <span className="truncate">v{skill.version || "-"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function InstalledSkillCard({
  skill,
  busy,
  onUninstall,
}: {
  skill: InstalledSkill;
  busy: boolean;
  onUninstall: () => void;
}) {
  const categories = skill.categories?.length ? skill.categories : skill.category ? [skill.category] : [];
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-card/82 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <SkillIcon skill={skill} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground" title={skill.displayName}>
                {skill.displayName || skill.name}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {skill.isHubInstalled ? "SkillHub" : skill.isUploaded ? "本地导入" : "本地技能"}
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
          <p className="mt-3 h-11 overflow-hidden text-sm leading-5 text-muted-foreground">
            {skill.description || "暂无描述"}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {categories.slice(0, 3).map((category) => (
              <Badge key={category} variant="outline" className="rounded-md text-[11px]">
                {category}
              </Badge>
            ))}
          </div>
          <div className="mt-3 truncate text-xs text-muted-foreground">
            v{skill.version || "-"} · {skill.source}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkillHubView() {
  const [tab, setTab] = React.useState<SkillTab>("recommend");
  const [query, setQuery] = React.useState("");
  const deferredQuery = React.useDeferredValue(query.trim());
  const [category, setCategory] = React.useState("");
  const [categories, setCategories] = React.useState<SkillCategory[]>([]);
  const [remoteSkills, setRemoteSkills] = React.useState<RemoteSkill[]>([]);
  const [featuredSkills, setFeaturedSkills] = React.useState<RemoteSkill[]>([]);
  const [featuredPage, setFeaturedPage] = React.useState(1);
  const [featuredTotal, setFeaturedTotal] = React.useState(0);
  const [featuredLoading, setFeaturedLoading] = React.useState(false);
  const [installedSkills, setInstalledSkills] = React.useState<InstalledSkill[]>([]);
  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [installedLoading, setInstalledLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [busyKeys, setBusyKeys] = React.useState<Set<string>>(() => new Set());

  const installedLookup = React.useMemo(() => {
    const map = new Map<string, InstalledSkill>();
    for (const skill of installedSkills) {
      for (const key of installedKeys(skill)) map.set(key, skill);
    }
    return map;
  }, [installedSkills]);

  const loadInstalled = React.useCallback(async () => {
    setInstalledLoading(true);
    try {
      const res = await window.agentDesktop.ipcInvoke("public-skillhub:get-installed-skills") as { success?: boolean; data?: InstalledSkill[]; error?: string };
      if (!res?.success) throw new Error(res?.error || "读取已安装技能失败");
      setInstalledSkills(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInstalledSkills([]);
    } finally {
      setInstalledLoading(false);
    }
  }, []);

  const loadCategories = React.useCallback(async () => {
    try {
      const res = await window.agentDesktop.ipcInvoke("public-skillhub:fetch-categories") as { success?: boolean; data?: SkillCategory[]; error?: string };
      if (res?.success && Array.isArray(res.data)) {
        setCategories(res.data.filter((item) => item.active !== false));
      }
    } catch {
      setCategories([]);
    }
  }, []);

  const loadRemote = React.useCallback(async (nextPage: number) => {
    if (tab === "installed") return;
    setLoading(true);
    setError("");
    try {
      const res = await window.agentDesktop.ipcInvoke("public-skillhub:fetch-skills", {
        page: nextPage,
        pageSize: 18,
        query: deferredQuery,
        category,
        sortBy: tab === "recommend" ? "downloads" : "updated_at",
        order: "desc",
      }) as { success?: boolean; data?: { skills?: RemoteSkill[]; total?: number }; error?: string };
      if (!res?.success) throw new Error(res?.error || "获取 SkillHub 列表失败");
      setRemoteSkills(Array.isArray(res.data?.skills) ? res.data.skills : []);
      setTotal(Number(res.data?.total || 0));
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRemoteSkills([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [category, deferredQuery, tab]);

  const loadFeatured = React.useCallback(async (nextPage: number) => {
    setFeaturedLoading(true);
    setError("");
    try {
      const res = await window.agentDesktop.ipcInvoke("public-skillhub:fetch-skills", {
        page: nextPage,
        pageSize: 4,
        sortBy: "downloads",
        order: "desc",
      }) as { success?: boolean; data?: { skills?: RemoteSkill[]; total?: number }; error?: string };
      if (!res?.success) throw new Error(res?.error || "获取精选技能失败");
      const skills = Array.isArray(res.data?.skills) ? res.data.skills : [];
      setFeaturedSkills(skills);
      setFeaturedTotal(Number(res.data?.total || 0));
      setFeaturedPage(skills.length > 0 ? nextPage : 1);
      if (skills.length === 0 && nextPage !== 1) {
        void loadFeatured(1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFeaturedSkills([]);
      setFeaturedTotal(0);
    } finally {
      setFeaturedLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadInstalled();
    void loadCategories();
    void loadFeatured(1);
  }, [loadCategories, loadFeatured, loadInstalled]);

  React.useEffect(() => {
    if (tab !== "installed") void loadRemote(1);
  }, [category, deferredQuery, loadRemote, tab]);

  const flashNotice = React.useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((current) => (current === text ? "" : current)), 3000);
  }, []);

  const setBusy = React.useCallback((key: string, busy: boolean) => {
    setBusyKeys((current) => {
      const next = new Set(current);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const installSkill = React.useCallback(async (skill: RemoteSkill) => {
    const key = skillKey(skill);
    setBusy(key, true);
    setError("");
    try {
      const res = await window.agentDesktop.ipcInvoke("public-skillhub:install-skill", { skill }) as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || "安装失败");
      flashNotice(`已安装 ${skill.displayName || skill.name}`);
      await loadInstalled();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(key, false);
    }
  }, [flashNotice, loadInstalled, setBusy]);

  const uninstallSkill = React.useCallback(async (skill: InstalledSkill) => {
    const key = skill.source;
    setBusy(key, true);
    setError("");
    try {
      const res = await window.agentDesktop.ipcInvoke("public-skillhub:uninstall-skill", { sourcePath: skill.source }) as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || "卸载失败");
      flashNotice(`已卸载 ${skill.displayName || skill.name}`);
      await loadInstalled();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(key, false);
    }
  }, [flashNotice, loadInstalled, setBusy]);

  const importLocal = React.useCallback(async () => {
    setError("");
    try {
      const picked = await window.agentDesktop.ipcInvoke("public-skillhub:open-import-dialog") as { success?: boolean; data?: { filePath?: string }; error?: string };
      if (!picked?.success || !picked.data?.filePath) return;
      const res = await window.agentDesktop.ipcInvoke("public-skillhub:import-local", { sourcePath: picked.data.filePath }) as { success?: boolean; error?: string };
      if (!res?.success) throw new Error(res?.error || "导入失败");
      flashNotice("技能已导入");
      await loadInstalled();
      setTab("installed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [flashNotice, loadInstalled]);

  const visibleInstalledSkills = React.useMemo(() => {
    const q = deferredQuery.toLowerCase();
    return installedSkills.filter((skill) => {
      if (category && !(skill.categories || []).includes(category) && skill.category !== category) return false;
      if (!q) return true;
      return [skill.name, skill.displayName, skill.description, skill.ownerName].join(" ").toLowerCase().includes(q);
    });
  }, [category, deferredQuery, installedSkills]);

  const tabs: Array<{ id: SkillTab; label: string }> = [
    { id: "recommend", label: "推荐" },
    { id: "hub", label: "SkillHub" },
    { id: "installed", label: "我安装的" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border/70 bg-background/92 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Hammer className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">技能</div>
            <div className="truncate text-xs text-muted-foreground">
              {tab === "installed" ? `${visibleInstalledSkills.length} 个已安装` : `${formatCount(total)} 个 Skill`}
              {notice ? ` · ${notice}` : ""}
            </div>
          </div>
          <div className="relative w-full sm:w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 rounded-lg pl-9"
              placeholder={tab === "installed" ? "搜索已安装技能" : "搜索 Skill 名称或描述"}
            />
          </div>
          <Button variant="outline" size="sm" className="h-9 rounded-lg" onClick={importLocal}>
            <Upload className="h-4 w-4" />
            添加技能
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="h-9 w-9 rounded-lg"
            onClick={() => {
              if (tab === "installed") {
                void loadInstalled();
              } else {
                void loadRemote(page);
              }
            }}
            disabled={tab === "installed" ? installedLoading : loading}
            title="刷新"
          >
            <RefreshCw className={cn("h-4 w-4", (tab === "installed" ? installedLoading : loading) && "animate-spin")} />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            {tabs.map((item) => (
              <CategoryChip
                key={item.id}
                active={tab === item.id}
                onClick={() => {
                  setTab(item.id);
                  setPage(1);
                }}
              >
                {item.label}{item.id === "installed" ? ` ${installedSkills.length}` : ""}
              </CategoryChip>
            ))}
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            <CategoryChip active={!category} onClick={() => setCategory("")}>
              全部
            </CategoryChip>
            {categories.map((item) => (
              <CategoryChip key={item.key} active={category === item.key} onClick={() => setCategory(item.key)}>
                {item.name}
              </CategoryChip>
            ))}
          </div>

          {error ? (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {tab === "installed" ? (
            <div className="mt-4">
              {installedLoading ? (
                <div className="rounded-lg border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
                  加载中...
                </div>
              ) : visibleInstalledSkills.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
                  暂无已安装技能
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  {visibleInstalledSkills.map((skill) => (
                    <InstalledSkillCard
                      key={skill.source}
                      skill={skill}
                      busy={busyKeys.has(skill.source)}
                      onUninstall={() => void uninstallSkill(skill)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4">
              {loading && remoteSkills.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
                  加载中...
                </div>
              ) : remoteSkills.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
                  没有找到匹配的 Skill
                </div>
              ) : (
                <>
                  {tab === "recommend" && !deferredQuery && !category ? (
                    <div className="mb-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-base font-semibold text-foreground">精选技能</h2>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">第 {featuredPage} 页</span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg"
                            disabled={featuredPage <= 1 || featuredLoading}
                            onClick={() => void loadFeatured(featuredPage - 1)}
                          >
                            上一页
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg"
                            disabled={featuredPage * 4 >= featuredTotal || featuredLoading}
                            onClick={() => void loadFeatured(featuredPage + 1)}
                          >
                            {featuredLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            下一页
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                        {(featuredSkills.length > 0 ? featuredSkills : remoteSkills.slice(0, 4)).map((skill) => {
                          const key = skillKey(skill);
                          return (
                            <RemoteSkillCard
                              key={key}
                              skill={skill}
                              installed={installedLookup.get(key) || installedLookup.get(skill.slug) || installedLookup.get(skill.name)}
                              installing={busyKeys.has(key)}
                              onInstall={() => void installSkill(skill)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-base font-semibold text-foreground">{tab === "recommend" ? "推荐" : "SkillHub"}</h2>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {loading ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          刷新中
                        </span>
                      ) : null}
                      第 {page} 页
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                    {remoteSkills.map((skill) => {
                      const key = skillKey(skill);
                      return (
                        <RemoteSkillCard
                          key={key}
                          skill={skill}
                          installed={installedLookup.get(key) || installedLookup.get(skill.slug) || installedLookup.get(skill.name)}
                          installing={busyKeys.has(key)}
                          onInstall={() => void installSkill(skill)}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-5 flex items-center justify-center gap-2">
                    <Button variant="outline" size="sm" className="rounded-lg" disabled={page <= 1 || loading} onClick={() => void loadRemote(page - 1)}>
                      上一页
                    </Button>
                    <Button variant="outline" size="sm" className="rounded-lg" disabled={page * 18 >= total || loading} onClick={() => void loadRemote(page + 1)}>
                      下一页
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
