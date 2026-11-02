"use client";

import { Button } from "@/components/ui/button";

export function LibreOfficeInstallPrompt({
  fileType,
  installing,
  percent,
  phase,
  onInstall,
}: {
  fileType: "word" | "excel" | "ppt";
  installing: boolean;
  percent?: number;
  phase?: string;
  onInstall: () => void;
}) {
  const icon = fileType === "word" ? "DOC" : fileType === "excel" ? "XLS" : "PPT";
  const title = fileType === "word" ? "Word" : fileType === "excel" ? "Excel" : "PowerPoint";

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-[28px] border border-amber-400/35 bg-amber-500/10 p-6 text-center shadow-[0_18px_60px_-48px_rgba(0,0,0,0.7)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-white/70 text-sm font-semibold tracking-[0.2em] text-amber-700 dark:bg-black/20 dark:text-amber-200">
          {icon}
        </div>
        <h3 className="mt-4 text-lg font-semibold text-foreground">{title} 高保真页面版式</h3>
        {!installing ? (
          <>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              浏览器预览可以直接使用。若需要尽量保持原始分页、字体和专有对象，可以选择安装 LibreOffice 生成高保真 PDF。
            </p>
            <Button className="mt-5 rounded-full px-5" onClick={onInstall}>
              安装 LibreOffice（可选）
            </Button>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              正在准备高保真页面版式{phase ? ` · ${phase}` : ""}
            </p>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-amber-950/10 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-amber-500 transition-[width] duration-300"
                style={{ width: `${percent ?? 8}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{percent ?? 0}%</p>
          </>
        )}
      </div>
    </div>
  );
}
