import { describe, expect, it } from 'bun:test';
import { isAuthorizedConnector } from '../src/renderer-react/lib/connector-selection';
import type { InstalledConnector } from '../src/renderer-react/types';

function connector(overrides: Partial<InstalledConnector>): InstalledConnector {
  return {
    id: 'connector-id',
    source: 'test',
    name: 'Connector',
    type: 'mcp',
    installedAt: '2026-08-26T00:00:00.000Z',
    path: '/tmp/connector',
    ...overrides,
  };
}

describe('connector selection', () => {
  it('includes only enabled connectors with completed authorization', () => {
    expect(isAuthorizedConnector(connector({ connected: true, enabled: true }))).toBe(true);
    expect(isAuthorizedConnector(connector({ connected: true }))).toBe(true);
    expect(isAuthorizedConnector(connector({ connected: false, enabled: true }))).toBe(false);
    expect(isAuthorizedConnector(connector({ connected: true, enabled: false }))).toBe(false);
    expect(isAuthorizedConnector(connector({ enabled: true }))).toBe(false);
  });
});
