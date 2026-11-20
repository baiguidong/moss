"use client";

import * as React from "react";
import { ChevronRight, Files } from "lucide-react";
import { AssistantOutputFileCard } from "@/components/chat/assistant-output-file-card";
import { useToolDisplaySettings } from "@/components/chat/tool-display-settings";
import type { AssistantOutputFile } from "@/lib/assistant-output-files";
import { cn } from "@/lib/utils";

const MAX_INLINE_OUTPUT_FILES = 3;

export function AssistantOutputFiles({ files, messageId, sessionId, workspace, remote }: {
  files: AssistantOutputFile[];
  messageId: string;
  sessionId?: string;
  workspace?: string;
  remote?: boolean;
}) {
  const remainingFiles = files.slice(MAX_INLINE_OUTPUT_FILES);
  const listId = React.useId();
  const { disclosureOverrides } = useToolDisplaySettings();
  const disclosureKey = `files:${messageId}`;
  const [expanded, setExpanded] = React.useState(() => disclosureOverrides?.get(disclosureKey) ?? false);
  const renderCard = (file: AssistantOutputFile) => (
    <AssistantOutputFileCard key={file.path} file={file} sessionId={sessionId} workspace={workspace} remote={remote} />
  );

  return (
    <div role="group" aria-label="文件列表" className="w-full min-w-0 space-y-2">
      {files.slice(0, MAX_INLINE_OUTPUT_FILES).map(renderCard)}
      {remainingFiles.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            title={expanded ? "收起文件列表" : "展开文件列表"}
            className="flex min-h-8 w-full items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-2.5 text-left text-xs font-medium text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              disclosureOverrides?.set(disclosureKey, !expanded);
              setExpanded(!expanded);
            }}
          >
            <Files aria-hidden="true" className="size-3.5 text-muted-foreground" />
            {expanded ? "收起" : "展开剩余"} {remainingFiles.length} 个文件
            <ChevronRight aria-hidden="true" className={cn("ml-auto size-3.5 text-muted-foreground transition-transform", expanded && "rotate-90")} />
          </button>
          <div
            id={listId}
            hidden={!expanded}
            role="group"
            aria-label="剩余文件"
            tabIndex={0}
            className="max-h-[min(20rem,45dvh)] w-full min-w-0 space-y-2 overflow-y-auto overscroll-y-contain rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {expanded && remainingFiles.map(renderCard)}
          </div>
        </>
      )}
    </div>
  );
}
