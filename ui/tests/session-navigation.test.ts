import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(
  new URL('../src/renderer-react/App.tsx', import.meta.url),
  'utf8',
);

describe('new session navigation', () => {
  test('does not clear a session opened while initial loading is finishing', () => {
    const start = appSource.indexOf('const status = await window.agentDesktop.getStatus();');
    const end = appSource.indexOf("const offEvent = window.agentDesktop.onEvent", start);
    const initialLoadSource = appSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(initialLoadSource).not.toContain('setActiveSessionId(null)');
    expect(initialLoadSource).not.toContain('setActiveDetail(null)');
  });
});
