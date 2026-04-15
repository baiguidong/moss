"use client";

import * as React from "react";
import { ChevronRight, Folder, FolderOpen, FileText, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export interface FileTreeItem {
  id: string;
  name: string;
  type: "folder" | "file";
  children?: FileTreeItem[];
}

interface FileTreeNodeProps {
  item: FileTreeItem;
  level?: number;
}

function FileTreeNode({ item, level = 0 }: FileTreeNodeProps) {
  const [isOpen, setIsOpen] = React.useState(level < 2);

  if (item.type === "file") {
    return (
      <div
        className={cn(
          "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
          "hover:bg-accent/50 cursor-pointer text-muted-foreground hover:text-foreground"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        <Plus className="h-3.5 w-3.5 text-amber-500 opacity-70 group-hover:opacity-100" />
        <FileText className="h-4 w-4 text-muted-foreground/70" />
        <span className="truncate">{item.name}</span>
      </div>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div
          className={cn(
            "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer",
            "hover:bg-accent/50 text-foreground"
          )}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200",
              isOpen && "rotate-90"
            )}
          />
          {isOpen ? (
            <FolderOpen className="h-4 w-4 text-amber-500" />
          ) : (
            <Folder className="h-4 w-4 text-amber-500" />
          )}
          <span className="truncate font-medium">{item.name}</span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {item.children?.map((child) => (
          <FileTreeNode key={child.id} item={child} level={level + 1} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface FileTreeProps {
  items: FileTreeItem[];
  title: string;
  onRefresh?: () => void;
}

export function FileTree({ items, title, onRefresh }: FileTreeProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {onRefresh && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onRefresh}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {items.map((item) => (
        <FileTreeNode key={item.id} item={item} />
      ))}
    </div>
  );
}
