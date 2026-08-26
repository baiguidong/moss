"use client";

import * as React from "react";
import {
  Cable,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ConnectorCatalogItem, InstalledConnector } from "../types";

type ConnectorTab = "recommend" | "mcp" | "cli" | "installed";

type ConnectorHubPayload = {
  connectors: ConnectorCatalogItem[];
  installed: InstalledConnector[];
  catalogPath: string;
  installedDir: string;
  updatedAt: number;
};

type ConnectorHubViewProps = {
  onConnectorsChanged?: () => void;
  onRunCliSetup?: (connector: InstalledConnector, cli: Record<string, any> | null) => void;
  onAuthenticateMcp?: (connector: InstalledConnector) => void;
};

function connectorIcon(connector: Pick<ConnectorCatalogItem, "type">) {
  if (connector.type === "cli") return Terminal;
  if (connector.type === "mcp") return Plug;
  return Cable;
}

function connectorTypeLabel(connector: ConnectorCatalogItem) {
  if (connector.type === "cli") return "CLI";
  if (connector.type === "mcp") return "MCP";
  return "连接器";
}

function connectorStatusLabel(connector: ConnectorCatalogItem) {
  if (!connector.installed) return "";
  if (connector.connected) return "已连接";
  if (connector.credentialSchema?.fields?.length && !connector.credentialsConfigured) return "待配置";
  if (connector.hasCli && connector.setupStatus === "running") return "安装中";
  if (connector.hasCli && connector.setupStatus === "authenticating") return "认证中";
  if (connector.hasCli && connector.setupStatus === "failed") return "设置失败";
  if (connector.hasCli && connector.setupStatus === "pending") return "待设置";
  if (connector.authMode) return "待授权";
  return "已安装";
}

function ConnectorIcon({
  connector,
  className,
}: {
  connector: Pick<ConnectorCatalogItem, "type" | "icon" | "name">;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const Icon = connectorIcon(connector);
  if (connector.icon && !failed) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background", className)}>
        <img
          src={connector.icon}
          alt=""
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary", className)}>
      <Icon className="h-5 w-5" />
      <span className="sr-only">{connector.name}</span>
    </span>
  );
}

function ConnectorCard({
  connector,
  busy,
  installedRecord,
  onInstall,
  onAuthenticate,
  onUninstall,
}: {
  connector: ConnectorCatalogItem;
  busy: boolean;
  installedRecord?: InstalledConnector;
  onInstall: () => void;
  onAuthenticate: () => void;
  onUninstall: () => void;
}) {
  const installed = Boolean(installedRecord || connector.installed);
  const activeConnector = installedRecord || connector;
  const hasCredentialFields = Boolean(activeConnector.credentialSchema?.fields?.length);
  const canAuthenticate = installed && (
    hasCredentialFields || (!activeConnector.connected && Boolean(activeConnector.hasMcp))
  );
  return (
    <div className="h-[130px] min-w-0 rounded-lg border border-border/70 bg-card/82 p-2.5 shadow-[0_16px_48px_-40px_rgba(0,0,0,0.55)] transition-colors hover:border-border hover:bg-card">
      <div className="flex h-full min-w-0 items-start gap-2.5">
        <ConnectorIcon connector={connector} className="h-9 w-9" />
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground" title={connector.name}>
                {connector.name}
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {connector.nameEn || connector.providerId || connector.source}
              </div>
            </div>
            {installed ? (
              <div className="flex shrink-0 items-center gap-1.5">
                {canAuthenticate ? (
                  <Button
                    size="icon-sm"
                    variant="outline"
                    className="h-8 w-8 rounded-lg"
                    onClick={onAuthenticate}
                    disabled={busy}
                    title={hasCredentialFields ? "配置凭据" : "连接/授权"}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  </Button>
                ) : null}
                <Button
                  size="icon-sm"
                  variant="outline"
                  className="h-8 w-8 rounded-lg"
                  onClick={onUninstall}
                  disabled={busy}
                  title="卸载"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            ) : (
              <Button
                size="icon-sm"
                variant="outline"
                className="h-8 w-8 rounded-lg"
                onClick={onInstall}
                disabled={busy || (!connector.hasMcp && !connector.hasCli && !connector.hasSkills)}
                title={connector.type === "cli" ? "安装并交给 Agent 设置" : "安装"}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </Button>
            )}
          </div>
          <p className="mt-2 h-9 overflow-hidden text-xs leading-[18px] text-muted-foreground">
            {connector.description || "暂无描述"}
          </p>
          <div className="mt-auto flex h-5 min-w-0 items-center gap-1.5 overflow-hidden">
            <Badge variant="secondary" className="rounded-md text-[11px]">
              {connectorTypeLabel(connector)}
            </Badge>
            {connector.hasSkills ? (
              <Badge variant="outline" className="rounded-md text-[11px]">Skill</Badge>
            ) : null}
            {connector.authMode ? (
              <Badge variant="outline" className="rounded-md text-[11px]">{connector.authMode}</Badge>
            ) : null}
            {installed ? (
              <Badge variant={activeConnector.connected ? "secondary" : "outline"} className="rounded-md text-[11px]">
                {connectorStatusLabel(installedRecord || connector)}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConnectorHubView({ onConnectorsChanged, onRunCliSetup, onAuthenticateMcp }: ConnectorHubViewProps) {
  const [tab, setTab] = React.useState<ConnectorTab>("recommend");
  const [query, setQuery] = React.useState("");
  const deferredQuery = React.useDeferredValue(query.trim().toLowerCase());
  const [payload, setPayload] = React.useState<ConnectorHubPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [busyIds, setBusyIds] = React.useState<Set<string>>(() => new Set());
  const [credentialTarget, setCredentialTarget] = React.useState<InstalledConnector | null>(null);
  const [credentialValues, setCredentialValues] = React.useState<Record<string, string>>({});
  const [credentialSaving, setCredentialSaving] = React.useState(false);

  const installedLookup = React.useMemo(() => {
    const map = new Map<string, InstalledConnector>();
    for (const connector of payload?.installed || []) {
      map.set(connector.id, connector);
    }
    return map;
  }, [payload?.installed]);

  const loadConnectors = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await window.agentDesktop.listConnectors();
      if (!res?.success || !res.data) throw new Error(res?.error || "读取连接器市场失败");
      setPayload(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  React.useEffect(() => {
    const handler = window.agentDesktop.ipcOn("connector-hub:changed", () => {
      void loadConnectors();
    });
    return () => {
      window.agentDesktop.ipcOff("connector-hub:changed", handler);
    };
  }, [loadConnectors]);

  const flashNotice = React.useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((current) => (current === text ? "" : current)), 3000);
  }, []);

  const setBusy = React.useCallback((id: string, busy: boolean) => {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const openCredentialEditor = React.useCallback((connector: InstalledConnector) => {
    const values = Object.fromEntries(
      (connector.credentialSchema?.fields || []).map((field) => [
        field.key,
        connector.configuredFields?.includes(field.key) ? "" : (field.defaultValue || ""),
      ]),
    );
    setCredentialValues(values);
    setCredentialTarget(connector);
    setError("");
  }, []);

  const saveCredentials = React.useCallback(async () => {
    if (!credentialTarget) return;
    setCredentialSaving(true);
    setError("");
    try {
      const res = await window.agentDesktop.saveConnectorCredentials({
        connectorId: credentialTarget.id,
        values: credentialValues,
      });
      if (!res?.success) throw new Error(res?.error || "保存连接器凭据失败");
      setCredentialTarget(null);
      setCredentialValues({});
      flashNotice(`已配置 ${credentialTarget.name}`);
      await loadConnectors();
      await onConnectorsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCredentialSaving(false);
    }
  }, [credentialTarget, credentialValues, flashNotice, loadConnectors, onConnectorsChanged]);

  const installConnector = React.useCallback(async (connector: ConnectorCatalogItem) => {
    setBusy(connector.id, true);
    setError("");
    try {
      const res = await window.agentDesktop.installConnector({ id: connector.id });
      if (!res?.success) throw new Error(res?.error || "安装连接器失败");
      flashNotice(`已安装 ${connector.name}`);
      await loadConnectors();
      await onConnectorsChanged?.();
      const installedConnector = res.data?.connector;
      if (installedConnector?.credentialSchema?.fields?.length) {
        openCredentialEditor(installedConnector);
        return;
      }
      const needsCliSetup = connector.type === "cli" || Boolean(installedConnector?.requiresCliSetup);
      if (needsCliSetup && installedConnector && onRunCliSetup) {
        onRunCliSetup(installedConnector, res.data.cli || null);
      }
      if (!needsCliSetup && connector.type === "mcp" && connector.authMode && installedConnector && onAuthenticateMcp) {
        onAuthenticateMcp(installedConnector);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(connector.id, false);
    }
  }, [flashNotice, loadConnectors, onAuthenticateMcp, onConnectorsChanged, onRunCliSetup, openCredentialEditor, setBusy]);

  const uninstallConnector = React.useCallback(async (connector: ConnectorCatalogItem) => {
    setBusy(connector.id, true);
    setError("");
    try {
      const res = await window.agentDesktop.uninstallConnector({ id: connector.id });
      if (!res?.success) throw new Error(res?.error || "卸载连接器失败");
      flashNotice(`已卸载 ${connector.name}`);
      await loadConnectors();
      await onConnectorsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(connector.id, false);
    }
  }, [flashNotice, loadConnectors, onConnectorsChanged, setBusy]);

  const connectors = payload?.connectors || [];
  const installed = payload?.installed || [];
  const visible = React.useMemo(() => {
    const source = tab === "installed" ? installed : connectors;
    return source.filter((connector) => {
      if (tab === "mcp" && connector.type !== "mcp") return false;
      if (tab === "cli" && connector.type !== "cli") return false;
      if (!deferredQuery) return true;
      return [
        connector.id,
        connector.name,
        connector.nameEn,
        connector.description,
        connector.providerId,
        connector.source,
      ].join(" ").toLowerCase().includes(deferredQuery);
    });
  }, [connectors, deferredQuery, installed, tab]);

  const tabs: Array<{ id: ConnectorTab; label: string }> = [
    { id: "recommend", label: "推荐" },
    { id: "mcp", label: "MCP" },
    { id: "cli", label: "CLI" },
    { id: "installed", label: "我安装的" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border/70 bg-background/92 px-4 py-2 backdrop-blur sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-muted/70 p-0.5">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "h-7 rounded-md px-3 text-xs font-semibold transition-colors",
                  tab === item.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}{item.id === "installed" ? ` ${installed.length}` : ""}
              </button>
            ))}
          </div>
          {notice ? (
            <div className="min-w-[120px] flex-1 truncate text-xs text-muted-foreground">{notice}</div>
          ) : (
            <div className="hidden min-w-[80px] flex-1 truncate text-xs text-muted-foreground sm:block">
              {tab === "installed" ? `${installed.length} 个已安装` : `${visible.length} / ${connectors.length} 个连接器`}
            </div>
          )}
          <div className="relative ml-auto w-full sm:w-[300px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 rounded-lg pl-9 text-sm"
              placeholder={tab === "installed" ? "搜索已安装连接器" : "搜索连接器名称或描述"}
            />
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            className="h-8 w-8 rounded-lg"
            onClick={() => void loadConnectors()}
            disabled={loading}
            title="刷新"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-2.5 sm:px-5">
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className={cn(error && "mt-2.5")}>
            {loading && visible.length === 0 ? (
              <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                加载中...
              </div>
            ) : visible.length === 0 ? (
              <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                没有找到匹配的连接器
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
                {visible.map((connector) => {
                  const installedRecord = installedLookup.get(connector.id);
                  return (
                    <ConnectorCard
                      key={connector.id}
                      connector={{ ...connector, installed: Boolean(installedRecord || connector.installed) }}
                      installedRecord={installedRecord}
                      busy={busyIds.has(connector.id)}
                      onInstall={() => void installConnector(connector)}
                      onAuthenticate={() => {
                        const record = (installedRecord || connector) as InstalledConnector;
                        if (record.credentialSchema?.fields?.length) {
                          openCredentialEditor(record);
                        } else if (onAuthenticateMcp) {
                          onAuthenticateMcp(record);
                        }
                      }}
                      onUninstall={() => void uninstallConnector(connector)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {credentialTarget?.credentialSchema ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !credentialSaving) setCredentialTarget(null);
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-label={credentialTarget.credentialSchema.title}
            className="flex max-h-[min(720px,calc(100vh-32px))] w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              void saveCredentials();
            }}
          >
            <div className="flex items-start gap-3 border-b border-border px-5 py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <KeyRound className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-foreground">
                  {credentialTarget.credentialSchema.title}
                </h2>
                {credentialTarget.credentialSchema.description ? (
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">
                    {credentialTarget.credentialSchema.description}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 shrink-0 rounded-lg"
                disabled={credentialSaving}
                onClick={() => setCredentialTarget(null)}
                title="关闭"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {credentialTarget.credentialSchema.fields.map((field) => {
                const configured = credentialTarget.configuredFields?.includes(field.key);
                return (
                  <label key={field.key} className="block">
                    <span className="mb-1.5 block text-sm font-medium text-foreground">
                      {field.label}{field.required ? " *" : ""}
                    </span>
                    <Input
                      type={field.type === "password" ? "password" : "text"}
                      value={credentialValues[field.key] || ""}
                      placeholder={configured ? "已保存" : field.placeholder}
                      autoComplete={field.type === "password" ? "new-password" : "off"}
                      onChange={(event) => setCredentialValues((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))}
                    />
                    {field.description ? (
                      <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">
                        {field.description}
                      </span>
                    ) : null}
                  </label>
                );
              })}
              {credentialTarget.credentialSchema.docUrl ? (
                <a
                  href={credentialTarget.credentialSchema.docUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  {credentialTarget.credentialSchema.docLabel || "获取凭据"}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <Button
                type="button"
                variant="outline"
                disabled={credentialSaving}
                onClick={() => setCredentialTarget(null)}
              >
                取消
              </Button>
              <Button type="submit" disabled={credentialSaving}>
                {credentialSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                保存
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
