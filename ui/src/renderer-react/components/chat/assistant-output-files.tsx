"use client";

import * as React from "react";
import { ChevronRight, Files } from "lucide-react";
import { AssistantOutputFileCard } from "@/components/chat/assistant-output-file-card";
import { useToolDisplaySettings } from "@/components/chat/tool-display-settings";
import type { AssistantOutputFile } from "@/lib/assistant-output-files";
import { cn } from "@/lib/utils";

export const MAX_INLINE_OUTPUT_FILES = 3;

export function AssistantOutputFiles({ files, messageId, sessionId, workspace, remote, besideTools }: {
  files: AssistantOutputFile[];
  messageId: string;
  sessionId?: string;
  workspace?: string;
  remote?: boolean;
  besideTools?: boolean;
}) {
  const grouped = files.length > MAX_INLINE_OUTPUT_FILES;
  const listId = React.useId();
  const { disclosureOverrides } = useToolDisplaySettings();
  const disclosureKey = `files:${messageId}`;
  const [expanded, setExpanded] = React.useState(() => disclosureOverrides?.get(disclosureKey) ?? false);
  const visible = !grouped || expanded;

  return (
    <>
      {grouped && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          title={expanded ? "收起文件列表" : "展开文件列表"}
          className="inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            disclosureOverrides?.set(disclosureKey, !expanded);
            setExpanded(!expanded);
          }}
        >
          <Files aria-hidden="true" className="size-3.5" />
          {files.length} 个文件
          <ChevronRight aria-hidden="true" className={cn("size-3 transition-transform", expanded && "rotate-90")} />
        </button>
      )}
      <div
        id={listId}
        hidden={!visible}
        role="group"
        aria-label="文件列表"
        tabIndex={grouped ? 0 : undefined}
        className={cn(
          "w-full min-w-0 space-y-2",
          grouped && "max-h-[min(20rem,45dvh)] overflow-y-auto overscroll-y-contain rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          besideTools && "col-span-full pl-[var(--assistant-content-inset,36px)]",
        )}
      >
        {visible && files.map((file) => (
          <AssistantOutputFileCard key={file.path} file={file} sessionId={sessionId} workspace={workspace} remote={remote} />
        ))}
      </div>
    </>
  );
}
