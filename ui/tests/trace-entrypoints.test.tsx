import { expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsView } from '../src/renderer-react/components/settings-view';
import { SessionTraceButton } from '../src/renderer-react/components/session-trace-button';
import { DEFAULT_DESKTOP_SETTINGS } from '../src/desktop-settings.mjs';
import type { DesktopSettings } from '../src/renderer-react/types';
import { toTraceMessages } from '../../src/services/api/traceMessages';
import { buildTraceViewModel } from '../src/renderer-react/lib/trace/viewModel';

test('settings Trace category reaches the migrated view with the requested remote session', () => {
  const html = renderToStaticMarkup(<SettingsView settingsDraft={DEFAULT_DESKTOP_SETTINGS as DesktopSettings}
    setSettingsDraft={() => {}} settingsNotice="" autoSaveSettings={async () => {}} autoSaveImageSettings={async () => {}}
    themeMode="light" setThemeMode={() => {}} cssThemeId="default" setCssThemeId={() => {}}
    onToolDisplayModeChange={() => {}} onAppearancePreview={() => {}} onAppearanceCommit={() => {}}
    buddyEnabled={false} onBuddyEnabledChange={() => {}}
    initialSection="trace" traceSessionId="cloud-session-1" traceTarget="remote" />);
  expect(html).toContain('data-testid="trace-view"');
  expect(html).toContain('cloud-session-1');
  expect(html).toContain('Trace 数据来源');
  expect(html).toContain('服务器');
});

test('chat Trace entry is available locally and waits for a cloud session identity', () => {
  const local = renderToStaticMarkup(<SessionTraceButton session={{ id: 'desktop-1', agentMode: 'local' }} onOpen={() => {}} />);
  expect(local).toContain('aria-label="查看会话 Trace"');
  expect(local).not.toContain('disabled=""');
  const remote = renderToStaticMarkup(<SessionTraceButton session={{ id: 'desktop-1', agentMode: 'remote-direct' }} onOpen={() => {}} />);
  expect(remote).toContain('disabled=""');
});

test('actual Moss transcript adaptation produces completed tools in the migrated cc-haha tree', () => {
  const messages = toTraceMessages([
    { type: 'user', uuid: 'u', prompt: 'Read the file', timestamp: 1000 },
    { type: 'assistant', uuid: 'a', timestamp: 2000, message: { content: [{ type: 'text', text: 'Reading' }, { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.txt' } }] } },
    { type: 'user', uuid: 'r', timestamp: 3000, message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'hello' }] } },
  ]);
  const model = buildTraceViewModel({ sessionId: 's', calls: [], events: [], summary: {
    apiCalls: 0, failedCalls: 0, totalDurationMs: 0, totalInputTokens: 0, totalOutputTokens: 0, models: [], updatedAt: null,
  } }, messages);
  const tool = model.spans.find(span => span.kind === 'tool');
  expect(tool).toMatchObject({ toolUseId: 'read-1', toolName: 'Read', status: 'ok', durationMs: 1000 });
  expect(model.spans.some(span => span.kind === 'tool_result' && span.parentId === tool!.id)).toBe(true);
});
