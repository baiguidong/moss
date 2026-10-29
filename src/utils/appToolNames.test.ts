import { matchesToolSelector } from './appToolNames.js'
import { expect, test } from 'bun:test'
import type { Tool } from '../Tool.js'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { mergeAndFilterTools } from './toolPool.js'
import { assembleToolPool } from '../tools.js'
import { asSessionId } from '../types/ids.js'
import { runWithSessionIdContext } from './sessionIdContext.js'
import { getDenyRuleForTool } from './permissions/permissions.js'

const native = (appId: string, scope: 'global' | 'session' = 'global', name = 'visualize_create') => ({
  name, appInfo: { appId, toolScope: scope, contributionId: `${appId}/${name}` },
} as Tool)
const mcp = (serverName: string, name: string) => ({ name, isMcp: true, mcpInfo: { appId: serverName, serverName, toolName: name } } as Tool)
const inSession = <T>(selected: string[], action: () => T) => runWithSessionIdContext(asSessionId('names'), null, action, undefined, undefined, {
  executionEnvironment: 'desktop', appToolPolicy: { appIds: selected, mcpServers: { one: { appId: 'one', toolScope: 'global' }, two: { appId: 'two', toolScope: 'global' } } },
})

test('only current session tools participate; global plus selected copies register once', () => {
  inSession(['visual'], () => {
    const global = native('visual'), unselected = native('other', 'session');
    expect(mergeAndFilterTools([global, unselected], [global], 'default').map(tool => tool.name)).toEqual(['visualize_create']);
  });
  inSession(['other'], () => expect(() => mergeAndFilterTools([native('visual'), native('other', 'session')], [], 'default')).toThrow('工具名称冲突'));
});
test('different Apps cannot silently override global, Core or MCP tools with the same name', () => {
  inSession([], () => {
    for (const pair of [[native('one'), native('two')], [native('one', 'global', 'Read'), { name: 'Read' } as Tool], [native('one'), mcp('two', 'visualize_create')]]) {
      expect(() => mergeAndFilterTools(pair, [], 'default')).toThrow('工具名称冲突');
    }
    expect(() => assembleToolPool(getEmptyToolPermissionContext(), [mcp('one', 'Read')])).toThrow('工具名称冲突');
    expect(() => assembleToolPool(getEmptyToolPermissionContext(), [mcp('one', 'lookup'), mcp('two', 'lookup')])).toThrow('工具名称冲突');
  });
});
test('legacy native permission rules still match only their original App', () => {
  const rule = getEmptyToolPermissionContext();
  rule.alwaysDenyRules = { session: ['app__one__visualize_create'] };
  expect(getDenyRuleForTool(rule, native('one'))).not.toBeNull();
  expect(getDenyRuleForTool(rule, native('two'))).toBeNull();
  rule.alwaysDenyRules = { session: ['app__one__*'] };
  expect(getDenyRuleForTool(rule, native('one'))).not.toBeNull();
  expect(getDenyRuleForTool(rule, native('two'))).toBeNull();
});


test('saved allowlists select renamed tools by their original owner without adding aliases', () => {
  expect(matchesToolSelector(native('one'), ['app__one__visualize_create'])).toBe(true)
  expect(matchesToolSelector(native('one'), ['app__one__*'])).toBe(true)
  expect(matchesToolSelector(native('two'), ['app__one__*'])).toBe(false)
  expect(matchesToolSelector(mcp('one', 'lookup'), ['one__lookup'])).toBe(true)
  expect(matchesToolSelector(mcp('two', 'lookup'), ['one__lookup'])).toBe(false)
  expect(matchesToolSelector(native('one'), ['visualize_create'])).toBe(true)
})
