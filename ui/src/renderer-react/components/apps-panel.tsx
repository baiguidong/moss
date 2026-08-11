"use client";

import * as React from "react";
import DOMPurify from "dompurify";
import { ExternalLink, History, MonitorPlay, PanelLeft, PanelLeftClose, Pencil, Plug, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppVersion, StoredApp } from "../types";

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AppIcon({ icon, name }: { icon: string; name: string }) {
  if (!icon) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <MonitorPlay className="h-5 w-5" />
      </div>
    );
  }
  // icon is a data URI like "data:image/svg+xml,<svg>...</svg>"
  const rawSvg = icon.replace(/^data:image\/svg\+xml,?/, '');
  const svgContent = DOMPurify.sanitize(rawSvg, { USE_PROFILES: { svg: true, svgFilters: true } });
  return (
    <div
      className="h-10 w-10 shrink-0 overflow-hidden rounded-xl"
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
}

function getAppShortcutKey(app: StoredApp) {
  return app.id || app.name;
}

export function AppsPanel({
  apps,
  versionsByApp,
  onLaunch,
  onDelete,
  onIterate,
  onLoadVersions,
  onRollback,
  sidebarShortcutIds,
  onAddShortcut,
  onRemoveShortcut,
}: {
  apps: StoredApp[];
  versionsByApp: Record<string, AppVersion[]>;
  onLaunch: (name: string) => void;
  onDelete: (name: string) => void;
  onIterate: (name: string) => void;
  onLoadVersions: (name: string) => void;
  onRollback: (name: string, versionId: string) => void;
  sidebarShortcutIds?: Set<string>;
  onAddShortcut?: (name: string) => void;
  onRemoveShortcut?: (name: string) => void;
}) {
  const [expandedAppName, setExpandedAppName] = React.useState<string | null>(null);
  const [detailsAppName, setDetailsAppName] = React.useState<string | null>(null);
  const visibleApps = apps;
  const actionButtonClass = "h-8 min-w-0 gap-1.5 rounded-xl px-2.5 text-xs";
  const compactActionGroupClass = "flex max-w-full flex-wrap items-center gap-2";

  const toggleVersions = (name: string) => {
    setExpandedAppName((current) => {
      const next = current === name ? null : name;
      if (next === name) {
        onLoadVersions(name);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(58,191,129,0.08),transparent_20%),var(--background)]">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {visibleApps.length === 0 ? (
          <div className="flex min-h-[320px] items-center justify-center">
            <div className="max-w-lg rounded-[32px] border border-border/80 bg-card/80 px-8 py-10 text-center shadow-[0_26px_80px_-42px_rgba(0,0,0,0.65)]">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <MonitorPlay className="h-6 w-6" />
              </div>
              <h2 className="mt-5 text-xl font-semibold text-foreground">还没有生成的 App</h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                回到聊天视图，输入需求后点“生成 App”。生成成功后会自动保存到本地，并在这里可再次打开。
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {visibleApps.map((app) => {
              const dependencyCount = Object.keys(app.extensionDependencies || {}).length;
              const runtimeState = app.runtimeStatus?.state || "ready";
              const hasSidebarShortcut = sidebarShortcutIds?.has(getAppShortcutKey(app)) ?? true;
              return (
              <div
                key={app.name}
                className="min-w-0 overflow-hidden rounded-[28px] border border-border/80 bg-card/72 p-5 shadow-[0_20px_70px_-48px_rgba(0,0,0,0.65)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <AppIcon icon={app.icon} name={app.name} />
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold text-foreground">
                        {app.displayName || app.title || app.name}
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {app.description || "未填写描述"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded-full border border-border/70 px-2 py-1">
                    {app.width} × {app.height}
                  </span>
                  <span className="rounded-full border border-border/70 px-2 py-1">
                    {app.resizable ? "可缩放" : "固定尺寸"}
                  </span>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-600 dark:text-emerald-300">
                    当前版本 {app.currentVersion || "---"}
                  </span>
                  <span className="rounded-full border border-border/70 px-2 py-1">
                    {app.versionCount || 0} 个版本
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-sky-700 dark:text-sky-300">
                    <Plug className="h-3 w-3" />
                    {dependencyCount} 个扩展
                  </span>
                  <span className={
                    runtimeState === "ready"
                      ? "inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-600 dark:text-emerald-300"
                      : "inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-600 dark:text-amber-300"
                  }>
                    <ShieldCheck className="h-3 w-3" />
                    {runtimeState === "ready" ? "Ready" : runtimeState}
                  </span>
                  {app.latestVersion && app.latestVersion !== app.currentVersion && (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-600 dark:text-amber-300">
                      最新快照 {app.latestVersion}
                    </span>
                  )}
                  <span className="rounded-full border border-border/70 px-2 py-1">
                    更新于 {formatTimestamp(app.updatedAt)}
                  </span>
                </div>

                <div className={`mt-5 ${compactActionGroupClass}`}>
                  <Button size="sm" className={actionButtonClass} onClick={() => onLaunch(app.name)}>
                    <ExternalLink className="h-4 w-4" />
                    打开
                  </Button>
                  <Button size="sm" variant="outline" className={actionButtonClass} onClick={() => onIterate(app.name)}>
                    <Pencil className="h-4 w-4" />
                    继续迭代
                  </Button>
                  <Button size="sm" variant="outline" className={actionButtonClass} onClick={() => toggleVersions(app.name)}>
                    <History className="h-4 w-4" />
                    版本
                  </Button>
                  {hasSidebarShortcut ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className={actionButtonClass}
                      onClick={() => onRemoveShortcut?.(app.name)}
                      disabled={!onRemoveShortcut}
                    >
                      <PanelLeftClose className="h-4 w-4" />
                      移出侧栏
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className={actionButtonClass}
                      onClick={() => onAddShortcut?.(app.name)}
                      disabled={!onAddShortcut}
                    >
                      <PanelLeft className="h-4 w-4" />
                      加到侧栏
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className={actionButtonClass} onClick={() => onDelete(app.name)}>
                    <Trash2 className="h-4 w-4" />
                    删除
                  </Button>
                </div>
                <div className={`mt-2 ${compactActionGroupClass}`}>
                  <Button size="sm" variant="outline" className={actionButtonClass} onClick={() => setDetailsAppName(detailsAppName === app.name ? null : app.name)}>
                    <Plug className="h-3.5 w-3.5" />
                    扩展依赖
                  </Button>
                  <Button size="sm" variant="outline" className={actionButtonClass} onClick={() => setDetailsAppName(detailsAppName === app.name ? null : app.name)}>
                    <ShieldCheck className="h-3.5 w-3.5" />
                    权限
                  </Button>
                </div>

                {detailsAppName === app.name && (
                  <div className="mt-4 rounded-[22px] border border-border/70 bg-background/60 p-3 text-xs">
                    <div className="font-medium text-foreground">扩展依赖</div>
                    {Object.keys(app.extensionDependencies || {}).length === 0 ? (
                      <div className="mt-2 text-muted-foreground">未声明扩展依赖。</div>
                    ) : (
                      <div className="mt-2 space-y-1 text-muted-foreground">
                        {Object.entries(app.extensionDependencies || {}).map(([id, range]) => (
                          <div key={id} className="flex justify-between gap-3">
                            <span className="truncate">{id}</span>
                            <span className="shrink-0">{range}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 font-medium text-foreground">能力</div>
                    {(app.capabilitySummary || []).length === 0 ? (
                      <div className="mt-2 text-muted-foreground">未声明额外能力。</div>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(app.capabilitySummary || []).map((capability) => (
                          <span key={capability} className="rounded-full border border-border/70 px-2 py-0.5 text-muted-foreground">
                            {capability}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {expandedAppName === app.name && (
                  <div className="mt-4 rounded-[22px] border border-border/70 bg-background/60 p-3">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">版本历史</div>
                    {(versionsByApp[app.name] || []).length === 0 ? (
                      <div className="text-xs text-muted-foreground">还没有加载到版本，或当前只有初始版本。</div>
                    ) : (
                      <div className="space-y-2">
                        {versionsByApp[app.name].map((version) => (
                          <div
                            key={version.id}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
                                <span>{version.version}</span>
                                {version.isCurrent && (
                                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-300">
                                    当前
                                  </span>
                                )}
                                {version.isLatest && (
                                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-300">
                                    最新快照
                                  </span>
                                )}
                                <span className="truncate">{version.reason}</span>
                                {version.extensionLock && Object.keys(version.extensionLock).length > 0 && (
                                  <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">
                                    依赖锁 {Object.keys(version.extensionLock).length}
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-[11px] text-muted-foreground">
                                {formatTimestamp(version.createdAt)} · {version.note || version.description || "无备注"}
                                {version.checksumStatus ? ` · checksum ${version.checksumStatus}` : ""}
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              className="h-8 gap-1.5 px-2 text-xs"
                              disabled={version.isCurrent}
                              onClick={() => onRollback(app.name, version.id)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              {version.isCurrent ? "当前版本" : "回滚"}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )})}
          </div>
        )}
      </div>
    </div>
  );
}
