import { expect, test } from 'bun:test'
import { formatFileSize } from '../format.js'

test('formats byte counts across the MB to GB boundary', () => {
  expect(formatFileSize(512)).toBe('512 bytes')
  expect(formatFileSize(1536)).toBe('1.5KB')
  expect(formatFileSize(1023 * 1024 ** 2)).toBe('1023MB')
  expect(formatFileSize(1024 ** 3)).toBe('1GB')
  expect(formatFileSize(1.5 * 1024 ** 3)).toBe('1.5GB')
})
