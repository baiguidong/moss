import { expect, test } from 'bun:test'
import { homedir } from 'node:os'
import path from 'node:path'
import { expandMcpHomePath, resolveMcpLaunchConfig } from '../src/apps/mcp-launch-config.mjs'

test('portable home paths resolve for macOS, Linux and Windows, including spaces', () => {
  for (const home of ['/Users/Test User', '/home/test-user']) {
    expect(expandMcpHomePath('~/.moss/artifacts/playwright', home)).toBe(`${home}/.moss/artifacts/playwright`)
    expect(expandMcpHomePath('~', home)).toBe(home)
  }
  expect(expandMcpHomePath('~/.moss/artifacts/playwright', 'C:\\Users\\Test User')).toBe('C:\\Users\\Test User\\.moss\\artifacts\\playwright')
  expect(expandMcpHomePath('~\\.moss\\artifacts', 'C:\\Users\\test')).toBe('C:\\Users\\test\\.moss\\artifacts')
  expect(expandMcpHomePath('~/artifacts', '\\\\server\\users\\test')).toBe('\\\\server\\users\\test\\artifacts')
})

test('only command and path arguments expand, without shell evaluation or mutating storage', () => {
  const config = { type: 'stdio', command: '~/bin/mcp', args: ['--output-dir', '~/My Files', '--output-dir=~/.moss', '~other/files', 'prefix~/file', '$HOME/file', '$(touch sentinel)', '"~/quoted"'], env: { VALUE: '~/literal' } }
  const original = structuredClone(config)
  expect(resolveMcpLaunchConfig(config)).toEqual({ ...config, command: path.join(homedir(), 'bin/mcp'), args: ['--output-dir', path.join(homedir(), 'My Files'), `--output-dir=${path.join(homedir(), '.moss')}`, ...config.args.slice(3)] })
  expect(config).toEqual(original)
  const http = { type: 'http', url: 'https://example.com/~user', headers: { Token: '~/literal' } }
  expect(resolveMcpLaunchConfig(http)).toEqual(http)
})
