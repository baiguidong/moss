"use client";

import * as React from "react";
import {
  ChevronRight,
  FileArchive,
  FileCode2,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType2,
  Film,
  Folder,
  FolderOpen,
  Music,
  Presentation,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { FileTreeNode } from "@/types";

interface FileTreeNodeProps {
  item: FileTreeNode;
  level?: number;
  expandedPaths: Set<string>;
  selectedFilePath: string | null;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
}

type FileIconStyle = {
  Icon: React.ElementType;
  className: string;
};

const FILE_ICONS: Record<string, FileIconStyle> = {
  png: { Icon: FileImage, className: "text-violet-400" },
  jpg: { Icon: FileImage, className: "text-violet-400" },
  jpeg: { Icon: FileImage, className: "text-violet-400" },
  gif: { Icon: FileImage, className: "text-violet-400" },
  webp: { Icon: FileImage, className: "text-violet-400" },
  svg: { Icon: FileImage, className: "text-violet-400" },
  bmp: { Icon: FileImage, className: "text-violet-400" },
  ico: { Icon: FileImage, className: "text-violet-400" },
  pdf: { Icon: FileType2, className: "text-red-500" },
  doc: { Icon: FileText, className: "text-blue-500" },
  docx: { Icon: FileText, className: "text-blue-500" },
  rtf: { Icon: FileText, className: "text-blue-500" },
  odt: { Icon: FileText, className: "text-blue-500" },
  xls: { Icon: FileSpreadsheet, className: "text-green-600" },
  xlsx: { Icon: FileSpreadsheet, className: "text-green-600" },
  csv: { Icon: FileSpreadsheet, className: "text-green-600" },
  ods: { Icon: FileSpreadsheet, className: "text-green-600" },
  ppt: { Icon: Presentation, className: "text-orange-500" },
  pptx: { Icon: Presentation, className: "text-orange-500" },
  odp: { Icon: Presentation, className: "text-orange-500" },
  mp4: { Icon: Film, className: "text-rose-400" },
  mov: { Icon: Film, className: "text-rose-400" },
  avi: { Icon: Film, className: "text-rose-400" },
  mkv: { Icon: Film, className: "text-rose-400" },
  webm: { Icon: Film, className: "text-rose-400" },
  mp3: { Icon: Music, className: "text-emerald-400" },
  wav: { Icon: Music, className: "text-emerald-400" },
  m4a: { Icon: Music, className: "text-emerald-400" },
  flac: { Icon: Music, className: "text-emerald-400" },
  aac: { Icon: Music, className: "text-emerald-400" },
  json: { Icon: FileJson, className: "text-amber-500" },
  yaml: { Icon: FileCode2, className: "text-lime-500" },
  yml: { Icon: FileCode2, className: "text-lime-500" },
  toml: { Icon: FileCode2, className: "text-stone-500" },
  xml: { Icon: FileCode2, className: "text-amber-500" },
  sql: { Icon: FileCode2, className: "text-fuchsia-500" },
  js: { Icon: FileCode2, className: "text-yellow-500" },
  jsx: { Icon: FileCode2, className: "text-yellow-400" },
  ts: { Icon: FileCode2, className: "text-blue-500" },
  tsx: { Icon: FileCode2, className: "text-cyan-400" },
  py: { Icon: FileCode2, className: "text-green-500" },
  go: { Icon: FileCode2, className: "text-cyan-500" },
  rs: { Icon: FileCode2, className: "text-orange-400" },
  java: { Icon: FileCode2, className: "text-red-400" },
  html: { Icon: FileCode2, className: "text-orange-500" },
  css: { Icon: FileCode2, className: "text-blue-500" },
  scss: { Icon: FileCode2, className: "text-pink-500" },
  sh: { Icon: FileCode2, className: "text-emerald-500" },
  bash: { Icon: FileCode2, className: "text-emerald-500" },
  zsh: { Icon: FileCode2, className: "text-emerald-500" },
  md: { Icon: FileText, className: "text-sky-500" },
  markdown: { Icon: FileText, className: "text-sky-500" },
  txt: { Icon: FileText, className: "text-muted-foreground" },
  log: { Icon: FileText, className: "text-muted-foreground" },
  zip: { Icon: FileArchive, className: "text-purple-500" },
  rar: { Icon: FileArchive, className: "text-purple-500" },
  "7z": { Icon: FileArchive, className: "text-purple-500" },
  tar: { Icon: FileArchive, className: "text-purple-500" },
  gz: { Icon: FileArchive, className: "text-purple-500" },
};

function getFileIcon(name: string): FileIconStyle {
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() ?? "" : "";
  if (extension && FILE_ICONS[extension]) {
    return FILE_ICONS[extension];
  }
  return { Icon: FileText, className: "text-muted-foreground/70" };
}

function FileTreeNodeView({
  item,
  level = 0,
  expandedPaths,
  selectedFilePath,
  onToggleFolder,
  onSelectFile,
}: FileTreeNodeProps) {
  const isOpen = expandedPaths.has(item.path);

  if (item.type === "file") {
    const { Icon, className } = getFileIcon(item.name);
    return (
      <div
        className={cn(
          "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
          selectedFilePath === item.path
            ? "bg-primary/10 text-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => onSelectFile(item.path)}
      >
        <Icon className={cn("h-4 w-4 shrink-0", className)} />
        <span className="truncate">{item.name}</span>
      </div>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={() => onToggleFolder(item.path)}>
      <CollapsibleTrigger asChild>
        <div
          className={cn(
            "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors",
            "hover:bg-accent/50"
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
          <FileTreeNodeView
            key={child.id}
            item={child}
            level={level + 1}
            expandedPaths={expandedPaths}
            selectedFilePath={selectedFilePath}
            onToggleFolder={onToggleFolder}
            onSelectFile={onSelectFile}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function FileTree({
  items,
  title,
  expandedPaths,
  selectedFilePath,
  onToggleFolder,
  onSelectFile,
  onRefresh,
}: {
  items: FileTreeNode[];
  title: string;
  expandedPaths: Set<string>;
  selectedFilePath: string | null;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
  onRefresh?: () => void;
}) {
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
      {items.length === 0 ? (
        <div className="px-2 py-4 text-sm text-muted-foreground">没有匹配的文件</div>
      ) : (
        items.map((item) => (
          <FileTreeNodeView
            key={item.id}
            item={item}
            expandedPaths={expandedPaths}
            selectedFilePath={selectedFilePath}
            onToggleFolder={onToggleFolder}
            onSelectFile={onSelectFile}
          />
        ))
      )}
    </div>
  );
}
