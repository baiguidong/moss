"use client";

import * as React from "react";
import { ChevronDown, Copy, ExternalLink, Eye, FileText, FolderOpen, Image, FileCode, FileSpreadsheet, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cleanIpcErrorMessage } from "@/lib/app-notifications";
import type { AssistantOutputFile } from "@/lib/assistant-output-files";

type FileAction = "preview" | "system" | "reveal";

export async function openAssistantOutputFile(file: AssistantOutputFile, action: FileAction, sessionId: string | undefined, workspace: string, remote: boolean, host = window.agentDesktop) {
  if (remote) throw new Error("暂不支持远程文件卡片。");
  if (!sessionId) throw new Error("请先打开此文件所属的会话。");
  const [resolution] = await host.preview.resolveFiles({ sessionId, paths: [file.path] });
  if (!resolution || !("file" in resolution)) throw new Error("文件已不存在或无法读取。");
  if (resolution.file.path !== file.path) throw new Error("文件位置已变化，请重新打开会话后重试。");
  const path = resolution.file.path;
  if (action === "reveal") {
    await host.shell.showItemInFolder(path);
  } else if (action === "preview") {
    const preview = await host.preview.readFile({ sessionId, filePath: path });
    await host.preview.open({ file: { ...preview, metadata: { ...preview.metadata, sessionId, workspace, originalContent: preview.content, dirty: false } } });
  } else {
    const error = await host.shell.openFile(path);
    if (error) throw new Error(error);
  }
}

function FileIcon({ type }: { type: string }) {
  const Icon = /^(PNG|JPE?G|GIF|WEBP|AVIF|SVG|BMP)$/.test(type) ? Image
    : /^(XLSX?|CSV|TSV|ODS|NUMBERS)$/.test(type) ? FileSpreadsheet
    : /^(PPTX?|ODP|KEY)$/.test(type) ? Presentation
    : /^(HTML?|TSX?|JSX?|JSON|PY|CSS)$/.test(type) ? FileCode : FileText;
  return <Icon className="h-5 w-5" aria-hidden="true" />;
}

export function AssistantOutputFileCard({ file, sessionId, workspace = "", remote = false }: {
  file: AssistantOutputFile;
  sessionId?: string;
  workspace?: string;
  remote?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  async function act(action: FileAction | "copy") {
    setBusy(true);
    setError("");
    try {
      if (action === "copy") await navigator.clipboard.writeText(file.path);
      else await openAssistantOutputFile(file, action, sessionId, workspace, remote);
    } catch (err) { setError(cleanIpcErrorMessage(err)); }
    finally { setBusy(false); }
  }
  return (
    <div>
      <section aria-label={`文件：${file.name}`} className="flex w-full items-center overflow-hidden rounded-2xl border border-border/70 bg-muted/35 shadow-sm">
        <button type="button" disabled={busy} onClick={() => void act("preview")} aria-label={`在 Moss 中预览 ${file.name}`}
          className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground"><FileIcon type={file.type} /></span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-semibold" title={file.name}>{file.name}</span>
              <span className="rounded-full border border-border/70 bg-background/50 px-2 py-0.5 text-[10px] font-medium tracking-wider text-muted-foreground">{file.type}</span>
              <span className="text-xs text-muted-foreground">{file.operation === "create" ? "已创建" : "已更新"}</span>
            </span>
            {file.subtitle !== file.name && <span className="truncate text-xs text-muted-foreground" title={file.path}>{file.subtitle}</span>}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5 pr-3">
          <Button variant="outline" size="icon-sm" className="rounded-full" title="Moss 预览" aria-label={`Moss 预览 ${file.name}`} disabled={busy} onClick={() => void act("preview")}><Eye className="h-3.5 w-3.5" /></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="gap-1 rounded-full px-2 sm:px-3" disabled={busy}>打开方式<ChevronDown className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void act("preview")}><Eye />Moss 预览<span className="ml-auto pl-3 text-xs text-muted-foreground">默认</span></DropdownMenuItem>
              <DropdownMenuItem disabled={remote} onSelect={() => void act("system")}><ExternalLink />系统方式打开</DropdownMenuItem>
              <DropdownMenuItem disabled={remote} onSelect={() => void act("reveal")}><FolderOpen />文件夹显示</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void act("copy")}><Copy />复制路径</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>
      {error && <p role="alert" className="mt-1 text-xs text-destructive">无法打开文件：{error}</p>}
    </div>
  );
}
