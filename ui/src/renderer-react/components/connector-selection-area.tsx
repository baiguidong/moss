import React from 'react';
import { Cable, Check, ListFilter, Plug, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectionPickerDialog } from '@/components/selection-picker-dialog';
import { cn } from '@/lib/utils';
import {
  QUICK_SELECTION_LIMIT,
  rankRecentItems,
  useRecentIds,
} from '@/lib/recent-selection';
import type { InstalledConnector } from '../types';

const CONNECTOR_RECENTS_KEY = 'ui.recentConnectors.v1';

type ConnectorSelectionAreaProps = {
  connectors: InstalledConnector[];
  selectedConnectorIds: string[];
  onToggleConnector: (connector: InstalledConnector) => void;
  onOpenConnectorHub?: () => void;
};

function connectorIcon(connector: InstalledConnector) {
  if (connector.type === 'cli') return Terminal;
  if (connector.type === 'mcp') return Plug;
  return Cable;
}

function connectorTypeLabel(connector: InstalledConnector) {
  if (connector.type === 'cli') return 'CLI';
  if (connector.type === 'mcp') return 'MCP';
  return '连接器';
}

const ConnectorIcon: React.FC<{
  connector: InstalledConnector;
  className?: string;
}> = ({ connector, className }) => {
  const [iconFailed, setIconFailed] = React.useState(false);
  const Icon = connectorIcon(connector);
  return connector.icon && !iconFailed ? (
    <img
      src={connector.icon}
      alt=""
      className={cn('shrink-0 object-contain', className)}
      onError={() => setIconFailed(true)}
    />
  ) : (
    <Icon className={cn('shrink-0', className)} />
  );
};

const ConnectorPill: React.FC<{
  connector: InstalledConnector;
  selected: boolean;
  onClick: () => void;
  className?: string;
}> = ({ connector, selected, onClick, className }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={selected}
    className={cn(
      'group flex h-7 min-w-0 max-w-[144px] items-center gap-1.5 rounded-full border bg-transparent px-2.5 text-sm transition-colors',
      selected
        ? 'border-primary bg-primary/10 text-foreground'
        : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
      className,
    )}
    title={connector.description || connector.name}
  >
    <ConnectorIcon connector={connector} className="h-3.5 w-3.5" />
    <span className="truncate">{connector.name}</span>
    {selected ? <Check className="h-3 w-3 shrink-0 text-primary" /> : null}
  </button>
);

export const ConnectorSelectionArea: React.FC<ConnectorSelectionAreaProps> = ({
  connectors,
  selectedConnectorIds,
  onToggleConnector,
  onOpenConnectorHub,
}) => {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const { recentIds, remember } = useRecentIds(CONNECTOR_RECENTS_KEY);

  const installed = React.useMemo(() => connectors
    .filter((connector) => connector.enabled !== false)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'mcp' ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
    }), [connectors]);
  const selected = React.useMemo(() => new Set(selectedConnectorIds), [selectedConnectorIds]);
  const quickConnectors = React.useMemo(
    () => rankRecentItems(
      installed,
      (connector) => connector.id,
      selectedConnectorIds,
      recentIds,
      QUICK_SELECTION_LIMIT,
    ),
    [installed, recentIds, selectedConnectorIds],
  );
  const filteredConnectors = React.useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-Hans-CN');
    if (!normalizedQuery) return installed;
    return installed.filter((connector) => [
      connector.name,
      connector.description,
      connector.type,
    ].some((value) => String(value || '').toLocaleLowerCase('zh-Hans-CN').includes(normalizedQuery)));
  }, [installed, query]);

  const handleToggle = React.useCallback((connector: InstalledConnector) => {
    if (!selected.has(connector.id)) remember(connector.id);
    onToggleConnector(connector);
  }, [onToggleConnector, remember, selected]);
  const closePicker = React.useCallback(() => {
    setPickerOpen(false);
    setQuery('');
  }, []);

  if (installed.length === 0) return null;

  return (
    <>
      <div className="flex w-full min-w-0 items-center justify-center gap-2">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          {quickConnectors.map((connector, index) => (
            <ConnectorPill
              key={connector.id}
              connector={connector}
              selected={selected.has(connector.id)}
              onClick={() => handleToggle(connector)}
              className={index >= 3 ? 'hidden lg:flex' : undefined}
            />
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 rounded-full px-2.5 text-xs text-muted-foreground"
          onClick={() => setPickerOpen(true)}
          title="选择连接器"
        >
          <ListFilter className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">选择连接器</span>
          {installed.length > QUICK_SELECTION_LIMIT ? (
            <span className="text-[11px] text-muted-foreground/70">{installed.length}</span>
          ) : null}
        </Button>
      </div>

      <SelectionPickerDialog
        open={pickerOpen}
        title="选择连接器"
        description={`已安装 ${installed.length} 个，已选 ${selected.size} 个`}
        searchPlaceholder="搜索连接器"
        query={query}
        onQueryChange={setQuery}
        onClose={closePicker}
        icon={<Cable className="h-4 w-4" />}
        resultCount={filteredConnectors.length}
        totalCount={installed.length}
        emptyLabel="没有匹配的连接器"
        managerLabel="管理连接器"
        onOpenManager={onOpenConnectorHub}
      >
        <div className="space-y-1">
          {filteredConnectors.map((connector) => {
            const isSelected = selected.has(connector.id);
            return (
              <button
                key={connector.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => handleToggle(connector)}
                className={cn(
                  'flex h-12 w-full items-center gap-3 rounded-md px-3 text-left transition-colors',
                  isSelected ? 'bg-primary/10' : 'hover:bg-muted',
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                  <ConnectorIcon connector={connector} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{connector.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {connectorTypeLabel(connector)}{connector.description ? ` · ${connector.description}` : ''}
                  </span>
                </span>
                <span className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                  isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                )}>
                  {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </SelectionPickerDialog>
    </>
  );
};
