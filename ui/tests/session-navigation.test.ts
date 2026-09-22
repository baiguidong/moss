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

  test('keeps an embedded App mounted while navigating and ignores runtime-only refreshes', () => {
    expect(appSource).toContain("className={activeView === 'embedded-app' ? 'h-full min-h-0' : 'hidden'}");
    expect(appSource).toContain("activeView === 'embedded-app' ? null : activeView === 'chat'");
    expect(appSource).toContain("payload?.action !== 'runtime'");
    expect(appSource).not.toContain("activeView === 'embedded-app' && embeddedAppName ? (");
  });
});
