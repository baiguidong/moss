import React from 'react';
import { Cable, Check, Plug, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InstalledConnector } from '../types';

type ConnectorSelectionAreaProps = {
  connectors: InstalledConnector[];
  selectedConnectorIds: string[];
  onToggleConnector: (connector: InstalledConnector) => void;
};

function connectorIcon(connector: InstalledConnector) {
  if (connector.type === 'cli') return Terminal;
  if (connector.type === 'mcp') return Plug;
  return Cable;
}

const ConnectorPill: React.FC<{
  connector: InstalledConnector;
  selected: boolean;
  onClick: () => void;
}> = ({ connector, selected, onClick }) => {
  const [iconFailed, setIconFailed] = React.useState(false);
  const Icon = connectorIcon(connector);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex h-7 items-center gap-2 rounded-full border bg-transparent px-3 text-sm transition-colors',
        selected
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      title={connector.description || connector.name}
    >
      {connector.icon && !iconFailed ? (
        <img
          src={connector.icon}
          alt=""
          className="h-3.5 w-3.5 shrink-0 object-contain"
          onError={() => setIconFailed(true)}
        />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0" />
      )}
      <span>{connector.name}</span>
      {selected && <Check className="h-3 w-3 shrink-0 text-primary" />}
    </button>
  );
};

export const ConnectorSelectionArea: React.FC<ConnectorSelectionAreaProps> = ({
  connectors,
  selectedConnectorIds,
  onToggleConnector,
}) => {
  const installed = connectors
    .filter((connector) => connector.enabled !== false)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'mcp' ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
    });

  if (installed.length === 0) return null;

  const selected = new Set(selectedConnectorIds);
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {installed.map((connector) => (
        <ConnectorPill
          key={connector.id}
          connector={connector}
          selected={selected.has(connector.id)}
          onClick={() => onToggleConnector(connector)}
        />
      ))}
    </div>
  );
};
