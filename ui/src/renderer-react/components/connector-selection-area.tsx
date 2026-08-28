import React from 'react';
import { Cable, Check, ListFilter, Plug, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectionPickerDialog } from '@/components/selection-picker-dialog';
import { cn } from '@/lib/utils';
import { isAuthorizedConnector } from '@/lib/connector-selection';
import type { InstalledConnector } from '../types';

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

export function connectorTypeLabel(connector: InstalledConnector) {
  if (connector.type === 'cli') return 'CLI';
  if (connector.type === 'mcp') return 'MCP';
  return '连接器';
}

export const ConnectorIcon: React.FC<{
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

export function getSelectableInstalledConnectors(connectors: InstalledConnector[]) {
  return connectors
    .filter(isAuthorizedConnector)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'mcp' ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
    });
}

export const ConnectorSelectionArea: React.FC<ConnectorSelectionAreaProps> = ({
  connectors,
  selectedConnectorIds,
  onToggleConnector,
  onOpenConnectorHub,
}) => {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const installed = React.useMemo(() => getSelectableInstalledConnectors(connectors), [connectors]);
  const selected = React.useMemo(() => {
    const authorizedIds = new Set(installed.map((connector) => connector.id));
    return new Set(selectedConnectorIds.filter((id) => authorizedIds.has(id)));
  }, [installed, selectedConnectorIds]);
  const selectedPreview = React.useMemo(
    () => selectedConnectorIds
      .map((id) => installed.find((connector) => connector.id === id))
      .find((connector): connector is InstalledConnector => Boolean(connector)),
    [installed, selectedConnectorIds],
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
    onToggleConnector(connector);
  }, [onToggleConnector]);
  const closePicker = React.useCallback(() => {
    setPickerOpen(false);
    setQuery('');
  }, []);

  if (installed.length === 0) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          'h-7 shrink-0 border-border/70 bg-muted/35 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          selectedPreview ? 'w-7 rounded-md px-0' : 'rounded-full px-2.5',
        )}
        onClick={() => setPickerOpen(true)}
        title={selectedPreview
          ? `${selectedPreview.name}${selected.size > 1 ? ` 等 ${selected.size} 个连接器` : ''}`
          : '选择连接器'}
        aria-label={selected.size > 0 ? `选择连接器，已选 ${selected.size} 个` : '选择连接器'}
      >
        {selectedPreview ? (
          <ConnectorIcon connector={selectedPreview} className="h-4 w-4" />
        ) : (
          <>
            <ListFilter className="h-3.5 w-3.5" />
            <span>选择连接器</span>
          </>
        )}
      </Button>

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
        managerPlacement="left"
        confirmLabel="确定"
        onConfirm={closePicker}
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
