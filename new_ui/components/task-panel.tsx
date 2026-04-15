"use client";

import * as React from "react";
import {
  Search,
  X,
  RefreshCw,
  Cloud,
  Sparkles,
  Inbox,
  FileText,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { SkillGrid } from "@/components/skill-grid";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface DraftItem {
  id: string;
  name: string;
  updatedAt: string;
}

const draftItems: DraftItem[] = [
  { id: "1", name: "会议记录 - 2024.01.15", updatedAt: "2小时前" },
  { id: "2", name: "项目方案初稿", updatedAt: "昨天" },
  { id: "3", name: "周报模板", updatedAt: "3天前" },
];

type TabType = "temp-space" | "skills";

export function TaskPanel() {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<TabType>("temp-space");
  const [draftsOpen, setDraftsOpen] = React.useState(true);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Tabs Header */}
      <div className="border-b border-border">
        <div className="flex">
          <button
            onClick={() => setActiveTab("temp-space")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
              activeTab === "temp-space"
                ? "border-primary bg-primary/5 text-primary"
                : "border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            <Cloud className="h-4 w-4" />
            <span>临时空间</span>
            <Badge
              variant={activeTab === "temp-space" ? "default" : "secondary"}
              className="ml-1 h-5 px-1.5 text-xs"
            >
              {draftItems.length}
            </Badge>
          </button>
          <button
            onClick={() => setActiveTab("skills")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
              activeTab === "skills"
                ? "border-primary bg-primary/5 text-primary"
                : "border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            <Sparkles className="h-4 w-4" />
            <span>可用技能</span>
            <Badge
              variant={activeTab === "skills" ? "default" : "secondary"}
              className="ml-1 h-5 px-1.5 text-xs"
            >
              16
            </Badge>
          </button>
        </div>
      </div>

      {/* Search & Actions */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={
                activeTab === "temp-space" ? "搜索文件..." : "搜索技能..."
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 bg-muted/50 pl-9 pr-8 text-sm placeholder:text-muted-foreground/60"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground",
              isRefreshing && "animate-spin"
            )}
            onClick={handleRefresh}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {activeTab === "temp-space" ? (
          <div className="p-3">
            {/* 草稿箱 Section */}
            <Collapsible open={draftsOpen} onOpenChange={setDraftsOpen}>
              <CollapsibleTrigger asChild>
                <div className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/50">
                  <div className="flex items-center gap-2.5">
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform duration-200",
                        !draftsOpen && "-rotate-90"
                      )}
                    />
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/15">
                      <Inbox className="h-4 w-4 text-amber-500" />
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      草稿箱
                    </span>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {draftItems.length}
                  </Badge>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1 space-y-0.5 pl-9">
                {draftItems.map((item) => (
                  <div
                    key={item.id}
                    className="group flex cursor-pointer items-center justify-between rounded-md px-3 py-2.5 transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-center gap-2.5">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-foreground">
                        {item.name}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      {item.updatedAt}
                    </span>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>

            {/* Empty State for no files */}
            {draftItems.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Inbox className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  暂无草稿
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  在对话中生成的文件将保存在这里
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="p-3">
            <SkillGrid searchQuery={searchQuery} />
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>上次同步: 刚刚</span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-primary"
          >
            {activeTab === "temp-space" ? "管理存储" : "查看全部"}
          </Button>
        </div>
      </div>
    </div>
  );
}
