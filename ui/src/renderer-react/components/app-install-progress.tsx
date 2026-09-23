import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import { cleanIpcErrorMessage } from "@/lib/app-notifications";
import { isAppInstallActive } from "@/lib/app-install-progress";
import type { AppInstallProgress } from "../types";

const phaseLabels: Record<AppInstallProgress["phase"], string> = {
  preparing: "正在准备安装",
  downloading: "正在下载",
  verifying: "正在校验安装包",
  extracting: "正在解压安装包",
  validating: "正在验证应用签名",
  "awaiting-permission": "等待权限确认",
  installing: "正在安装应用文件",
  activating: "正在应用新版本",
  "rolling-back": "正在恢复原版本",
  completed: "安装完成",
  error: "安装失败",
  canceled: "已取消安装",
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function AppInstallProgressView({ progress }: { progress: AppInstallProgress }) {
  if (progress.phase === "canceled") return null;
  const active = isAppInstallActive(progress);
  const downloading = progress.phase === "downloading";
  const total = Number.isFinite(progress.totalBytes) && progress.totalBytes! > 0 ? progress.totalBytes! : null;
  const received = Math.max(0, progress.receivedBytes || 0);
  const percent = downloading && total ? Math.min(100, Math.floor(received / total * 100)) : undefined;
  const label = phaseLabels[progress.phase];
  const failed = progress.phase === "error";

  return (
    <div className={`grid gap-2 rounded-md border px-3 py-2.5 text-xs ${failed ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-border bg-muted/30"}`}>
      {progress.fileName && <div className="truncate text-muted-foreground" title={progress.fileName}>{progress.fileName}</div>}
      <div className="flex items-center justify-between gap-3">
        <span role="status" className="flex items-center gap-1.5">
          {active ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : failed ? <AlertCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
          {label}
        </span>
        {downloading && <span className="shrink-0 tabular-nums text-muted-foreground">{percent === undefined ? "" : `${percent}% · `}{formatBytes(received)}{total ? ` / ${formatBytes(total)}` : ""}</span>}
        {!downloading && progress.version && <span className="text-muted-foreground">v{progress.version}</span>}
      </div>
      {active && <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-primary/10">
        <div className={`h-full rounded-full bg-primary ${percent === undefined ? "w-1/3 animate-pulse" : "transition-[width] duration-150"}`} style={percent === undefined ? undefined : { width: `${percent}%` }} />
      </div>}
      {failed && progress.error && <div className="break-words">{cleanIpcErrorMessage(progress.error)}</div>}
    </div>
  );
}
