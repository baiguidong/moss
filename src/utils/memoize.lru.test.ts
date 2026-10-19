import { expect, test } from 'bun:test'
import { memoizeWithLRU } from './memoize'

test('LRU shares pending work and retries a rejected promise', async () => {
  let attempts = 0
  const read = memoizeWithLRU(async (key: string) => {
    if (++attempts === 1) throw new Error('temporary failure')
    return key
  }, key => key)
  const first = read('catalog')
  expect(read('catalog')).toBe(first)
  await expect(first).rejects.toThrow('temporary failure')
  expect(await read('catalog')).toBe('catalog')
  expect(await read('catalog')).toBe('catalog')
  expect(attempts).toBe(2)
})

test('a late rejection cannot evict a newer cached result', async () => {
  let reject!: (error: Error) => void, attempts = 0
  const read = memoizeWithLRU(() => ++attempts === 1
    ? new Promise<string>((_resolve, no) => { reject = no })
    : Promise.resolve('new'), () => 'catalog')
  const first = read()
  read.cache.clear()
  const replacement = read()
  reject(new Error('old failed'))
  await expect(first).rejects.toThrow('old failed')
  expect(read()).toBe(replacement)
  expect(await read()).toBe('new')
})
