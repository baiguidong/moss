import { expect, test } from 'bun:test'
import { homedir } from 'node:os'
import path from 'node:path'
import { expandMcpHomePath, resolveMcpLaunchConfig, usesElectronAsNode } from '../src/apps/mcp-launch-config.mjs'

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
  expect(resolveMcpLaunchConfig(config)).toEqual({ ...config, env: { ...config.env, MOSS_SESSION_WORKSPACE: '' }, command: path.join(homedir(), 'bin/mcp'), args: ['--output-dir', path.join(homedir(), 'My Files'), `--output-dir=${path.join(homedir(), '.moss')}`, ...config.args.slice(3)] })
  expect(config).toEqual(original)
  const http = { type: 'http', url: 'https://example.com/~user', headers: { Token: '~/literal' } }
  expect(resolveMcpLaunchConfig(http)).toEqual(http)
})

test('App data placeholders resolve only at launch time', () => {
  const config = { type: 'stdio', command: 'node', args: ['server.js'], env: { DATA: '${MOSS_APP_DATA_DIR}/dbx', HOME_LITERAL: '~/keep' } }
  expect(resolveMcpLaunchConfig(config, { appDataDir: '/tmp/apps-data/moss.dbx/instances/default' })).toMatchObject({
    env: {
      DATA: '/tmp/apps-data/moss.dbx/instances/default/dbx',
      HOME_LITERAL: '~/keep',
      MOSS_APP_DATA_DIR: '/tmp/apps-data/moss.dbx/instances/default',
    },
  })
  expect(config.env.DATA).toBe('${MOSS_APP_DATA_DIR}/dbx')
})

test('Electron needs Node mode only when an MCP service launches the host executable', () => {
  const executable = '/opt/moss/ui/electron'
  expect(usesElectronAsNode(executable, executable, true)).toBe(true)
  expect(usesElectronAsNode('/usr/bin/node', executable, true)).toBe(false)
  expect(usesElectronAsNode(executable, executable, false)).toBe(false)
})
