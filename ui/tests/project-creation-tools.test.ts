import { expect, test } from 'bun:test';
import { z } from 'zod/v4';
import { createProjectCreationTool } from '../../src/tools/ProjectCreationTool/ProjectCreationTool';
import { createProjectResourceTool } from '../../src/tools/ProjectCreationTool/ProjectResourceTool';

test('project tools publish object schemas compatible with model tool APIs', () => {
  const tools = [createProjectCreationTool(async () => null), createProjectResourceTool(async () => [])];
  for (const tool of tools) expect(z.toJSONSchema(tool.inputSchema).type).toBe('object');
});

test('model cannot request installation, direct creation or another session identity', () => {
  const plan = createProjectCreationTool(async () => null);
  const resource = createProjectResourceTool(async () => []);
  expect(plan.inputSchema.safeParse({ action: 'create', name: 'Project' }).success).toBe(false);
  expect(plan.inputSchema.safeParse({ action: 'preview', name: 'Project', sessionId: 'another-session' }).success).toBe(false);
  expect(resource.inputSchema.safeParse({ action: 'install', kind: 'skill', id: 'research' }).success).toBe(false);
  expect(plan.inputSchema.safeParse({ action: 'get' }).success).toBe(true);
});

test('project plans support generated and built-in icons without accepting raw SVG markup', () => {
  const tool = createProjectCreationTool(async () => null);
  for (const icon of [{ kind: 'generated', paths: ['M2 12h20M12 2v20'], color: 'blue' }, { kind: 'builtin', name: 'rocket', color: 'violet' }]) {
    expect(tool.inputSchema.safeParse({ action: 'preview', name: '图标项目', icon }).success).toBe(true);
  }
  for (const icon of [{ kind: 'generated', paths: ['<svg/>'] }, { kind: 'generated' }, { kind: 'builtin', name: 'missing' }]) {
    expect(tool.inputSchema.safeParse({ action: 'preview', name: '图标项目', icon }).success).toBe(false);
  }
});

test('stale default expert names are ignored when no expert was selected', async () => {
  let received: any;
  const tool = createProjectCreationTool(async input => { received = input; return { ok: true }; });
  await tool.call({ action: 'preview', name: '无专家项目', assistantName: '小黑', expertIds: [], skillIds: [], appIds: [], appServiceIds: [] } as any, undefined as any, undefined as any, undefined as any);
  expect(received.assistantName).toBeUndefined();
});
