"use client";

import * as React from "react";
import { ChevronDown, Files } from "lucide-react";
import { AssistantOutputFileCard } from "./assistant-output-file-card";
import { TurnChangeCard } from "./turn-change-card";
import { useToolDisplaySettings } from "./tool-display-settings";
import type { AssistantOutputFile } from "@/lib/assistant-output-files";

export type TurnChangeProps = Pick<React.ComponentProps<typeof TurnChangeCard>, "change" | "rewindSupported" | "rewindDisabledReason">;

export function AssistantOutputFiles({ files, messageId, sessionId, workspace, remote, turnChange }: {
  files: AssistantOutputFile[];
  messageId: string;
  sessionId?: string;
  workspace?: string;
  remote?: boolean;
  turnChange?: TurnChangeProps;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  const [columns, setColumns] = React.useState(1);
  const listId = React.useId();
  const { disclosureOverrides } = useToolDisplaySettings();
  const disclosureKey = `files:${messageId}`;
  const [expanded, setExpanded] = React.useState(() => disclosureOverrides?.get(disclosureKey) ?? false);
  React.useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setColumns(element.clientWidth >= 520 ? 2 : 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const limit = 3 * columns;
  const remaining = files.length - limit;
  const toggle = remaining > 0 && (
    <button type="button" aria-expanded={expanded} aria-controls={listId}
      aria-label={expanded ? "收起文件列表" : `展开剩余 ${remaining} 个文件`} title={expanded ? "收起文件列表" : "展开文件列表"}
      className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-xs tabular-nums text-muted-foreground hover:bg-muted"
      onClick={() => { disclosureOverrides?.set(disclosureKey, !expanded); setExpanded(!expanded); }}>
      {!expanded && remaining}<ChevronDown className={`size-4 ${expanded ? "rotate-180" : ""}`} />
    </button>
  );
  const grid = files.length > 0 && (
    <div id={listId} className={`grid max-h-[min(24rem,45dvh)] gap-x-3 overflow-y-auto px-2 py-0.5 ${columns === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
      {(expanded ? files : files.slice(0, limit)).map(file =>
        <AssistantOutputFileCard key={file.path} file={file} sessionId={sessionId} workspace={workspace} remote={remote} />)}
    </div>
  );
  return <div ref={container} role="group" aria-label="文件列表" className="w-full min-w-0">
    {sessionId && turnChange ? (
      <TurnChangeCard sessionId={sessionId} {...turnChange} inset={false} fileToggle={toggle}>{grid}</TurnChangeCard>
    ) : (
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
        <div className="flex min-h-10 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 text-xs">
          <Files className="size-4 text-muted-foreground" /><span className="flex-1 font-medium">输出文件 {files.length} 个</span>{toggle}
        </div>
        {grid}
      </div>
    )}
  </div>;
}
