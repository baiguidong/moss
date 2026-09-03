import { describe, expect, it } from 'bun:test';
import { getConnectorPrimaryAction } from '../src/renderer-react/lib/connector-primary-action';
import type { ConnectorCatalogItem } from '../src/renderer-react/types';

function connector(overrides: Partial<ConnectorCatalogItem>): ConnectorCatalogItem {
  return {
    id: 'example',
    source: 'example',
    name: 'Example',
    type: 'unknown',
    ...overrides,
  };
}

describe('connector primary action', () => {
  it('offers setup for installed CLI connectors that are not connected', () => {
    expect(getConnectorPrimaryAction(connector({
      type: 'cli',
      hasCli: true,
      hasSkills: true,
      connected: false,
      setupStatus: 'pending',
    }), true)).toBe('cli-setup');
  });

  it('offers use after a CLI connector is connected', () => {
    expect(getConnectorPrimaryAction(connector({
      type: 'cli',
      hasCli: true,
      hasSkills: true,
      connected: true,
    }), true)).toBe('use');
  });

  it('keeps credentials and MCP authorization on their own flows', () => {
    expect(getConnectorPrimaryAction(connector({
      credentialSchema: {
        title: 'Credentials',
        fields: [{ key: 'token', label: 'Token', type: 'password', required: true }],
      },
      credentialsConfigured: false,
    }), true)).toBe('credentials');
    expect(getConnectorPrimaryAction(connector({ hasMcp: true, connected: false }), true)).toBe('mcp-auth');
  });

  it('offers use when credential-based authentication is already configured', () => {
    expect(getConnectorPrimaryAction(connector({
      authMode: 'token',
      hasSkills: true,
      connected: true,
      credentialsConfigured: true,
      credentialSchema: {
        title: '携程问道授权',
        fields: [{ key: 'WENDAO_API_KEY', label: 'API Token', type: 'password', required: true }],
      },
    }), true)).toBe('use');
  });

  it('offers use for an installed skill-only connector', () => {
    expect(getConnectorPrimaryAction(connector({ hasSkills: true, connected: false }), true)).toBe('use');
  });

  it('does not offer an installed action for catalog-only entries', () => {
    expect(getConnectorPrimaryAction(connector({ hasCli: true }), false)).toBeNull();
  });
});
