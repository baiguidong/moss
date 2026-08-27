"use client";

import * as React from "react";
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  CircleAlert,
  Copy,
  Info,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppNotification, AppNotificationSeverity } from "@/lib/app-notifications";

function formatNotificationTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function SeverityIcon({ severity, className }: { severity: AppNotificationSeverity; className?: string }) {
  if (severity === "error") return <CircleAlert className={cn("text-destructive", className)} />;
  if (severity === "warning") return <TriangleAlert className={cn("text-amber-600 dark:text-amber-400", className)} />;
  return <Info className={cn("text-primary", className)} />;
}

export function NotificationCenter({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onRemove,
  onClear,
  onResolveDecision,
}: {
  notifications: AppNotification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onResolveDecision: (decisionId: string, allowed: boolean, choice?: string) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [resolvingDecisionId, setResolvingDecisionId] = React.useState<string | null>(null);
  const [decisionError, setDecisionError] = React.useState<{ id: string; message: string } | null>(null);
  const unreadCount = notifications.filter((item) => !item.read).length;

  const resolveDecision = (decisionId: string, allowed: boolean, choice?: string) => {
    setDecisionError(null);
    setResolvingDecisionId(decisionId);
    void onResolveDecision(decisionId, allowed, choice)
      .catch((error) => {
        setDecisionError({
          id: decisionId,
          message: error instanceof Error ? error.message : '处理失败，请重试',
        });
      })
      .finally(() => setResolvingDecisionId((current) => (
        current === decisionId ? null : current
      )));
  };

  React.useEffect(() => {
    if (!open) setConfirmClear(false);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const copyNotification = React.useCallback(async (notification: AppNotification) => {
    const text = [
      notification.title,
      `时间：${new Date(notification.createdAt).toLocaleString("zh-CN")}`,
      `来源：${notification.source}`,
      notification.message,
      notification.details || "",
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(notification.id);
      window.setTimeout(() => setCopiedId((current) => current === notification.id ? null : current), 1600);
    } catch {
      setCopiedId(null);
    }
  }, []);

  return (
    <div className="moss-no-drag relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "relative inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          open && "bg-muted text-foreground",
        )}
        title="消息中心"
        aria-label={`消息中心${unreadCount ? `，${unreadCount} 条未读` : ""}`}
        aria-expanded={open}
      >
        <Bell className="h-3.5 w-3.5" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[79] cursor-default bg-transparent"
            aria-label="关闭消息中心"
            onClick={() => setOpen(false)}
          />
          <section
            role="dialog"
            aria-label="消息中心"
            className="fixed right-2 top-10 z-[80] flex max-h-[min(660px,calc(100vh-48px))] w-[min(420px,calc(100vw-16px))] flex-col overflow-hidden rounded-md border border-border bg-background shadow-2xl"
          >
            <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-foreground">消息中心</h2>
                <p className="text-[10px] text-muted-foreground">
                  {notifications.length} 条记录{unreadCount ? `，${unreadCount} 条未读` : ""}
                </p>
              </div>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="全部标为已读"
                  aria-label="全部标为已读"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {notifications.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!confirmClear) {
                      setConfirmClear(true);
                      return;
                    }
                    onClear();
                    setConfirmClear(false);
                  }}
                  className={cn(
                    "h-7 rounded px-2 text-[11px] transition-colors",
                    confirmClear
                      ? "bg-destructive text-white hover:bg-destructive/90"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  title={confirmClear ? "再次点击确认清空" : "清空历史"}
                >
                  {confirmClear ? "确认清空" : "清空"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                title="关闭"
                aria-label="关闭消息中心"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex h-56 flex-col items-center justify-center gap-2 text-muted-foreground">
                  <BellOff className="h-6 w-6 opacity-50" />
                  <span className="text-xs">暂无消息</span>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {notifications.map((notification) => (
                    <article
                      key={notification.id}
                      className={cn(
                        "relative px-3 py-3",
                        !notification.read && "bg-muted/35",
                      )}
                      onClick={() => onMarkRead(notification.id)}
                    >
                      <div className="flex items-start gap-2.5">
                        <SeverityIcon severity={notification.severity} className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-start gap-2">
                            <h3 className="min-w-0 flex-1 break-words text-xs font-semibold text-foreground">
                              {notification.title}
                            </h3>
                            {!notification.read ? (
                              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="未读" />
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
                            <span>{notification.source}</span>
                            <time dateTime={new Date(notification.createdAt).toISOString()}>
                              {formatNotificationTime(notification.createdAt)}
                            </time>
                            {notification.occurrences > 1 ? <span>重复 {notification.occurrences} 次</span> : null}
                          </div>
                          <p className="mt-1.5 break-words text-xs leading-5 text-foreground/85">
                            {notification.message}
                          </p>
                          {notification.details ? (
                            <details className="mt-1.5 text-[11px] text-muted-foreground">
                              <summary className="cursor-pointer select-none hover:text-foreground">查看诊断详情</summary>
                              <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/55 p-2 font-mono text-[10px] leading-4 text-foreground/80">
                                {notification.details}
                              </pre>
                            </details>
                          ) : null}
                          {notification.decisionRequestId ? (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={resolvingDecisionId === notification.decisionRequestId}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  resolveDecision(notification.decisionRequestId!, true);
                                }}
                                className="inline-flex h-7 items-center gap-1 rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                              >
                                <Check className="h-3 w-3" />
                                允许
                              </button>
                              {(notification.decisionOptions ?? []).map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  disabled={resolvingDecisionId === notification.decisionRequestId}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    resolveDecision(
                                      notification.decisionRequestId!,
                                      true,
                                      option.id,
                                    );
                                  }}
                                  className="inline-flex h-7 items-center rounded border border-border px-2 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                                >
                                  {option.label}
                                </button>
                              ))}
                              <button
                                type="button"
                                disabled={resolvingDecisionId === notification.decisionRequestId}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  resolveDecision(notification.decisionRequestId!, false);
                                }}
                                className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                              >
                                <X className="h-3 w-3" />
                                拒绝
                              </button>
                            </div>
                          ) : null}
                          {notification.decisionRequestId
                            && decisionError?.id === notification.decisionRequestId ? (
                              <p className="mt-1 text-[11px] text-destructive">{decisionError.message}</p>
                            ) : null}
                        </div>
                        <div className="flex shrink-0 items-center">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void copyNotification(notification);
                            }}
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                            title={copiedId === notification.id ? "已复制" : "复制诊断信息"}
                            aria-label={copiedId === notification.id ? "已复制" : "复制诊断信息"}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                          {!notification.decisionRequestId ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onRemove(notification.id);
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title="删除这条消息"
                              aria-label="删除这条消息"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

export function NotificationToast({
  message,
  severity = "info",
  onDismiss,
}: {
  message: string;
  severity?: AppNotificationSeverity;
  onDismiss: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role={severity === "error" ? "alert" : "status"}
      className="pointer-events-auto flex max-w-md items-start gap-2 rounded-md border border-border bg-background/95 px-3 py-2 text-xs text-foreground shadow-xl backdrop-blur"
    >
      <SeverityIcon severity={severity} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 break-words leading-5">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        title="关闭"
        aria-label="关闭消息"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
