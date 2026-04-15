"use client";

import * as React from "react";
import { ExternalLink, History, MonitorPlay, Pencil, RotateCcw, Trash2 } from "lucide-react";
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

function formatAppName(name: string) {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function AppsPanel({
  apps,
  versionsByApp,
  onLaunch,
  onDelete,
  onIterate,
  onLoadVersions,
  onRollback,
}: {
  apps: StoredApp[];
  versionsByApp: Record<string, AppVersion[]>;
  onLaunch: (name: string) => void;
  onDelete: (name: string) => void;
  onIterate: (name: string) => void;
  onLoadVersions: (name: string) => void;
  onRollback: (name: string, versionId: string) => void;
}) {
  const [expandedAppName, setExpandedAppName] = React.useState<string | null>(null);

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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">Apps</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          这里展示当前会话通过本地 agent 生成并保存的单文件 HTML apps。打开后可通过
          <code className="mx-1 rounded bg-background px-1.5 py-0.5 text-xs">window.gooseApp</code>
          访问宿主的存储、文件和 agent 能力。
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {apps.length === 0 ? (
          <div className="flex min-h-[320px] items-center justify-center">
            <div className="max-w-lg rounded-3xl border border-border/80 bg-card/80 px-8 py-10 text-center">
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
            {apps.map((app) => (
              <div
                key={app.name}
                className="rounded-2xl border border-border/80 bg-card/70 p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-foreground">
                      {formatAppName(app.name)}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {app.description || "未填写描述"}
                    </p>
                  </div>
                  <div className="rounded-full border border-border/80 bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                    {app.width} × {app.height}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded-full border border-border/70 px-2 py-1">
                    {app.resizable ? "可缩放" : "固定尺寸"}
                  </span>
                  <span className="rounded-full border border-border/70 px-2 py-1">
                    {app.versionCount || 0} 个版本
                  </span>
                  <span className="rounded-full border border-border/70 px-2 py-1">
                    更新于 {formatTimestamp(app.updatedAt)}
                  </span>
                </div>

                <div className="mt-5 flex items-center gap-2">
                  <Button className="gap-2" onClick={() => onLaunch(app.name)}>
                    <ExternalLink className="h-4 w-4" />
                    打开
                  </Button>
                  <Button variant="outline" className="gap-2" onClick={() => onIterate(app.name)}>
                    <Pencil className="h-4 w-4" />
                    继续迭代
                  </Button>
                  <Button variant="outline" className="gap-2" onClick={() => toggleVersions(app.name)}>
                    <History className="h-4 w-4" />
                    版本
                  </Button>
                  <Button variant="outline" className="gap-2" onClick={() => onDelete(app.name)}>
                    <Trash2 className="h-4 w-4" />
                    删除
                  </Button>
                </div>

                {expandedAppName === app.name && (
                  <div className="mt-4 rounded-2xl border border-border/70 bg-background/60 p-3">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">版本历史</div>
                    {(versionsByApp[app.name] || []).length === 0 ? (
                      <div className="text-xs text-muted-foreground">还没有加载到版本，或当前只有初始版本。</div>
                    ) : (
                      <div className="space-y-2">
                        {versionsByApp[app.name].map((version) => (
                          <div
                            key={version.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-xs font-medium text-foreground">
                                {version.reason}
                              </div>
                              <div className="truncate text-[11px] text-muted-foreground">
                                {formatTimestamp(version.createdAt)} · {version.note || version.description || "无备注"}
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              className="h-8 gap-1.5 px-2 text-xs"
                              onClick={() => onRollback(app.name, version.id)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              回滚
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
