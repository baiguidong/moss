import { describe, expect, test } from 'bun:test';
import { describeAppPermission, describeBackendAction, formatAppPermission } from '../src/shared/app-capability-descriptions.mjs';

describe('App capability explanations', () => {
  test('explains Host grants in Chinese while retaining their exact identifiers', () => {
    expect(describeAppPermission('mcp:manage')).toMatchObject({ label: '管理 MCP 服务', description: expect.stringContaining('新增、修改') });
    expect(describeAppPermission('local-files:pick')).toMatchObject({ label: '选择本机文件', description: expect.stringContaining('你选中') });
    expect(formatAppPermission('mcp:connect')).toContain('检查 MCP 连接（mcp:connect）');
    expect(describeAppPermission('custom:unknown')).toMatchObject({ id: 'custom:unknown', label: '自定义权限' });
    expect(describeAppPermission('constructor').label).toBe('自定义权限');
  });

  test('explains known backend actions and labels unfamiliar ones honestly', () => {
    expect(describeBackendAction('engine.prepare')).toMatchObject({ label: '准备运行环境', description: expect.stringContaining('后台引擎') });
    expect(describeBackendAction('files.pick')).toMatchObject({ label: '选择文件', description: expect.stringContaining('文件选择器') });
    expect(describeBackendAction('servers.list').label).toBe('列出 MCP 服务');
    expect(describeBackendAction('vendor.internal').description).toContain('未提供此操作的用途说明');
    expect(describeBackendAction('constructor').label).toBe('应用后台操作');
  });
});
