import { test, expect } from 'bun:test'
import { McpToolCatalogCache } from './toolCatalogCache'
const value = { capabilities: { tools: {} }, tools: { tools: [{ name: 'get', inputSchema: { type: 'object' as const } }] } }
test('catalog metadata is bounded, expires, and is copied per session', async () => {
  const cache = new McpToolCatalogCache(2, 10000, 25)
  cache.put('a', value); cache.put('b', value)
  cache.get('a')!.tools.tools[0]!.name = 'mutated'
  expect(cache.get('a')!.tools.tools[0]!.name).toBe('get')
  cache.put('c', value); expect(cache.get('b')).toBeUndefined()
  await new Promise(resolve => setTimeout(resolve, 40)); expect(cache.get('a')).toBeUndefined()
  cache.put('oversize', { ...value, instructions: 'x'.repeat(10001) }); expect(cache.get('oversize')).toBeUndefined()
  cache.put('partial', { ...value, tools: { ...value.tools, nextCursor: 'next' } }); expect(cache.get('partial')).toBeUndefined()
})
test('catalog identities distinguish credentials and workspaces without retaining plaintext keys', () => {
  const key = McpToolCatalogCache.key(['app', 'workspace-a', 'secret-a'])
  expect(key).not.toContain('secret-a')
  expect(key).not.toBe(McpToolCatalogCache.key(['app', 'workspace-b', 'secret-a']))
  expect(key).not.toBe(McpToolCatalogCache.key(['app', 'workspace-a', 'secret-b']))
})
