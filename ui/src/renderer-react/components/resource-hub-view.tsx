"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SkillHubView } from "@/components/skill-hub-view";
import { ExpertHubView } from "@/components/expert-hub-view";
import type { MainView } from "@/components/app-sidebar";

export type ResourceHubTab = Extract<MainView, "skills" | "experts">;

const RESOURCE_HUB_TABS = [
  { view: "skills", label: "技能" },
  { view: "experts", label: "专家" },
] as const;

export function ResourceHubTabs({
  activeTab,
  onChangeTab,
}: {
  activeTab: ResourceHubTab;
  onChangeTab: (tab: ResourceHubTab) => void;
}) {
  return (
    <div className="-mb-1 shrink-0 bg-background/92 px-4 py-1 sm:px-5">
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto" role="tablist" aria-label="资源分类">
        {RESOURCE_HUB_TABS.map(({ view, label }) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={activeTab === view}
            onClick={() => onChangeTab(view)}
            className={cn(
              "flex h-7 shrink-0 items-center rounded-md px-2.5 text-sm font-semibold transition-colors",
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

export function ResourceHubView({ activeTab, onChangeTab }: {
  activeTab: ResourceHubTab;
  onChangeTab: (tab: ResourceHubTab) => void;
}) {
  return <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
    <ResourceHubTabs activeTab={activeTab} onChangeTab={onChangeTab} />
    <div className="min-h-0 min-w-0 flex-1" role="tabpanel" aria-label={RESOURCE_HUB_TABS.find(({ view }) => view === activeTab)?.label}>
      {activeTab === 'skills' ? <SkillHubView /> : <ExpertHubView />}
    </div>
  </div>;
}
