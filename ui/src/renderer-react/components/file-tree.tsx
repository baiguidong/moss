"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
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
  FolderKanban,
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
  onFocusFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
  onOpenContextMenu: (event: React.MouseEvent, item: FileTreeNode) => void;
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
  onFocusFile,
  onToggleFolder,
  onSelectFile,
  onOpenContextMenu,
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
        onContextMenu={(event) => {
          onFocusFile(item.path);
          onOpenContextMenu(event, item);
        }}
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
            onFocusFile={onFocusFile}
            onToggleFolder={onToggleFolder}
            onSelectFile={onSelectFile}
            onOpenContextMenu={onOpenContextMenu}
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
  onFocusFile,
  onToggleFolder,
  onSelectFile,
  onRefresh,
  onSaveToLibrary,
  projectName,
}: {
  items: FileTreeNode[];
  title: string;
  expandedPaths: Set<string>;
  selectedFilePath: string | null;
  onFocusFile?: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
  onRefresh?: () => void;
  onSaveToLibrary?: (path: string, target?: "personal" | "project") => Promise<void>;
  projectName?: string | null;
}) {
  const [contextMenu, setContextMenu] = React.useState<{
    path: string;
    name: string;
    x: number;
    y: number;
  } | null>(null);

  React.useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const openContextMenu = React.useCallback((event: React.MouseEvent, item: FileTreeNode) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 208;
    const menuHeight = projectName ? 84 : 44;
    setContextMenu({
      path: item.path,
      name: item.name,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    });
  }, [projectName]);

  const saveToLibrary = React.useCallback((target: "personal" | "project") => {
    if (!contextMenu || !onSaveToLibrary) return;
    const path = contextMenu.path;
    setContextMenu(null);
    void onSaveToLibrary(path, target).catch(() => undefined);
  }, [contextMenu, onSaveToLibrary]);

  return (
    <>
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
              onFocusFile={onFocusFile || onSelectFile}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
              onOpenContextMenu={openContextMenu}
            />
          ))
        )}
      </div>

      {contextMenu && onSaveToLibrary ? createPortal(
        <div
          role="menu"
          aria-label={`${contextMenu.name} 文件操作`}
          className="fixed z-[90] w-52 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {projectName ? (
            <button
              type="button"
              role="menuitem"
              className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-accent"
              onClick={() => saveToLibrary("project")}
            >
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">保存到当前项目</span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-accent"
            onClick={() => saveToLibrary("personal")}
          >
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <span>保存到个人资料库</span>
          </button>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
