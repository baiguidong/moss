"use client";

import * as React from "react";
import {
  Cable,
  Download,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
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
  if (connector.type === "cli" && connector.setupStatus === "running") return "安装中";
  if (connector.type === "cli" && connector.setupStatus === "authenticating") return "认证中";
  if (connector.type === "cli" && connector.setupStatus === "failed") return "设置失败";
  if (connector.type === "cli" && connector.setupStatus === "pending") return "待设置";
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

function CategoryChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 shrink-0 rounded-lg px-3 text-sm transition-colors",
        active
          ? "bg-foreground text-background"
          : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
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
  const canAuthenticate = installed && connector.type === "mcp" && !connector.connected;
  const examples = connector.examples || [];
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-card/82 p-4 shadow-[0_16px_48px_-40px_rgba(0,0,0,0.55)]">
      <div className="flex min-w-0 items-start gap-3">
        <ConnectorIcon connector={connector} className="h-10 w-10" />
        <div className="min-w-0 flex-1">
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
                    title="连接/授权"
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
          <p className="mt-3 h-11 overflow-hidden text-sm leading-5 text-muted-foreground">
            {connector.description || "暂无描述"}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
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
              <Badge variant="outline" className="rounded-md text-[11px]">
                {connectorStatusLabel(installedRecord || connector)}
              </Badge>
            ) : null}
          </div>
          <div className="mt-3 truncate text-xs text-muted-foreground">
            {examples[0] || connector.source}
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

  const installConnector = React.useCallback(async (connector: ConnectorCatalogItem) => {
    setBusy(connector.id, true);
    setError("");
    try {
      const res = await window.agentDesktop.installConnector({ id: connector.id });
      if (!res?.success) throw new Error(res?.error || "安装连接器失败");
      flashNotice(`已安装 ${connector.name}`);
      await loadConnectors();
      await onConnectorsChanged?.();
      if (connector.type === "cli" && res.data?.connector && onRunCliSetup) {
        onRunCliSetup(res.data.connector, res.data.cli || null);
      }
      if (connector.type === "mcp" && connector.authMode && res.data?.connector && onAuthenticateMcp) {
        onAuthenticateMcp(res.data.connector);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(connector.id, false);
    }
  }, [flashNotice, loadConnectors, onAuthenticateMcp, onConnectorsChanged, onRunCliSetup, setBusy]);

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
      <div className="shrink-0 border-b border-border/70 bg-background/92 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Plug className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">连接器</div>
            <div className="truncate text-xs text-muted-foreground">
              {tab === "installed" ? `${installed.length} 个已安装` : `${connectors.length} 个可用连接器`}
              {notice ? ` · ${notice}` : ""}
            </div>
          </div>
          <div className="relative w-full sm:w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 rounded-lg pl-9"
              placeholder="搜索连接器名称或描述"
            />
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            className="h-9 w-9 rounded-lg"
            onClick={() => void loadConnectors()}
            disabled={loading}
            title="刷新"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            {tabs.map((item) => (
              <CategoryChip
                key={item.id}
                active={tab === item.id}
                onClick={() => setTab(item.id)}
              >
                {item.label}{item.id === "installed" ? ` ${installed.length}` : ""}
              </CategoryChip>
            ))}
          </div>

          {error ? (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="mt-4">
            {loading && visible.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
                加载中...
              </div>
            ) : visible.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
                没有找到匹配的连接器
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
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
                        const record = installedRecord || connector;
                        if (onAuthenticateMcp) onAuthenticateMcp(record as InstalledConnector);
                      }}
                      onUninstall={() => void uninstallConnector(connector)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {payload?.catalogPath ? (
            <div className="mt-5 truncate text-xs text-muted-foreground">
              catalog: {payload.catalogPath}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
