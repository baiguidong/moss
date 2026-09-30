import { describe, expect, test } from 'bun:test'
import { BashTool } from './BashTool.js'

describe('Document inspection read-only Bash boundary', () => {
  test('accepts directory inspection commands used for document inspection', () => {
    for (const command of [
      'ls -la',
      'find . -maxdepth 2 -type f',
      'rg -n proposal .',
      'head -n 20 README.md',
      'cat README.md',
      'stat README.md',
      'file README.md',
    ]) {
      expect(BashTool.isReadOnly({ command })).toBe(true)
    }
  })

  test('rejects writes, scripts, and output redirection', () => {
    for (const command of [
      'echo unsafe > output.txt',
      'rm README.md',
      'node scan.js',
    ]) {
      expect(BashTool.isReadOnly({ command })).toBe(false)
    }
  })
})
