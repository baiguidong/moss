"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SkillHubView } from "@/components/skill-hub-view";
import { ExpertHubView } from "@/components/expert-hub-view";
import { CommonResourcesView } from "@/components/common-resources-view";
import { ResourceHubSearchTarget } from "@/components/resource-hub-search";
import type { MainView } from "@/components/app-sidebar";
import type { StoredApp } from "../types";

export type ResourceHubTab = Extract<MainView, "skills" | "experts" | "common" | "apps">;

const RESOURCE_HUB_TABS = [
  { view: "common", label: "常用" },
  { view: "skills", label: "技能" },
  { view: "experts", label: "专家" },
  { view: "apps", label: "Apps" },
] as const;

export function ResourceHubTabs({
  activeTab,
  onChangeTab,
}: {
  activeTab: ResourceHubTab;
  onChangeTab: (tab: ResourceHubTab) => void;
}) {
  return (
    <div className="min-w-0 shrink-0 py-1">
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto" role="tablist" aria-label="资源分类">
        {RESOURCE_HUB_TABS.map(({ view, label }) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={activeTab === view}
            onClick={() => onChangeTab(view)}
            className={cn(
              "flex h-7 shrink-0 items-center rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              activeTab === view
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ResourceHubView({ activeTab, onChangeTab, apps, appsContent, onOpenApp }: {
  activeTab: ResourceHubTab;
  onChangeTab: (tab: ResourceHubTab) => void;
  apps?: StoredApp[];
  appsContent: React.ReactNode;
  onOpenApp?: (name: string) => void;
}) {
  const [searchTarget, setSearchTarget] = React.useState<HTMLDivElement | null>(null);

  return <ResourceHubSearchTarget.Provider value={searchTarget}>
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border/50">
        <div className="mx-auto flex w-full max-w-[1180px] items-center gap-3 px-4 py-1.5 sm:gap-6 sm:px-5">
          <ResourceHubTabs activeTab={activeTab} onChangeTab={onChangeTab} />
          <div ref={setSearchTarget} className="flex min-w-0 flex-1 items-center justify-end" />
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1" role="tabpanel" aria-label={RESOURCE_HUB_TABS.find(({ view }) => view === activeTab)?.label}>
        {activeTab === 'common' ? (
          <CommonResourcesView
            apps={apps || []}
            onOpenApp={onOpenApp}
            onOpenSkills={() => onChangeTab('skills')}
            onOpenExperts={() => onChangeTab('experts')}
            onOpenApps={() => onChangeTab('apps')}
          />
        ) : activeTab === 'skills' ? <SkillHubView /> : activeTab === 'experts' ? <ExpertHubView /> : appsContent}
      </div>
    </div>
  </ResourceHubSearchTarget.Provider>;
}
