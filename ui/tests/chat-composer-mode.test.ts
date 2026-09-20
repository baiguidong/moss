import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/renderer-react/components/chat-area.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/renderer-react/App.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
const workspaceSelectorSource = readFileSync(new URL('../src/renderer-react/components/workspace-selector.tsx', import.meta.url), 'utf8');

describe('chat composer mode placement', () => {
  test('offers intent selection from the new-session add menu', () => {
    const activeComposer = source.slice(
      source.indexOf('{!isHomeComposer && ('),
      source.indexOf('{isHomeComposer && ('),
    );
    const newSessionComposer = source.slice(
      source.indexOf('{isHomeComposer && ('),
      source.indexOf('function HomeLanding'),
    );
    const addMenu = source.slice(
      source.indexOf('const newSessionAddMenu'),
      source.indexOf('\n  return (', source.indexOf('const newSessionAddMenu')),
    );

    expect(activeComposer).not.toContain('模式：');
    expect(activeComposer).not.toContain('onComposerIntentChange(option.id)');
    expect(newSessionComposer).not.toContain('模式：');
    expect(newSessionComposer).toContain('{newSessionAddMenu}');
    expect(addMenu).toContain('<span>模式</span>');
    expect(addMenu).toContain('onComposerIntentChange(option.id)');
  });

  test('places the computer selector inside the new-session composer', () => {
    const activeComposer = source.slice(
      source.indexOf('{!isHomeComposer && ('),
      source.indexOf('{isHomeComposer && ('),
    );
    const newSessionComposer = source.slice(
      source.indexOf('{isHomeComposer && ('),
      source.indexOf('function HomeLanding'),
    );
    const homeLanding = source.slice(
      source.indexOf('function HomeLanding'),
      source.indexOf('export function ChatArea'),
    );

    expect(activeComposer).not.toContain('选择工作电脑');
    expect(newSessionComposer).toContain('选择工作电脑');
    expect(newSessionComposer).toContain('本地电脑');
    expect(newSessionComposer).toContain('云电脑');
    expect(newSessionComposer).toContain('<WorkspaceSelector');
    expect(newSessionComposer).not.toContain('title="选择文件"');
    expect(newSessionComposer).not.toContain('title="选择目录"');
    expect(newSessionComposer).toContain("onNewSessionModeChange?.('remote-direct')");
    expect(homeLanding).not.toContain('rounded-full border px-6 py-3');
  });

  test('splits resource selection into the five add-menu actions', () => {
    const addMenu = source.slice(
      source.indexOf('const newSessionAddMenu'),
      source.indexOf('\n  return (', source.indexOf('const newSessionAddMenu')),
    );
    const newSessionComposer = source.slice(
      source.indexOf('{isHomeComposer && ('),
      source.indexOf('function HomeLanding'),
    );

    for (const label of ['添加文件', '模式', '专家', '技能', '连接器']) {
      expect(addMenu).toContain(`>${label}</span>`);
    }
    expect(addMenu).toContain('DropdownMenuSubTrigger');
    expect(addMenu).toContain("style={{ overflow: 'visible' }}");
    expect(addMenu).not.toContain('<ChevronRight');
    expect(newSessionComposer).toContain('triggerVisible={false}');
    expect(newSessionComposer).not.toContain('模式：');
  });

  test('shows a selected workspace only in the workspace trigger', () => {
    const newSessionComposer = source.slice(
      source.indexOf('{isHomeComposer && ('),
      source.indexOf('function HomeLanding'),
    );

    expect(newSessionComposer).not.toContain('{workspace && (');
    expect(workspaceSelectorSource).not.toContain('不使用工作空间');
    expect(workspaceSelectorSource).toContain('side="top"');
  });

  test('defaults new sessions to local and forwards the selected mode at creation', () => {
    expect(appSource).toContain("React.useState<'local' | 'remote-direct'>('local')");
    expect(appSource).toContain("preparedSession ? 'local' : newSessionAgentMode");
    expect(appSource).toContain('agentMode: \'local\' | \'remote-direct\' = \'local\'');
    expect(mainSource).toContain('agentMode: payload.agentMode');
  });
});
