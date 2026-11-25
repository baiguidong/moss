"use client";

import * as React from "react";
import { Ellipsis, Copy, ExternalLink, Eye, FileText, FolderOpen, Image, FileCode, FileSpreadsheet, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cleanIpcErrorMessage } from "@/lib/app-notifications";
import { PdfFileIcon } from "@/components/pdf-file-icon";
import type { AssistantOutputFile } from "@/lib/assistant-output-files";

type FileAction = "preview" | "system" | "reveal";

export async function openAssistantOutputFile(file: AssistantOutputFile, action: FileAction, sessionId: string | undefined, workspace: string, remote: boolean, host = window.agentDesktop) {
  if (remote) throw new Error("暂不支持远程文件卡片。");
  if (!sessionId) throw new Error("请先打开此文件所属的会话。");
  // Browser downloads must start inside the original click event. Waiting for
  // an IPC round trip first loses user activation in Chrome on the first try.
  if (action === 'system' && typeof window !== 'undefined' && window.mossWeb) {
    const error = await host.shell.openFile(file.path);
    if (error) throw new Error(error);
    return;
  }
  const [resolution] = await host.preview.resolveFiles({ sessionId, paths: [file.path] });
  if (!resolution || !("file" in resolution)) throw new Error("文件已不存在或无法读取。");
  if (resolution.file.path !== file.path) throw new Error("文件位置已变化，请重新打开会话后重试。");
  const path = resolution.file.path;
  if (action === "reveal") {
    await host.shell.showItemInFolder(path);
  } else if (action === "preview") {
    if (host.presentation) {
      const result = await host.presentation.open({ sessionId, input: { items: [{ path }] } });
      if (!result.ok) throw new Error(result.error || '无法打开文件');
    } else {
      const preview = await host.preview.readFile({ sessionId, filePath: path });
      await host.preview.open({ file: { ...preview, metadata: { ...preview.metadata, sessionId, workspace, originalContent: preview.content, dirty: false } } });
    }
  } else {
    const error = await host.shell.openFile(path);
    if (error) throw new Error(error);
  }
}

function FileIcon({ type }: { type: string }) {
  if (type === "PDF") return <PdfFileIcon className="size-5 text-red-500" />;
  const Icon = /^(PNG|JPE?G|GIF|WEBP|AVIF|SVG|BMP)$/.test(type) ? Image
    : /^(XLSX?|CSV|TSV|ODS|NUMBERS)$/.test(type) ? FileSpreadsheet
    : /^(PPTX?|ODP|KEY)$/.test(type) ? Presentation
    : /^(HTML?|TSX?|JSX?|JSON|PY|CSS)$/.test(type) ? FileCode : FileText;
  return <Icon className="size-4" aria-hidden="true" />;
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
  const extensionStart = file.name.lastIndexOf(".");
  const stem = extensionStart > 0 ? file.name.slice(0, extensionStart) : file.name;
  const extension = extensionStart > 0 ? file.name.slice(extensionStart) : "";
  const status = file.operation === "create" ? "已创建" : file.operation === "update" ? "已更新" : "可查看";
  return (
    <div className="min-w-0">
      <section aria-label={`文件：${file.name}`} className="flex h-[38px] min-w-0 items-center gap-1 rounded-md px-1 hover:bg-muted/40">
        <button type="button" disabled={busy} onClick={() => void act("preview")} aria-label={`在 Moss 中预览 ${file.name}`}
          title={`${file.path}\n${file.type} · ${status}`}
          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md text-left text-sm focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><FileIcon type={file.type} /></span>
          <span className="flex min-w-0"><span className="truncate">{stem}</span><span className="max-w-[45%] shrink-0 truncate">{extension}</span></span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-7 shrink-0 text-muted-foreground" title="打开方式" aria-label={`打开方式：${file.name}`} disabled={busy}>
              <Ellipsis className="size-4" />
            </Button>
          </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void act("preview")}><Eye />Moss 预览<span className="ml-auto pl-3 text-xs text-muted-foreground">默认</span></DropdownMenuItem>
              <DropdownMenuItem disabled={remote} onSelect={() => void act("system")}><ExternalLink />{typeof window !== 'undefined' && window.mossWeb ? '打开或下载文件' : '系统方式打开'}</DropdownMenuItem>
              <DropdownMenuItem disabled={remote} onSelect={() => void act("reveal")}><FolderOpen />文件夹显示</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void act("copy")}><Copy />复制路径</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
      </section>
      {error && <p role="alert" className="mt-1 text-xs text-destructive">无法打开文件：{error}</p>}
    </div>
  );
}
