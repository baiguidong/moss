import type { ConnectorCatalogItem } from '../types';

export type ConnectorPrimaryAction = 'credentials' | 'cli-setup' | 'mcp-auth' | 'use' | null;

export function getConnectorPrimaryAction(
  connector: ConnectorCatalogItem,
  installed: boolean,
): ConnectorPrimaryAction {
  if (!installed) return null;

  if (connector.credentialSchema?.fields?.length) {
    return connector.credentialsConfigured ? 'use' : 'credentials';
  }
  if (!connector.connected && (connector.hasCli || connector.requiresCliSetup || connector.type === 'cli')) {
    return 'cli-setup';
  }
  if (!connector.connected && connector.hasMcp && connector.hasRemoteMcp !== false) return 'mcp-auth';
  if (connector.connected || connector.hasSkills) return 'use';

  return null;
}
