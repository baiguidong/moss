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

type SkillTab = "hub" | "installed";
type SkillSortMode = "score" | "downloads" | "updated_at" | "installs";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function displayText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    return text && text !== "[object Object]" ? text : "";
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = displayText(entry);
      if (text) return text;
    }
    return "";
  }
  if (!isRecord(value)) return "";

  const keys = [
    "zh",
    "zhCN",
    "zh-CN",
    "nameZh",
    "displayNameZh",
    "titleZh",
    "labelZh",
    "displayName",
    "display_name",
    "name",
    "title",
    "label",
    "value",
    "en",
    "enUS",
    "en-US",
    "key",
    "id",
    "slug",
  ];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const text = displayText(value[key]);
    if (text) return text;
  }
  for (const entry of Object.values(value)) {
    if (entry !== null && typeof entry === "object") continue;
    const text = displayText(entry);
    if (text) return text;
  }
  return "";
}

function displayCategory(category: unknown, categoryNameByKey: Map<string, string>) {
  const text = displayText(category);
  return categoryNameByKey.get(text) || text;
}

function displayCategories(
  skill: Pick<RemoteSkill | InstalledSkill, "category" | "categories">,
  categoryNameByKey: Map<string, string>,
) {
  const values = [
    ...(Array.isArray(skill.categories) ? skill.categories : []),
    skill.category,
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = displayCategory(value, categoryNameByKey);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function skillKey(skill: Pick<RemoteSkill, "id" | "slug" | "name" | "namespace">) {
  const slug = displayText(skill.slug) || displayText(skill.name);
  const handle = displayText(skill.namespace?.handle);
  return displayText(skill.id)
    || displayText(skill.namespace?.canonicalName)
    || (handle && slug ? `@${handle}/${slug}` : "")
    || slug;
}

function installedKeys(skill: InstalledSkill) {
  return [
    skill.id,
    skill.slug,
    skill.name,
    skill.displayName,
    skill.namespace?.canonicalName,
    skill.namespace?.handle && skill.slug ? `@${skill.namespace.handle}/${skill.slug}` : "",
  ].map(displayText).filter(Boolean);
}

function formatCount(value?: number) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  return String(n);
}

function SkillIcon({ skill }: { skill: Pick<RemoteSkill | InstalledSkill, "icon" | "displayName" | "name"> }) {
  const [failed, setFailed] = React.useState(false);
  const name = displayText(skill.displayName) || displayText(skill.name) || "Skill";
  if (skill.icon && !failed) {
    return (
      <img
        src={skill.icon}
        alt=""
        className="h-9 w-9 rounded-lg object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <Hammer className="h-4.5 w-4.5" />
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

function RemoteSkillCard({
  skill,
  installed,
  installing,
  onInstall,
  categoryNameByKey,
}: {
  skill: RemoteSkill;
  installed?: InstalledSkill;
  installing: boolean;
  onInstall: () => void;
  categoryNameByKey: Map<string, string>;
}) {
  const name = displayText(skill.displayName) || displayText(skill.name) || "Skill";
  const owner = displayText(skill.ownerName)
    || displayText(skill.namespace?.displayName)
    || displayText(skill.namespace?.handle)
    || displayText(skill.source)
    || "SkillHub";
  const description = displayText(skill.description) || "暂无描述";
  const version = displayText(skill.version);
  const categories = displayCategories(skill, categoryNameByKey);
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-card/82 p-2.5 shadow-[0_16px_48px_-40px_rgba(0,0,0,0.55)]">
      <div className="flex min-w-0 items-start gap-2.5">
        <SkillIcon skill={skill} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground" title={name}>
                {name}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {owner}
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
          <p className="mt-2 h-9 overflow-hidden text-xs leading-[18px] text-muted-foreground">
            {description}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
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
          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5" />
              {formatCount(skill.stars)}
            </span>
            <span>下载 {formatCount(skill.downloads)}</span>
            <span className="truncate">v{version || "-"}</span>
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
  categoryNameByKey,
}: {
  skill: InstalledSkill;
  busy: boolean;
  onUninstall: () => void;
  categoryNameByKey: Map<string, string>;
}) {
  const name = displayText(skill.displayName) || displayText(skill.name) || "Skill";
  const description = displayText(skill.description) || "暂无描述";
  const version = displayText(skill.version);
  const categories = displayCategories(skill, categoryNameByKey);
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-card/82 p-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <SkillIcon skill={skill} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground" title={name}>
                {name}
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
          <p className="mt-2 h-9 overflow-hidden text-xs leading-[18px] text-muted-foreground">
            {description}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {categories.slice(0, 3).map((category) => (
              <Badge key={category} variant="outline" className="rounded-md text-[11px]">
                {category}
              </Badge>
            ))}
          </div>
          <div className="mt-2 truncate text-[11px] text-muted-foreground">
            v{version || "-"} · {displayText(skill.source)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkillHubView() {
  const [tab, setTab] = React.useState<SkillTab>("hub");
  const [sortMode, setSortMode] = React.useState<SkillSortMode>("downloads");
  const [query, setQuery] = React.useState("");
  const deferredQuery = React.useDeferredValue(query.trim());
  const [category, setCategory] = React.useState("");
  const [categories, setCategories] = React.useState<SkillCategory[]>([]);
  const [remoteSkills, setRemoteSkills] = React.useState<RemoteSkill[]>([]);
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

  const categoryNameByKey = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const item of categories) {
      const key = displayText(item.key);
      const name = displayText(item.name) || key;
      if (key && name) map.set(key, name);
    }
    return map;
  }, [categories]);

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
        sortBy: sortMode,
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
  }, [category, deferredQuery, sortMode, tab]);

  React.useEffect(() => {
    void loadInstalled();
    void loadCategories();
  }, [loadCategories, loadInstalled]);

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
      flashNotice(`已安装 ${displayText(skill.displayName) || displayText(skill.name)}`);
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
      flashNotice(`已卸载 ${displayText(skill.displayName) || displayText(skill.name)}`);
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
      const skillCategories = [
        displayText(skill.category),
        ...(Array.isArray(skill.categories) ? skill.categories.map(displayText) : []),
      ].filter(Boolean);
      const selectedCategoryName = categoryNameByKey.get(category) || category;
      if (category && !skillCategories.includes(category) && !skillCategories.includes(selectedCategoryName)) return false;
      if (!q) return true;
      return [skill.name, skill.displayName, skill.description, skill.ownerName].map(displayText).join(" ").toLowerCase().includes(q);
    });
  }, [category, categoryNameByKey, deferredQuery, installedSkills]);

  const tabs: Array<{ id: SkillTab; label: string }> = [
    { id: "hub", label: "SkillHub" },
    { id: "installed", label: "我安装的" },
  ];
  const sortOptions: Array<{ id: SkillSortMode; label: string }> = [
    { id: "score", label: "综合评分" },
    { id: "downloads", label: "下载量" },
    { id: "updated_at", label: "最近更新" },
    { id: "installs", label: "安装量" },
  ];

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
                {item.label}{item.id === "installed" ? ` ${installedSkills.length}` : ""}
              </button>
            ))}
          </div>
          {notice ? (
            <div className="min-w-[120px] flex-1 truncate text-xs text-muted-foreground">{notice}</div>
          ) : (
            <div className="hidden min-w-[80px] flex-1 truncate text-xs text-muted-foreground sm:block">
              {tab === "installed" ? `${visibleInstalledSkills.length} 个已安装` : `${formatCount(total)} 个 Skill`}
            </div>
          )}
          <div className="relative ml-auto w-full sm:w-[300px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 rounded-lg pl-9 text-sm"
              placeholder={tab === "installed" ? "搜索已安装技能" : "搜索 Skill 名称或描述"}
            />
          </div>
          <Button variant="outline" size="sm" className="h-8 rounded-lg px-3 text-xs" onClick={importLocal}>
            <Upload className="h-4 w-4" />
            添加技能
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="h-8 w-8 rounded-lg"
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
        <div className="mx-auto w-full max-w-[1180px] px-4 py-2.5 sm:px-5">
          <div className="flex gap-2 overflow-x-auto pb-1">
            <CategoryChip active={!category} onClick={() => setCategory("")}>
              全部分类
            </CategoryChip>
            {categories.map((item) => (
              <CategoryChip key={displayText(item.key)} active={category === displayText(item.key)} onClick={() => setCategory(displayText(item.key))}>
                {displayText(item.name) || displayText(item.key)}
              </CategoryChip>
            ))}
          </div>
          {tab === "hub" ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex h-7 shrink-0 items-center gap-0.5 rounded-md bg-muted/70 p-0.5">
                {sortOptions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSortMode(item.id);
                      setPage(1);
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
              <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                第 {page} 页
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {tab === "installed" ? (
            <div className="mt-3">
              {installedLoading ? (
                <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  加载中...
                </div>
              ) : visibleInstalledSkills.length === 0 ? (
                <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                  暂无已安装技能
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                  {visibleInstalledSkills.map((skill) => (
                    <InstalledSkillCard
                      key={skill.source}
                      skill={skill}
                      busy={busyKeys.has(skill.source)}
                      onUninstall={() => void uninstallSkill(skill)}
                      categoryNameByKey={categoryNameByKey}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3">
              {loading && remoteSkills.length === 0 ? (
                <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  加载中...
                </div>
              ) : remoteSkills.length === 0 ? (
                <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                  没有找到匹配的 Skill
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                    {remoteSkills.map((skill) => {
                      const key = skillKey(skill);
                      return (
                        <RemoteSkillCard
                          key={key}
                          skill={skill}
                          installed={installedLookup.get(key) || installedLookup.get(skill.slug) || installedLookup.get(skill.name)}
                          installing={busyKeys.has(key)}
                          onInstall={() => void installSkill(skill)}
                          categoryNameByKey={categoryNameByKey}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <Button variant="outline" size="sm" className="h-8 rounded-lg px-3 text-xs" disabled={page <= 1 || loading} onClick={() => void loadRemote(page - 1)}>
                      上一页
                    </Button>
                    <Button variant="outline" size="sm" className="h-8 rounded-lg px-3 text-xs" disabled={page * 18 >= total || loading} onClick={() => void loadRemote(page + 1)}>
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
