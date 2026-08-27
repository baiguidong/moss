import { describe, expect, it } from 'bun:test';
import { isAuthorizedProjectConnector } from '../src/renderer-react/components/projects/project-resource-picker';
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

describe('project connector selection', () => {
  it('includes only enabled connectors with completed authorization', () => {
    expect(isAuthorizedProjectConnector(connector({ connected: true, enabled: true }))).toBe(true);
    expect(isAuthorizedProjectConnector(connector({ connected: true }))).toBe(true);
    expect(isAuthorizedProjectConnector(connector({ connected: false, enabled: true }))).toBe(false);
    expect(isAuthorizedProjectConnector(connector({ connected: true, enabled: false }))).toBe(false);
  });
});
