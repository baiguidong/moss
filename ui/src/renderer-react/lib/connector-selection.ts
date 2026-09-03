import type { InstalledConnector } from '@/types';

export function isAuthorizedConnector(connector: InstalledConnector) {
  return connector.enabled !== false && connector.connected === true;
}

export function selectConnectorForNewChat({
  connectorId,
  navigateToNewChat,
  setDraftConnectorIds,
}: {
  connectorId: string;
  navigateToNewChat: () => boolean;
  setDraftConnectorIds: (connectorIds: string[]) => void;
}) {
  if (!navigateToNewChat()) return false;
  setDraftConnectorIds([connectorId]);
  return true;
}
