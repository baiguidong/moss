import { describe, expect, it } from 'bun:test';
import {
  buildToolPermissionDialog,
  getToolPermissionNotice,
  resolveToolPermissionDialogResponse,
  shouldAutoApproveToolPermission,
} from '../src/tool-permission-policy.mjs';

describe('desktop tool permission policy', () => {
  it('only auto-approves plan transition control in bypass mode', () => {
    expect(shouldAutoApproveToolPermission({
      bypassPermissions: true,
      toolName: 'ExitPlanMode',
    })).toBe(true);
    expect(shouldAutoApproveToolPermission({
      bypassPermissions: true,
      toolName: 'Bash',
    })).toBe(false);
  });

  it('still routes questions to the user in bypass mode', () => {
    expect(shouldAutoApproveToolPermission({
      bypassPermissions: true,
      toolName: 'AskUserQuestion',
    })).toBe(false);
  });

  it('uses concise product copy for plan approval', () => {
    const dialog = buildToolPermissionDialog('ExitPlanMode', {
      plan: 'a very long implementation plan',
      allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
    });

    expect(dialog.title).toBe('计划确认');
    expect(dialog.buttons).toEqual(['执行计划', '继续规划']);
    expect(dialog.detail).not.toContain('allowedPrompts');
    expect(dialog.detail).not.toContain('a very long implementation plan');
  });

  it('bounds generic tool input shown in native dialogs', () => {
    const dialog = buildToolPermissionDialog('LargeTool', {
      content: 'x'.repeat(5000),
    });

    expect(dialog.detail.length).toBeLessThan(1700);
    expect(dialog.detail).toContain('内容已截断');
  });

  it('presents shell commands without exposing raw input JSON', () => {
    const dialog = buildToolPermissionDialog('Bash', {
      command: "date '+%H:%M:%S %Z'",
      description: 'Show current local time',
    });

    expect(dialog).toEqual({
      title: '运行命令',
      message: '允许 Agent 在这台电脑上运行下面的命令吗？',
      detail: "用途：Show current local time\n\n命令：\ndate '+%H:%M:%S %Z'",
      buttons: ['允许运行', '取消'],
    });
    expect(dialog.detail).not.toContain('"command"');
    expect(dialog.detail).not.toContain('{');
  });

  it('uses customer-facing notices instead of internal tool names', () => {
    expect(getToolPermissionNotice('Bash')).toBe('Agent 正在等待运行命令的确认');
    expect(getToolPermissionNotice('FileEdit')).toBe('Agent 正在等待修改文件的确认');
  });

  it('offers persistent approval when CLI provides persistent suggestions', () => {
    const dialog = buildToolPermissionDialog('Bash', {
      command: 'npm test',
    }, [{
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'npm test' }],
      behavior: 'allow',
      destination: 'localSettings',
    }]);

    expect(dialog.buttons).toEqual(['允许运行', '以后允许', '取消']);
    expect(dialog.rememberOptionIndex).toBe(1);
    expect(dialog.detail).toContain('以后允许范围：运行命令“npm test”');
  });

  it('labels session-only CLI suggestions accurately', () => {
    const dialog = buildToolPermissionDialog('FileEdit', {
      file_path: '/tmp/example.txt',
    }, [{
      type: 'setMode',
      mode: 'acceptEdits',
      destination: 'session',
    }]);

    expect(dialog.buttons).toEqual(['允许修改', '本次会话允许', '取消']);
    expect(dialog.detail).toContain('本次会话允许范围：修改工作区内的文件');
  });

  it('returns CLI suggestions only for the remember option', () => {
    const suggestions = [{
      type: 'addRules',
      rules: [{ toolName: 'WebSearch' }],
      behavior: 'allow',
      destination: 'localSettings',
    }];
    const dialog = buildToolPermissionDialog('WebSearch', {
      query: 'Moss documentation',
    }, suggestions);

    expect(resolveToolPermissionDialogResponse(0, dialog, suggestions)).toEqual({
      behavior: 'allow',
    });
    expect(resolveToolPermissionDialogResponse(1, dialog, suggestions)).toEqual({
      behavior: 'allow',
      updatedPermissions: suggestions,
    });
    expect(resolveToolPermissionDialogResponse(2, dialog, suggestions)).toEqual({
      behavior: 'deny',
      message: 'Denied by user',
    });
  });
});
