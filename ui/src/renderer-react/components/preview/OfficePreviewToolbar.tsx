"use client";

import { createPortal } from "react-dom";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shellIpc } from "@/ipc/shell.ipc";

export function OfficePreviewToolbar({
  filePath,
  onRefresh,
  container,
}: {
  filePath: string;
  onRefresh: () => void;
  container?: HTMLElement | null;
}) {
  const actions = (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 rounded-md px-2 text-xs"
        title="刷新预览"
        aria-label="刷新预览"
        onClick={onRefresh}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        刷新
      </Button>
      {container === undefined ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 rounded-md px-2 text-xs"
          onClick={() => void shellIpc.openFile(filePath)}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          用系统应用打开
        </Button>
      ) : null}
    </>
  );

  // A supplied container shares the drawer's toolbar and system-open action.
  // Without one, history previews retain their own compact controls.
  if (container !== undefined) return container ? createPortal(actions, container) : null;

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/70 px-2">
      {actions}
    </div>
  );
}
