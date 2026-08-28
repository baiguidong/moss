import type { InstalledConnector } from '@/types';

export function isAuthorizedConnector(connector: InstalledConnector) {
  return connector.enabled !== false && connector.connected === true;
}
