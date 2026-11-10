import { test, expect } from 'bun:test'
import { mergeMcpDefaults } from '../src/apps/mcp-config-defaults.mjs'

const previous = { type: 'stdio', command: 'python3', args: ['-I', '-m', 'excel_mcp', 'stdio', '--allow-dir', '~'], python: { requirements: ['excel-mcp-server==2.0.0'] }, env: { READ_ONLY: '0' } }
const next = { type: 'stdio', command: 'node', args: ['@app/runtime/launch.cjs', 'stdio', '--allow-dir', '~'], env: { READ_ONLY: '0' } }

test('bundled Python upgrade keeps user service arguments and credentials without interpreter flags or pip', () => {
  const current = { ...previous, args: ['-I', '-m', 'excel_mcp', 'stdio', '--allow-dir', '/Users/Test Files', '--read-only'], env: { READ_ONLY: '1' }, disabledTools: ['delete'] }
  const result = mergeMcpDefaults(previous, current, next)
  expect(result.command).toBe('node')
  expect(result.args).toEqual(['@app/runtime/launch.cjs', 'stdio', '--allow-dir', '/Users/Test Files', '--read-only'])
  expect(result.python).toBeUndefined()
  expect(result.env).toEqual({ READ_ONLY: '1' })
  expect(result.disabledTools).toEqual(['delete'])
  expect(current.args[0]).toBe('-I')
  expect(mergeMcpDefaults(previous, previous, next)).toEqual(next)
})

test('bundled Python upgrade leaves an explicitly customized interpreter or module intact', () => {
  for (const current of [
    { ...previous, command: '/custom/python' },
    { ...previous, args: ['-m', 'custom'] },
    { ...previous, python: { requirements: ['excel-mcp-server==1.0.0'] } },
  ]) expect(mergeMcpDefaults(previous, current, next)).toEqual(current)
})
