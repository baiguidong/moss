"use client";

import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { Download, ExternalLink, MoreHorizontal, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shellIpc } from "@/ipc/shell.ipc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import './office-preview.css';

export function OfficePreviewToolbar({
  filePath,
  onRefresh,
  container,
  menuItems,
  children,
  onDownload,
  downloadMenuItems,
  downloadDisabled = false,
}: {
  filePath: string;
  onRefresh: () => void;
  container?: HTMLElement | null;
  menuItems?: ReactNode;
  children?: ReactNode;
  onDownload?: () => void;
  downloadMenuItems?: ReactNode;
  downloadDisabled?: boolean;
}) {
  const actions = (
    <>
      {children}
      {onDownload && <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="h-7 w-7 shrink-0 rounded-md" title="下载与打开" aria-label="下载文件"><Download className="h-4 w-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>下载</DropdownMenuLabel>
          <DropdownMenuItem disabled={downloadDisabled} onSelect={onDownload}><Download className="h-3.5 w-3.5" />另存为原文件（{filePath.split('.').pop()?.toUpperCase()}）</DropdownMenuItem>
          {downloadMenuItems && <><DropdownMenuSeparator />{downloadMenuItems}</>}
        </DropdownMenuContent>
      </DropdownMenu>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="h-7 w-7 shrink-0 rounded-md" title="更多预览操作" aria-label="更多预览操作">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRefresh}><RefreshCw className="h-3.5 w-3.5" />刷新预览</DropdownMenuItem>
          {menuItems ?? <DropdownMenuItem onSelect={() => void shellIpc.openFile(filePath)}><ExternalLink className="h-3.5 w-3.5" />用系统应用打开</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  // The drawer supplies a single row for the title and viewer controls.
  if (container !== undefined) return container ? createPortal(actions, container) : null;

  return (
    <div data-office-toolbar className="flex h-10 shrink-0 items-center justify-end gap-1 border-b border-border/70 px-2">
      {actions}
    </div>
  );
}
