"use client";

import * as React from "react";
import {
  ArrowRight,
  Blocks,
  Bot,
  Hammer,
  Loader2,
  PackageOpen,
  RefreshCw,
  Search,
  UsersRound,
} from "lucide-react";
import { AppIcon } from "@/components/app-icon";
import { ResourceIcon } from "@/components/resource-icon";
import { InstalledResourceDetails } from "@/components/installed-resource-details";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { installedResourceSource, type InstalledSkill, type InstalledExpert, type InstalledResource } from "@/lib/installed-resources";
import type { StoredApp } from "../types";

type CommonResourcesViewProps = {
  apps: StoredApp[];
  onOpenSkills?: () => void;
  onOpenExperts?: () => void;
  onOpenApps?: () => void;
  onOpenApp?: (name: string) => void;
};

function displayText(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function firstText(...values: unknown[]) {
  return values.map(displayText).find(Boolean) || "";
}

function searchableText(...values: unknown[]) {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map(displayText)
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("zh-CN");
}

function ResourceCard({
  icon,
  title,
  subtitle,
  description,
  meta,
  badges = [],
  onOpen,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  meta: string;
  badges?: string[];
  onOpen?: () => void;
}) {
  const Card = onOpen ? 'button' : 'div';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Card
          type={onOpen ? 'button' : undefined}
          tabIndex={0}
          role={onOpen ? undefined : 'group'}
          onClick={onOpen}
          aria-label={onOpen ? `打开 ${title}` : `${title}，悬停或聚焦查看详情`}
          className={cn("group flex h-12 min-w-0 items-center gap-2 rounded-xl border border-border/65 bg-card/70 px-2.5 text-left transition-colors hover:border-primary/35 hover:bg-card focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25", onOpen && "cursor-pointer")}
        >
          <span className="shrink-0">{icon}</span>
          <span className="min-w-0 truncate text-xs font-medium text-foreground" title={title}>{title}</span>
        </Card>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="max-w-80 border border-border/80 bg-popover px-3 py-2.5 text-popover-foreground shadow-xl [&>svg]:bg-popover [&>svg]:fill-popover"
      >
        <div className="space-y-1.5">
          <div className="font-semibold leading-5">{title}</div>
          {subtitle ? <div className="text-[11px] text-muted-foreground">{subtitle}</div> : null}
          <p className="text-xs leading-5 text-muted-foreground">{description || "暂无描述"}</p>
          {badges.length || meta ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 pt-0.5">
              {badges.map((badge, index) => (
                <Badge key={`${badge}-${index}`} variant="outline" className="rounded-md text-[11px]">{badge}</Badge>
              ))}
              {meta ? <span className="truncate text-[11px] text-muted-foreground">{meta}</span> : null}
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function ResourceGroup({
  id,
  icon: Icon,
  title,
  count,
  actionLabel,
  onAction,
  children,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  actionLabel: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section data-resource-group={id} aria-labelledby={`common-resource-${id}`}>
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <h2 id={`common-resource-${id}`} className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">{count}</span>
        {onAction ? (
          <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 rounded-lg px-2 text-xs text-muted-foreground" onClick={onAction}>
            {actionLabel}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function EmptyResourceGroup({ label }: { label: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/15 px-4 text-sm text-muted-foreground">
      暂无已安装{label}
    </div>
  );
}

export function CommonResourcesView({ apps, onOpenSkills, onOpenExperts, onOpenApps, onOpenApp }: CommonResourcesViewProps) {
  const [installedSkills, setInstalledSkills] = React.useState<InstalledSkill[]>([]);
  const [installedExperts, setInstalledExperts] = React.useState<InstalledExpert[]>([]);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [selected, setSelected] = React.useState<InstalledResource | null>(null);
  const selectedTrigger = React.useRef<HTMLElement | null>(null);
  const openResource = (resource: InstalledResource) => {
    selectedTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(resource);
  };
  React.useEffect(() => {
    if (!selected) selectedTrigger.current?.focus({ preventScroll: true });
  }, [selected]);

  const loadInstalled = React.useCallback(async () => {
    setLoading(true);
    setError("");
    const [skillsResult, expertsResult] = await Promise.allSettled([
      window.agentDesktop.skillHub.getInstalled(),
      window.agentDesktop.expertHub.getInstalled(),
    ]);
    const errors: string[] = [];
    if (skillsResult.status === "fulfilled" && skillsResult.value?.success) {
      setInstalledSkills(Array.isArray(skillsResult.value.data) ? skillsResult.value.data as InstalledSkill[] : []);
    } else {
      setInstalledSkills([]);
      errors.push(skillsResult.status === "fulfilled" ? skillsResult.value?.error || "技能加载失败" : "技能加载失败");
    }
    if (expertsResult.status === "fulfilled" && expertsResult.value?.success) {
      setInstalledExperts(Array.isArray(expertsResult.value.data) ? expertsResult.value.data as InstalledExpert[] : []);
    } else {
      setInstalledExperts([]);
      errors.push(expertsResult.status === "fulfilled" ? expertsResult.value?.error || "专家加载失败" : "专家加载失败");
    }
    setError(errors.join("；"));
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void loadInstalled();
  }, [loadInstalled]);

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visibleSkills = React.useMemo(() => installedSkills.filter((skill) => !normalizedQuery || searchableText(
    skill.id,
    skill.name,
    skill.displayName,
    skill.description,
    skill.category,
    skill.categories,
  ).includes(normalizedQuery)), [installedSkills, normalizedQuery]);
  const visibleExperts = React.useMemo(() => installedExperts.filter((expert) => !normalizedQuery || searchableText(
    expert.id,
    expert.name,
    expert.displayName,
    expert.profession,
    expert.description,
    expert.categoryName,
    expert.plugin,
    expert.agentName,
    expert.tags,
  ).includes(normalizedQuery)), [installedExperts, normalizedQuery]);
  const visibleApps = React.useMemo(() => apps.filter((app) => !normalizedQuery || searchableText(
    app.id,
    app.name,
    app.displayName,
    app.title,
    app.description,
    app.category,
    app.keywords,
  ).includes(normalizedQuery)), [apps, normalizedQuery]);

  return (
    <>
    <div data-resource-common className={cn("h-full min-h-0 flex-col bg-background", selected ? "hidden" : "flex")}>
      <div className="shrink-0 border-b border-border/70 bg-background/92 px-4 py-2.5 backdrop-blur sm:px-5">
        <div className="mx-auto flex w-full max-w-[1180px] items-center gap-2">
          <div className="relative w-full max-w-[560px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 rounded-xl bg-muted/45 pl-9 text-sm"
              placeholder="搜索资源"
              aria-label="搜索资源"
            />
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            className="h-8 w-8 shrink-0 rounded-lg"
            onClick={() => void loadInstalled()}
            disabled={loading}
            title="刷新已安装资源"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[1180px] space-y-6 px-4 py-5 sm:px-5">
          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground" role="status">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在读取已安装资源…
            </div>
          ) : (
            <>
              <ResourceGroup id="skills" icon={Hammer} title="技能" count={visibleSkills.length} actionLabel="管理技能" onAction={onOpenSkills}>
                {visibleSkills.length ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
                    {visibleSkills.map((skill, index) => {
                      const title = firstText(skill.displayName, skill.name, skill.id) || "未命名技能";
                      const categories = [skill.category, ...(skill.categories || [])].map(displayText).filter(Boolean).slice(0, 2);
                      return (
                        <ResourceCard
                          key={skill.source || skill.id || skill.name || index}
                          onOpen={() => openResource({ kind: 'skill', item: skill })}
                          icon={<ResourceIcon source={skill.icon} label={title} fallback={Hammer} />}
                          title={title}
                          subtitle={installedResourceSource({ kind: 'skill', item: skill })}
                          description={displayText(skill.description)}
                          meta={skill.version ? `v${skill.version}` : ""}
                          badges={categories}
                        />
                      );
                    })}
                  </div>
                ) : <EmptyResourceGroup label="技能" />}
              </ResourceGroup>

              <ResourceGroup id="experts" icon={Bot} title="专家" count={visibleExperts.length} actionLabel="管理专家" onAction={onOpenExperts}>
                {visibleExperts.length ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
                    {visibleExperts.map((expert, index) => {
                      const title = firstText(expert.displayName, expert.name, expert.id) || "未命名专家";
                      const typeLabel = expert.type === "team" ? `专家团${expert.members?.length ? ` · ${expert.members.length} 人` : ""}` : "专家";
                      return (
                        <ResourceCard
                          key={expert.source || expert.id || expert.name || index}
                          onOpen={() => openResource({ kind: 'expert', item: expert })}
                          icon={<ResourceIcon source={expert.avatar} label={title} fallback={expert.type === "team" ? UsersRound : Bot} />}
                          title={title}
                          subtitle={firstText(expert.profession, expert.categoryName) || typeLabel}
                          description={displayText(expert.description)}
                          meta={installedResourceSource({ kind: 'expert', item: expert })}
                          badges={[typeLabel, ...(expert.tags || []).slice(0, 1)]}
                        />
                      );
                    })}
                  </div>
                ) : <EmptyResourceGroup label="专家" />}
              </ResourceGroup>

              <ResourceGroup id="apps" icon={Blocks} title="应用" count={visibleApps.length} actionLabel="管理应用" onAction={onOpenApps}>
                {visibleApps.length ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
                    {visibleApps.map((app) => {
                      const title = firstText(app.displayName, app.title, app.name) || "未命名应用";
                      return (
                        <ResourceCard
                          key={app.id || app.name}
                          onOpen={onOpenApp ? () => onOpenApp(app.name) : undefined}
                          icon={<AppIcon icon={app.icon} className="h-7 w-7 rounded-lg" />}
                          title={title}
                          subtitle={firstText(app.category, app.currentVersion && `v${app.currentVersion}`) || "Moss App"}
                          description={displayText(app.description)}
                          meta={app.enabled === false ? "已停用" : app.currentVersion ? `v${app.currentVersion}` : "已安装"}
                          badges={app.hasBackend ? ["工具"] : app.hasUi ? ["界面"] : []}
                        />
                      );
                    })}
                  </div>
                ) : <EmptyResourceGroup label="应用" />}
              </ResourceGroup>
            </>
          )}

          {!loading && normalizedQuery && !visibleSkills.length && !visibleExperts.length && !visibleApps.length ? (
            <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/15 text-center">
              <PackageOpen className="h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium text-foreground">没有匹配的已安装资源</p>
              <p className="mt-1 text-xs text-muted-foreground">清空搜索后查看全部已安装内容</p>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
    {selected && <InstalledResourceDetails resource={selected} onBack={() => setSelected(null)} onUninstalled={async () => { await loadInstalled(); setSelected(null); }} />}
    </>
  );
}
