import { test, expect } from 'bun:test'
import { ToolTokenCache } from './toolTokenCache'

test('same names with new schemas or provider identities are counted independently; in-flight calls share work', async () => {
  const cache = new ToolTokenCache(); let count = 0
  const calculate = async () => ++count
  const first = [{ name: 'same', input_schema: { type: 'object' } }]
  expect(await Promise.all([cache.count('provider-a', first, calculate), cache.count('provider-a', first, calculate)])).toEqual([1, 1])
  expect(await cache.count('provider-a', [{ ...first[0], description: 'new' }], calculate)).toBe(2)
  expect(await cache.count('provider-b', first, calculate)).toBe(3)
  expect(await cache.count('provider-a', first, calculate)).toBe(1)
})
test('unavailable counters and evicted entries are retryable', async () => {
  const cache = new ToolTokenCache(1, 0)
  expect(await cache.count('a', [], async () => null)).toBeNull()
  expect(await cache.count('a', [], async () => 10)).toBe(10)
  await cache.count('b', [], async () => 20)
  expect(await cache.count('a', [], async () => 30)).toBe(30)
})

test('unavailable counting backs off instead of making another provider request on every iteration', async () => {
  let now = 0, attempts = 0
  const cache = new ToolTokenCache(8, 30, () => now)
  const unavailable = async () => { attempts++; return null }
  await cache.count('provider', [], unavailable)
  await cache.count('provider', [], unavailable)
  expect(attempts).toBe(1)
  now = 31; await cache.count('provider', [], unavailable)
  expect(attempts).toBe(2)
})
